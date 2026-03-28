import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse, RecommendationLane } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailer, getMovieTrailers, getMovieDetails } from "./tmdb";
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
const RECENT_EXCLUSIONS_PROMPT_COUNT = 48;
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

export interface TasteProfile {
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
  visualStyle: string;
  mood: string;
  tasteSignature: string;
}

interface AIAnalysis extends TasteProfile {
  recommendations: AIRecommendationResult[];
}

const MAX_PRE_1970_FILMS = 1;

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/^the\s+/i, "");
}

function countPre1970(recs: { year?: number }[]): number {
  return recs.filter((r) => typeof r.year === "number" && r.year < 1970).length;
}

function countRecentCollisions(recs: { title: string }[], recentSet: Set<string>): number {
  return recs.filter((r) => recentSet.has(normalizeTitleKey(r.title))).length;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1 — build taste profile (runs during A/B rounds)
// ═══════════════════════════════════════════════════════════════════

function buildProfilePrompt(chosenMovies: Movie[], rejectedMovies: Movie[]): string {
  const choicesBlock = chosenMovies.map((m, i) => {
    const r = i + 1;
    return `R${r}: chose "${m.title}" (${m.year}) — ${m.genres[0] || "?"}, dir. ${m.director || "?"}`;
  }).join("\n");

  const rejectsBlock = rejectedMovies.length > 0
    ? rejectedMovies.map((m, i) => `R${i + 1}: rejected "${m.title}" (${m.year})`).join("\n")
    : "(none)";

  return `A/B movie funnel results. Infer ONE clear taste profile.

CHOSEN:
${choicesBlock}

REJECTED:
${rejectsBlock}

Return JSON only:
{"topGenres":["g1","g2","g3"],"themes":["t1","t2"],"preferredEras":["era1","era2"],"visualStyle":"one sentence using you/your about their screen taste","mood":"one sentence using you/your about their emotional register","tasteSignature":"2-3 sentence summary of what this person is in the mood for, referencing specific choices"}`;
}

export async function buildTasteProfile(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = []
): Promise<TasteProfile> {
  const prompt = buildProfilePrompt(chosenMovies, rejectedMovies);
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: "PickAFlick taste profiler. Respond only with valid JSON." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(content) as TasteProfile;
  console.log(`[profile] Built taste profile from ${chosenMovies.length} choices`);
  return parsed;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2 — get recommendations (runs when user picks a lane)
// ═══════════════════════════════════════════════════════════════════

function laneInstruction(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `Use the Mainstream lane: lean toward polished, accessible, high-confidence picks that are easy to watch tonight, but avoid obvious blockbuster clones.`;
    case "movie_buff":
      return `Use the Movie Buff lane: lean toward more curated, less obvious, film-lover picks (including strong indies), but keep them watchable and not obscure.`;
    case "left_field":
      return `Use the Left Field lane: lean toward surprising, adventurous, less predictable choices — bolder genre moves, international where relevant, cult or off-centre — but still anchored in their taste.`;
  }
}

function temperatureForLane(lane: RecommendationLane): number {
  switch (lane) {
    case "left_field": return 0.94;
    case "movie_buff": return 0.91;
    default: return 0.88;
  }
}

export async function generateRecommendationsFromProfile(
  profile: TasteProfile,
  chosenMovies: Movie[],
  lane: RecommendationLane = "mainstream"
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();

  const chosenTitles = chosenMovies.map(m => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map(normalizeTitleKey));

  const exclusionsLine = recentExclusions.length > 0
    ? `Do not recommend these (recently shown): ${recentExclusions.join("; ")}`
    : "";

  const prompt = `Taste profile from A/B funnel:
${profile.tasteSignature}
Genres: ${profile.topGenres.join(", ")}. Themes: ${profile.themes.join(", ")}. Eras: ${profile.preferredEras.join(", ")}.

Based on this, recommend 8 movies they'd genuinely enjoy right now.

${laneInstruction(lane)}

Keep variety across era and tone. At most ${MAX_PRE_1970_FILMS} pre-1970. Include at least one 2020+ if it fits. Movies must be findable in Australia. No micro-budget obscurities. No two same director.
Do not recommend: ${chosenTitles}
${exclusionsLine}

Give short, specific reasons for each — name a film from their choices and explain the connection.

Return JSON only:
{"recommendations":[
{"title":"","year":2000,"reason":"1-2 sentences"},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""}
]}`;

  try {
    const response = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [
        { role: "system", content: "PickAFlick recommender. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1400,
      temperature: temperatureForLane(lane),
    });

    const content = response.choices[0]?.message?.content || "{}";
    let analysis = JSON.parse(content) as { recommendations: AIRecommendationResult[] };

    if (!analysis.recommendations?.length) {
      throw new Error("LLM returned no recommendations");
    }

    const pre1970Count = countPre1970(analysis.recommendations);
    const recentHits = countRecentCollisions(analysis.recommendations, recentTitlesSet);
    if (pre1970Count > MAX_PRE_1970_FILMS || recentHits >= 4) {
      console.warn(`[ai-recommender] Retrying: ${recentHits} collisions, ${pre1970Count} pre-1970`);
      const fixResponse = await openai.chat.completions.create({
        model: RECOMMENDATIONS_MODEL,
        messages: [
          { role: "system", content: "PickAFlick recommender. Respond only with valid JSON." },
          { role: "user", content: `${prompt}\n\nRegenerate: max ${MAX_PRE_1970_FILMS} pre-1970; avoid recent repeats; 8 new titles; JSON only.` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1400,
        temperature: temperatureForLane(lane),
      });
      analysis = JSON.parse(fixResponse.choices[0]?.message?.content || "{}");
    }

    if (!analysis.recommendations?.length) {
      throw new Error("LLM returned no recommendations after retry");
    }

    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    const recPromises = analysis.recommendations.slice(0, 8).map(async (rec) => {
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
        } as Recommendation;
      } catch { return null; }
    });

    const resolvedRecs = (await Promise.all(recPromises)).filter((r): r is Recommendation => r !== null);
    const freshRecs = resolvedRecs.filter((r) => !recentTitlesSet.has(normalizeTitleKey(r.movie.title)));
    const recommendations = (freshRecs.length >= 5 ? freshRecs : resolvedRecs).slice(0, 5);

    recordRecommendedTitles(resolvedRecs.map((r) => r.movie.title));

    return {
      recommendations,
      preferenceProfile: {
        topGenres: profile.topGenres || [],
        themes: profile.themes || [],
        preferredEras: profile.preferredEras || [],
        visualStyle: profile.visualStyle || "",
        mood: profile.mood || "",
      },
    };
  } catch (error) {
    console.error("AI recommendation error:", error);
    return fallbackRecommendations(chosenMovies);
  }
}

// Legacy single-call path (kept for replacement flow)
export async function generateRecommendations(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = [],
  initialGenreFilters: string[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<RecommendationsResponse> {
  const profile = await buildTasteProfile(chosenMovies, rejectedMovies);
  return generateRecommendationsFromProfile(profile, chosenMovies, lane);
}

async function fallbackRecommendations(chosenMovies: Movie[]): Promise<RecommendationsResponse> {
  const allMovies = getAllMovies();
  const fallbackMovies = shuffleArray([...allMovies])
    .filter((m) =>
      !chosenMovies.some((c) => c.tmdbId === m.tmdbId) &&
      m.posterPath?.trim() && m.year && m.year >= 1980 &&
      m.rating && m.rating >= 7.0 &&
      (!m.original_language || m.original_language === "en")
    ).slice(0, 5);

  const fallbackRecs = await Promise.all(
    fallbackMovies.map(async (movie) => {
      const trailerUrls = await getMovieTrailers(movie.tmdbId);
      return { movie, trailerUrl: trailerUrls[0] || null, trailerUrls, reason: "A great pick based on your taste!" } satisfies Recommendation;
    })
  );

  return {
    recommendations: fallbackRecs,
    preferenceProfile: {
      topGenres: extractTopGenres(chosenMovies), themes: [], preferredEras: [],
      visualStyle: "We've matched films to your taste.",
      mood: "Based on your choices, you're in the mood for something that hits the same notes.",
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
  return Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
}

function replacementLaneRules(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream": return `LANE — Mainstream: one accessible, polished pick.`;
    case "movie_buff": return `LANE — Movie Buff: one less obvious, more specific film.`;
    case "left_field": return `LANE — Left Field: one deep, international/arthouse pick.`;
  }
}

export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<Recommendation | null> {
  const picks = chosenMovies.map((m, i) => `R${i + 1}: "${m.title}" (${m.year}) — ${m.director || "?"}`).join("\n");
  const rejHints = rejectedMovies.length > 0
    ? `\nREJECTED: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}"`).join(", ")}`
    : "";

  const prompt = `Curate ONE replacement. Picks:\n${picks}${rejHints}\nSeen/dismissed: ${excludeTmdbIds.length}.\n${replacementLaneRules(lane)}\nFindable in Australia. JSON only:\n{"title":"","year":2000,"reason":"1-2 sentences."}`;

  try {
    const resp = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0.92,
    });
    const result: AIRecommendationResult = JSON.parse(resp.choices[0]?.message?.content || "{}");
    const search = await searchMovieByTitle(result.title, result.year);
    if (!search || excludeTmdbIds.includes(search.id)) return await catalogueFallbackReplacement(excludeTmdbIds);

    const [details, trailers] = await Promise.all([getMovieDetails(search.id), getMovieTrailers(search.id)]);
    if (!details || !details.posterPath?.trim() || trailers.length === 0) return catalogueFallbackReplacement(excludeTmdbIds);

    details.listSource = "replacement";
    return { movie: details, trailerUrl: trailers[0], trailerUrls: trailers, reason: result.reason };
  } catch {
    return catalogueFallbackReplacement(excludeTmdbIds);
  }
}

async function catalogueFallbackReplacement(excludeTmdbIds: number[]): Promise<Recommendation | null> {
  const eligible = shuffleArray(getAllMovies().filter((m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0));
  for (const movie of eligible.slice(0, 10)) {
    if (!movie.posterPath?.trim()) continue;
    const trailerUrls = await getMovieTrailers(movie.tmdbId);
    if (trailerUrls.length === 0) continue;
    return { movie: { ...movie, listSource: "replacement" }, trailerUrl: trailerUrls[0], trailerUrls, reason: `A great pick based on your taste in ${movie.genres.slice(0, 2).join(" and ")} films!` };
  }
  return null;
}
