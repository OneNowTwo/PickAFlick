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
import { sessionStorage as gameSessionStorage } from "./session-storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  maxRetries: 1,
});

const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";

const recentlyRecommendedTitles: string[] = [];
const MAX_RECENT_TRACKED = 400;
const RECENT_EXCLUSIONS_PROMPT_COUNT = 56;
const TARGET_RESOLVED = 5;
const LLM_PICK_COUNT = 8;
const MAX_PRE_1970 = 1;

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

export interface TasteObservationResult {
  headline: string;
  patternSummary: string;
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
}

interface AIRecommendationResult { title: string; year?: number; reason: string; }

interface SingleTrackLLMResult {
  picks: AIRecommendationResult[];
}

interface PrefetchEntry {
  taste: Promise<TasteObservationResult>;
  mainstream: Promise<SingleTrackLLMResult>;
  indie: Promise<SingleTrackLLMResult>;
}

const prefetchBySession = new Map<string, PrefetchEntry>();

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

function fallbackTaste(chosenMovies: Movie[]): TasteObservationResult {
  const g = extractTopGenres(chosenMovies);
  return {
    headline: "You’re narrowing in on what feels right tonight.",
    patternSummary:
      "Your picks sketch a clear direction across the rounds. So these recommendations try to honour that same instinct without repeating what you already saw.",
    topGenres: g,
    themes: [],
    preferredEras: [],
  };
}

// ── Taste headline + two-sentence pattern (picker + results top) ─────────────

export async function buildTasteObservation(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[] = []
): Promise<TasteObservationResult> {
  const choicesBlock = formatChoicesBlock(chosenMovies);
  const rejectsBlock = formatRejectsBlock(rejectedMovies, chosenMovies);
  const genreLine = initialGenreFilters.length > 0
    ? `Session genre hints (optional): ${initialGenreFilters.join(", ")}.`
    : "";

  const prompt = `Read this 7-round movie A/B funnel. Write copy for a friend — not marketing, not a robot.

CHOSEN:
${choicesBlock}

PASSED ON:
${rejectsBlock}
${genreLine}

Output JSON only:
{
  "headline": "string — ONE short line only. A human observation of their mood or appetite tonight. Examples of tone (do not copy verbatim): You're in a darker mood tonight. / You want something with a bit of weight. / You're chasing something gripping. / You're leaning playful but still want a story. / You kept tilting toward grounded, adult drama.",
  "patternSummary": "string — EXACTLY two sentences in one paragraph. First sentence: what the pattern of wins/losses suggests (start with You leaned… OR You favoured… OR You kept choosing… OR You mixed… — vary this). Second sentence: MUST start with So these picks and explains how the recommendation list will honour that pattern. Be specific to THIS funnel (tones, pacing, realism vs spectacle, moral complexity, humour level, era bias if clear). No genre soup.",
  "topGenres": ["","",""],
  "themes": ["",""],
  "preferredEras": ["",""]
}

Rules:
- No em dashes. No words: delve, tapestry, landscape, journey (as metaphor), unlock, resonate.
- Do not name or quote any film title from the funnel in headline or patternSummary.
- Sound like a sharp human who watched their choices — not a template.`;

  try {
    const response = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [
        { role: "system", content: "You write short, natural taste copy. JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 450,
      temperature: 0.88,
    });
    const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as TasteObservationResult;
    return {
      headline: (raw.headline || "").trim(),
      patternSummary: (raw.patternSummary || "").trim(),
      topGenres: raw.topGenres || [],
      themes: raw.themes || [],
      preferredEras: raw.preferredEras || [],
    };
  } catch (e) {
    console.error("[taste-observation]", e);
    return fallbackTaste(chosenMovies);
  }
}

// ── Single track: 8 LLM picks (mainstream OR indie) ──────────────────────────

function trackPromptBlock(track: RecommendationTrack): string {
  if (track === "mainstream") {
    return `TRACK: Mainstream — widely known, easy to find tonight, polished and accessible. Still vary tone, era, and subgenre. Avoid five near-identical blockbusters.`;
  }
  return `TRACK: Indie / less obvious — less famous but acclaimed or strong word-of-mouth; smart indies, international, or auteur-led. Watchable, not homework, not micro-budget obscurity.`;
}

function buildSingleTrackPrompt(
  track: RecommendationTrack,
  choicesBlock: string,
  rejectsBlock: string,
  chosenTitles: string,
  recentExclusions: string[],
  genreFilterLine: string
): string {
  const exclusionsLine = recentExclusions.length > 0
    ? `Do not recommend: ${recentExclusions.join("; ")} (recently shown).`
    : "";

  return `Recommend films from the OPEN web of cinema — not from a fixed database list. Infer taste from the WHOLE funnel pattern (wins vs passes), not movie-for-movie mapping.

CHOSEN:
${choicesBlock}

PASSED ON:
${rejectsBlock}
${genreFilterLine}

${trackPromptBlock(track)}

Constraints:
- Exactly ${LLM_PICK_COUNT} films in "picks".
- At most ${MAX_PRE_1970} before 1970; include a 2020+ title if it fits.
- Plausibly available in Australia.
- No duplicate directors in the list.
- Do not recommend funnel choices: ${chosenTitles}
${exclusionsLine}

Per-film "reason" (CRITICAL):
- 1–2 sentences, max ~40 words total.
- Tie this film to the OVERALL taste signal from the funnel (tension level, humour, scale, moral grey, pacing). Describe the film’s flavour.
- Do NOT name or reference any specific A/B film title. Do NOT say "because you chose…" or "if you liked X".
- Example of acceptable shape: "Delivers sustained tension and a survival stakes story that matches the grit your picks kept favouring."

Return JSON only: {"picks":[{"title":"","year":2020,"reason":""}, ... ${LLM_PICK_COUNT} items]}`;
}

async function callSingleTrackLLM(promptText: string, track: RecommendationTrack): Promise<SingleTrackLLMResult> {
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: "PickAFlick. JSON only. Diverse, non-repetitive titles." },
      { role: "user", content: promptText },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1600,
    temperature: track === "indie" ? 0.86 : 0.78,
  });
  return JSON.parse(response.choices[0]?.message?.content || "{}") as SingleTrackLLMResult;
}

export async function generateSingleTrackPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  track: RecommendationTrack
): Promise<SingleTrackLLMResult> {
  await ensureRecsLoaded();
  const choicesBlock = formatChoicesBlock(chosenMovies);
  const rejectsBlock = formatRejectsBlock(rejectedMovies, chosenMovies);
  const chosenTitles = chosenMovies.map((m) => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map(normalizeTitleKey));
  const genreFilterLine = initialGenreFilters.length > 0
    ? `Optional genre hints: ${initialGenreFilters.join(", ")}.`
    : "";

  const prompt = buildSingleTrackPrompt(
    track,
    choicesBlock,
    rejectsBlock,
    chosenTitles,
    recentExclusions,
    genreFilterLine
  );

  let result = await callSingleTrackLLM(prompt, track);
  let picks = result.picks || [];
  if (picks.length < LLM_PICK_COUNT - 2) {
    result = await callSingleTrackLLM(`${prompt}\n\nRegenerate: full ${LLM_PICK_COUNT} picks; JSON only.`, track);
    picks = result.picks || [];
  }

  const pre1970 = countPre1970(picks);
  const recentHits = countRecentCollisions(picks, recentTitlesSet);
  if (pre1970 > MAX_PRE_1970 || recentHits >= 3) {
    result = await callSingleTrackLLM(
      `${prompt}\n\nRegenerate: max ${MAX_PRE_1970} pre-1970; avoid recent list; ${LLM_PICK_COUNT} picks; JSON only.`,
      track
    );
    picks = result.picks || [];
  }

  return { picks };
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

async function resolvePicksToRecommendations(
  picks: AIRecommendationResult[],
  chosenMovies: Movie[],
  track: RecommendationTrack
): Promise<Recommendation[]> {
  const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));
  const seen = new Set<string>();
  const settled = await Promise.all(
    picks.slice(0, LLM_PICK_COUNT).map((r) => resolveOneRecommendation(r, chosenTmdbIds, track))
  );
  const out: Recommendation[] = [];
  for (const r of settled) {
    if (!r || out.length >= TARGET_RESOLVED) continue;
    const k = normalizeTitleKey(r.movie.title);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function startPrefetchPromises(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  filters: string[]
): PrefetchEntry {
  return {
    taste: buildTasteObservation(chosenMovies, rejectedMovies, filters),
    mainstream: generateSingleTrackPicks(chosenMovies, rejectedMovies, filters, "mainstream"),
    indie: generateSingleTrackPicks(chosenMovies, rejectedMovies, filters, "indie"),
  };
}

/** Fire when the last A/B choice is recorded — runs taste + both tracks in parallel. */
export function beginRecommendationPrefetch(sessionId: string): void {
  if (prefetchBySession.has(sessionId)) return;
  const session = gameSessionStorage.getSession(sessionId);
  if (!session?.isComplete) return;
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) return;

  console.log(`[prefetch] Starting taste + mainstream + indie for ${sessionId}`);
  prefetchBySession.set(sessionId, startPrefetchPromises(chosen, rejected, filters));
}

export async function getTastePreviewForSession(sessionId: string): Promise<TasteObservationResult> {
  let entry = prefetchBySession.get(sessionId);
  if (!entry) {
    const session = gameSessionStorage.getSession(sessionId);
    if (!session?.isComplete) return fallbackTaste([]);
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    const rejected = gameSessionStorage.getRejectedMovies(sessionId);
    const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
    if (chosen.length === 0) return fallbackTaste([]);
    entry = startPrefetchPromises(chosen, rejected, filters);
    prefetchBySession.set(sessionId, entry);
  }
  try {
    return await entry.taste;
  } catch {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    return fallbackTaste(chosen);
  }
}

export async function finalizeRecommendationsForTrack(
  sessionId: string,
  track: RecommendationTrack
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) {
    return fallbackSingleTrack(chosen, track);
  }

  let taste: TasteObservationResult;
  let picks: AIRecommendationResult[] = [];

  const entry = prefetchBySession.get(sessionId);
  if (entry) {
    taste = await entry.taste.catch(() => fallbackTaste(chosen));
    try {
      const raw = await (track === "mainstream" ? entry.mainstream : entry.indie);
      picks = raw.picks || [];
    } catch (e) {
      console.error("[finalize] track prefetch failed", e);
      picks = [];
    }
    prefetchBySession.delete(sessionId);
  } else {
    taste = await buildTasteObservation(chosen, rejected, filters);
    const raw = await generateSingleTrackPicks(chosen, rejected, filters, track);
    picks = raw.picks || [];
  }

  if (picks.length < 5) {
    const raw = await generateSingleTrackPicks(chosen, rejected, filters, track);
    picks = raw.picks || [];
  }

  let recommendations = await resolvePicksToRecommendations(picks, chosen, track);
  if (recommendations.length < TARGET_RESOLVED) {
    const raw = await generateSingleTrackPicks(chosen, rejected, filters, track);
    recommendations = await resolvePicksToRecommendations(raw.picks, chosen, track);
  }

  recordRecommendedTitles(recommendations.map((r) => r.movie.title));

  const mainstream = track === "mainstream" ? recommendations : [];
  const indie = track === "indie" ? recommendations : [];

  return {
    recommendations,
    mainstreamRecommendations: mainstream,
    indieRecommendations: indie,
    preferenceProfile: {
      topGenres: taste.topGenres || [],
      themes: taste.themes || [],
      preferredEras: taste.preferredEras || [],
      headline: taste.headline,
      patternSummary: taste.patternSummary,
      tagline: "",
    },
  };
}

async function fallbackSingleTrack(chosenMovies: Movie[], track: RecommendationTrack): Promise<RecommendationsResponse> {
  const taste = fallbackTaste(chosenMovies);
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
  ).slice(0, TARGET_RESOLVED);

  const recs: Recommendation[] = await Promise.all(
    pool.map(async (m) => {
      const trailerUrls = await getMovieTrailers(m.tmdbId);
      return {
        movie: { ...m, listSource: "ai-recommendation" },
        trailerUrl: trailerUrls[0] || null,
        trailerUrls,
        reason: "Sits in the same ballpark as the pattern your picks sketched.",
        pickedAs: track,
      };
    })
  );

  return {
    recommendations: recs,
    mainstreamRecommendations: track === "mainstream" ? recs : [],
    indieRecommendations: track === "indie" ? recs : [],
    preferenceProfile: {
      topGenres: taste.topGenres,
      themes: [],
      preferredEras: [],
      headline: taste.headline,
      patternSummary: taste.patternSummary,
      tagline: "",
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
    return `TRACK — Indie: one less famous, critically strong pick; fits funnel taste; Australia.`;
  }
  return `TRACK — Mainstream: one accessible, well-known pick; fits funnel taste; Australia.`;
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

  const prompt = `One replacement for the ${track} list. Infer taste from the whole funnel — do not mirror one funnel title to one pick.

${picks}${rejHints}

Exclude ${excludeTmdbIds.length} titles already shown.

${replacementRules(track)}

Reason: 1–2 sentences, max 35 words. Tie to overall funnel pattern. Do NOT name any funnel film.

JSON only: {"title":"","year":2000,"reason":""}`;

  try {
    const resp = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 240,
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
      reason: "Fits the mood your rounds pointed toward.",
      pickedAs: track,
    };
  }
  return null;
}
