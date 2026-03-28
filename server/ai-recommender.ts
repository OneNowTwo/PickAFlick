import OpenAI from "openai";
import type {
  Movie,
  Recommendation,
  RecommendationsResponse,
  RecommendationTrack,
} from "@shared/schema";
import { searchMovieByTitle, getMovieTrailers, getMovieDetails } from "./tmdb";
import { getAllMovies } from "./catalogue";
import { storage } from "./storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  maxRetries: 1,
});

const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";

const recentlyRecommendedTitles: string[] = [];
const MAX_RECENT_TRACKED = 400;
const RECENT_EXCLUSIONS_PROMPT_COUNT = 56;
const TARGET_MAINSTREAM = 5;
const TARGET_INDIE = 5;
const LLM_MAINSTREAM = 7;
const LLM_INDIE = 7;

let recsLoaded = false;

async function ensureRecsLoaded(): Promise<void> {
  if (recsLoaded) return;
  recsLoaded = true;
  try {
    const saved = await storage.getRecentRecommendations();
    const merged = Array.from(new Set(saved.map(normalizeTitleKey)));
    recentlyRecommendedTitles.push(...merged);
    console.log(`[recent-recs] Loaded ${merged.length} previously recommended titles from DB`);
  } catch { /* non-fatal */ }
}

export async function preloadRecentRecommendationsCache(): Promise<void> {
  await ensureRecsLoaded();
}

function recordRecommendedTitles(titles: string[]): void {
  for (const t of titles) {
    const normalised = normalizeTitleKey(t);
    if (!recentlyRecommendedTitles.includes(normalised)) {
      recentlyRecommendedTitles.push(normalised);
      if (recentlyRecommendedTitles.length > MAX_RECENT_TRACKED) {
        recentlyRecommendedTitles.shift();
      }
    }
  }
  storage.saveRecentRecommendations([...recentlyRecommendedTitles])
    .catch(err => console.error("[recent-recs] Failed to save:", err));
}

interface AIRecommendationResult { title: string; year?: number; reason: string; }

interface DualLLMResponse {
  headline: string;
  tagline: string;
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
  visualStyle: string;
  mood: string;
  mainstream_picks: AIRecommendationResult[];
  indie_picks: AIRecommendationResult[];
}

const MAX_PRE_1970_TOTAL = 1;

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/^the\s+/i, "");
}

function countPre1970(recs: { year?: number }[]): number {
  return recs.filter((r) => typeof r.year === "number" && r.year < 1970).length;
}

function countRecentCollisions(recs: { title: string }[], recentSet: Set<string>): number {
  return recs.filter((r) => recentSet.has(normalizeTitleKey(r.title))).length;
}

function formatChoicesBlock(chosenMovies: Movie[]): string {
  return chosenMovies.map((m, i) => {
    const round = i + 1;
    const star = round >= 5 ? "*" : "";
    const kw = (m.keywords || []).slice(0, 5).join(", ") || "—";
    return `R${round}${star}: "${m.title}" (${m.year}) — ${m.genres[0] || "Unknown"}, dir. ${m.director || "Unknown"}, kw: ${kw}`;
  }).join("\n");
}

function formatRejectsBlock(rejectedMovies: Movie[], chosenMovies: Movie[]): string {
  if (rejectedMovies.length === 0) return "(none)";
  return rejectedMovies.map((m, i) => {
    const chosen = chosenMovies[i];
    return `R${i + 1}: passed on "${m.title}" (${m.year}) — picked "${chosen?.title ?? "—"}"`;
  }).join("\n");
}

async function callDualLLM(promptText: string): Promise<DualLLMResponse> {
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      {
        role: "system",
        content:
          "PickAFlick recommender. Respond only with valid JSON. Infer taste from the funnel; never copy titles from the funnel into the recommendation lists.",
      },
      { role: "user", content: promptText },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2800,
    temperature: 0.74,
  });
  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as DualLLMResponse;
}

async function resolveOneRecommendation(
  rec: AIRecommendationResult,
  chosenTmdbIds: Set<number>,
  pickedAs: RecommendationTrack
): Promise<Recommendation | null> {
  try {
    const searchResult = await searchMovieByTitle(rec.title, rec.year);
    if (!searchResult || chosenTmdbIds.has(searchResult.id)) return null;

    const [movieDetails, tmdbTrailers] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id),
    ]);

    if (!movieDetails) return null;
    if (!movieDetails.posterPath?.trim()) return null;
    if (tmdbTrailers.length === 0) return null;

    movieDetails.listSource = "ai-recommendation";
    return {
      movie: movieDetails,
      trailerUrl: tmdbTrailers[0],
      trailerUrls: tmdbTrailers,
      reason: rec.reason,
      pickedAs,
    };
  } catch {
    return null;
  }
}

async function resolveTrackOrdered(
  recs: AIRecommendationResult[],
  chosenTmdbIds: Set<number>,
  pickedAs: RecommendationTrack,
  excludeNormalizedTitles: Set<string>,
  cap: number
): Promise<Recommendation[]> {
  const maxSlice = pickedAs === "mainstream" ? LLM_MAINSTREAM : LLM_INDIE;
  const slice = recs.slice(0, maxSlice);
  const settled = await Promise.all(
    slice.map((r) => resolveOneRecommendation(r, chosenTmdbIds, pickedAs))
  );
  const out: Recommendation[] = [];
  for (const r of settled) {
    if (!r || out.length >= cap) continue;
    const key = normalizeTitleKey(r.movie.title);
    if (excludeNormalizedTitles.has(key)) continue;
    excludeNormalizedTitles.add(key);
    out.push(r);
  }
  return out;
}

function buildDualPrompt(
  choicesBlock: string,
  rejectsBlock: string,
  chosenTitles: string,
  recentExclusions: string[],
  genreFilterLine: string
): string {
  const exclusionsLine = recentExclusions.length > 0
    ? `Do not recommend these titles (shown recently to other users): ${recentExclusions.join("; ")}`
    : "";

  return `You are building TWO recommendation rows from one A/B movie funnel. Infer a coherent taste profile from the pattern of wins/losses — not by matching posters 1:1 to new films.

CHOSEN:
${choicesBlock}

PASSED ON:
${rejectsBlock}
${genreFilterLine}

Rows (both must reflect the SAME inferred taste, different reach/visibility):

1) mainstream_picks — ${LLM_MAINSTREAM} films: widely known, easy to find, "good tonight" energy. Polished and accessible. Still varied in tone, era, and subgenre — not five near-identical blockbusters.

2) indie_picks — ${LLM_INDIE} films: less famous but still acclaimed or strong word-of-mouth; smart indies, international, or auteur-led picks that fit the same taste. Watchable — not homework, not ultra-obscure micro-budget.

Rules:
- No title may appear in both rows.
- No duplicate directors across all ${LLM_MAINSTREAM + LLM_INDIE} suggestions.
- Across BOTH rows combined: at most ${MAX_PRE_1970_TOTAL} film released before 1970; include at least one 2020+ title somewhere if it fits.
- Films must be plausibly available in Australia (theatrical/stream/rent).
- Do not recommend anything the user already chose in the funnel: ${chosenTitles}
${exclusionsLine ? `${exclusionsLine}\n` : ""}

Taste copy (short, human, specific — not a genre laundry list):
- headline: max 12 words, second person.
- tagline: max 16 words, adds one concrete colour (pace, mood, or viewing context).
- topGenres, themes, preferredEras: short arrays for UI chips.

Reasons — CRITICAL:
- One short sentence each, max ~22 words.
- Describe why the film fits their inferred mood/tone/pacing only.
- Do NOT name, quote, or reference any title from the A/B funnel.
- Do NOT say "because you chose…", "if you liked…", or compare directly to funnel films.

Return JSON only:
{"headline":"","tagline":"","topGenres":["","",""],"themes":["",""],"preferredEras":["",""],"visualStyle":"omit or empty","mood":"omit or empty","mainstream_picks":[{"title":"","year":2020,"reason":""}],"indie_picks":[{"title":"","year":2020,"reason":""}]}`;
}

export async function generateRecommendations(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = [],
  initialGenreFilters: string[] = []
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();

  const choicesBlock = formatChoicesBlock(chosenMovies);
  const rejectsBlock = formatRejectsBlock(rejectedMovies, chosenMovies);
  const chosenTitles = chosenMovies.map((m) => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map(normalizeTitleKey));

  const genreFilterLine = initialGenreFilters.length > 0
    ? `Optional session genre hints (use only if they still fit the inferred mood): ${initialGenreFilters.join(", ")}.`
    : "";

  const prompt = buildDualPrompt(choicesBlock, rejectsBlock, chosenTitles, recentExclusions, genreFilterLine);

  try {
    let parsed = await callDualLLM(prompt);

    const allPicks = [...(parsed.mainstream_picks || []), ...(parsed.indie_picks || [])];
    if (allPicks.length < 8) {
      throw new Error("LLM returned too few picks");
    }

    const pre1970 = countPre1970(allPicks);
    const recentHits = countRecentCollisions(allPicks, recentTitlesSet);
    if (pre1970 > MAX_PRE_1970_TOTAL || recentHits >= 4) {
      console.warn(`[ai-recommender] Retry dual prompt: ${recentHits} recent hits, ${pre1970} pre-1970`);
      parsed = await callDualLLM(
        `${prompt}\n\nRegenerate completely: respect pre-1970 and recent-title rules; fresh titles; no overlap between rows; JSON only.`
      );
    }

    const excludeTitles = new Set<string>();
    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    let mainstream = await resolveTrackOrdered(
      parsed.mainstream_picks || [],
      chosenTmdbIds,
      "mainstream",
      excludeTitles,
      TARGET_MAINSTREAM
    );
    let indie = await resolveTrackOrdered(
      parsed.indie_picks || [],
      chosenTmdbIds,
      "indie",
      excludeTitles,
      TARGET_INDIE
    );

    if (mainstream.length < TARGET_MAINSTREAM || indie.length < TARGET_INDIE) {
      console.warn(
        `[ai-recommender] Under-filled rows (main ${mainstream.length}, indie ${indie.length}) — one repair pass`
      );
      const repair = await callDualLLM(
        `${prompt}\n\nPrevious output resolved poorly in TMDB. Output NEW films only. mainstream_picks: ${LLM_MAINSTREAM} titles, indie_picks: ${LLM_INDIE} titles. Same JSON schema.`
      );
      excludeTitles.clear();
      mainstream = await resolveTrackOrdered(
        repair.mainstream_picks || [],
        chosenTmdbIds,
        "mainstream",
        excludeTitles,
        TARGET_MAINSTREAM
      );
      indie = await resolveTrackOrdered(
        repair.indie_picks || [],
        chosenTmdbIds,
        "indie",
        excludeTitles,
        TARGET_INDIE
      );
    }

    const combined = [...mainstream, ...indie];
    recordRecommendedTitles(combined.map((r) => r.movie.title));

    return {
      recommendations: combined,
      mainstreamRecommendations: mainstream,
      indieRecommendations: indie,
      preferenceProfile: {
        topGenres: parsed.topGenres || [],
        themes: parsed.themes || [],
        preferredEras: parsed.preferredEras || [],
        visualStyle: "",
        mood: "",
        headline: (parsed.headline || "").trim(),
        tagline: (parsed.tagline || "").trim(),
      },
    };
  } catch (error) {
    console.error("AI recommendation error:", error);
    return fallbackDualRecommendations(chosenMovies);
  }
}

async function fallbackDualRecommendations(chosenMovies: Movie[]): Promise<RecommendationsResponse> {
  const allMovies = getAllMovies();
  const pool = shuffleArray(
    allMovies.filter(
      (m) =>
        !chosenMovies.some((c) => c.tmdbId === m.tmdbId) &&
        m.posterPath?.trim() &&
        m.year &&
        m.year >= 1990 &&
        m.rating &&
        m.rating >= 7.0
    )
  );
  const mainstreamPool = pool.filter((m) => (m.rating ?? 0) >= 7.2).slice(0, 5);
  const indiePool = pool.filter((m) => !mainstreamPool.includes(m)).slice(0, 5);

  async function toRec(m: Movie, pickedAs: RecommendationTrack): Promise<Recommendation> {
    const trailerUrls = await getMovieTrailers(m.tmdbId);
    return {
      movie: { ...m, listSource: "ai-recommendation" },
      trailerUrl: trailerUrls[0] || null,
      trailerUrls,
      reason: "Matches the tone of your picks tonight.",
      pickedAs,
    };
  }

  const mainstream = await Promise.all(mainstreamPool.map((m) => toRec(m, "mainstream")));
  const indie = await Promise.all(indiePool.map((m) => toRec(m, "indie")));
  const combined = [...mainstream, ...indie];

  return {
    recommendations: combined,
    mainstreamRecommendations: mainstream,
    indieRecommendations: indie,
    preferenceProfile: {
      topGenres: extractTopGenres(chosenMovies),
      themes: [],
      preferredEras: [],
      headline: "Here are two rows tailored to your funnel.",
      tagline: "Easy watches first, then acclaimed lesser-known picks.",
    },
  };
}

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function extractTopGenres(movies: Movie[]): string[] {
  const genreCounts = new Map<string, number>();
  for (const movie of movies) {
    for (const genre of movie.genres) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  }
  return Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
}

function replacementRules(track: RecommendationTrack): string {
  if (track === "indie") {
    return `TRACK — Indie row: one less famous, critically strong or film-lover pick; still fits their funnel taste; findable in Australia.`;
  }
  return `TRACK — Mainstream row: one accessible, well-known pick that fits their funnel taste; findable in Australia.`;
}

export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = [],
  track: RecommendationTrack = "mainstream"
): Promise<Recommendation | null> {
  const picks = chosenMovies.map((m, i) => `R${i + 1}: "${m.title}" (${m.year}) — ${m.director || "?"}`).join("\n");
  const rejHints = rejectedMovies.length > 0
    ? `\nPASSED ON: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}"`).join(", ")}`
    : "";

  const prompt = `One replacement for the ${track} row. Infer taste from the funnel (do not mirror one funnel title to one pick).

${picks}${rejHints}

Exclude TMDB ids already shown: ${excludeTmdbIds.length} titles.

${replacementRules(track)}

Reason: one short sentence, max 20 words. Do NOT reference any funnel film by title.

JSON only: {"title":"","year":2000,"reason":""}`;

  try {
    const resp = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 220,
      temperature: 0.85,
    });
    const result: AIRecommendationResult = JSON.parse(resp.choices[0]?.message?.content || "{}");
    const search = await searchMovieByTitle(result.title, result.year);
    if (!search || excludeTmdbIds.includes(search.id)) return await catalogueFallbackReplacement(excludeTmdbIds, track);

    const [details, trailers] = await Promise.all([getMovieDetails(search.id), getMovieTrailers(search.id)]);
    if (!details || !details.posterPath?.trim() || trailers.length === 0) {
      return catalogueFallbackReplacement(excludeTmdbIds, track);
    }

    details.listSource = "replacement";
    return {
      movie: details,
      trailerUrl: trailers[0],
      trailerUrls: trailers,
      reason: result.reason,
      pickedAs: track,
    };
  } catch {
    return catalogueFallbackReplacement(excludeTmdbIds, track);
  }
}

async function catalogueFallbackReplacement(
  excludeTmdbIds: number[],
  track: RecommendationTrack
): Promise<Recommendation | null> {
  const eligible = shuffleArray(
    getAllMovies().filter((m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0)
  );
  for (const movie of eligible.slice(0, 12)) {
    if (!movie.posterPath?.trim()) continue;
    const trailerUrls = await getMovieTrailers(movie.tmdbId);
    if (trailerUrls.length === 0) continue;
    return {
      movie: { ...movie, listSource: "replacement" },
      trailerUrl: trailerUrls[0],
      trailerUrls,
      reason: "Fits the mood of your picks tonight.",
      pickedAs: track,
    };
  }
  return null;
}
