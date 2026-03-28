import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse, RecommendationLane } from "@shared/schema";
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
/** Larger list reduces "same movies every time" without huge prompt bloat */
const RECENT_EXCLUSIONS_PROMPT_COUNT = 72;
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

interface AIAnalysis {
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
  visualStyle: string;
  mood: string;
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
    case "left_field": return 0.9;
    case "movie_buff": return 0.86;
    default: return 0.82;
  }
}

async function callRecommendationsLLM(
  promptText: string,
  temperature: number,
  maxTokens: number
): Promise<AIAnalysis> {
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: "PickAFlick recommender. Respond only with valid JSON matching the schema." },
      { role: "user", content: promptText },
    ],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature,
  });
  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AIAnalysis;
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

async function resolveOneRecommendation(
  rec: AIRecommendationResult,
  chosenTmdbIds: Set<number>
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
    };
  } catch {
    return null;
  }
}


export async function generateRecommendations(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = [],
  initialGenreFilters: string[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();

  const choicesBlock = formatChoicesBlock(chosenMovies);
  const rejectsBlock = formatRejectsBlock(rejectedMovies, chosenMovies);
  const chosenTitles = chosenMovies.map((m) => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map(normalizeTitleKey));

  const exclusionsLine = recentExclusions.length > 0
    ? `\nDo not recommend these titles (recently shown to users): ${recentExclusions.join("; ")}\n`
    : "";

  const genreFilterLine = initialGenreFilters.length > 0
    ? `\nOptional funnel filters (respect if they still fit the mood): ${initialGenreFilters.join(", ")}.\n`
    : "";

  const diversityBlock = `
Diversity (critical):
- No two picks from the same director.
- No two picks from the same franchise / shared universe (e.g. MCU, Star Wars, Fast).
- Spread subgenres and tones — do not output five films that feel like the same "type".
- Avoid the same handful of famous titles that always appear in generic lists; dig for films that still fit the lane and the user's pattern.`;

  const prompt = `These are the results of my A/B testing funnel. Rounds marked * matter more.

CHOSEN:
${choicesBlock}

PASSED ON:
${rejectsBlock}
${genreFilterLine}
Based on those selections, recommend 8 movies I'm most likely in the mood for right now.

${laneInstruction(lane)}

Keep variety across era and tone. At most ${MAX_PRE_1970_FILMS} film before 1970. Include at least one 2020+ if it fits naturally. Movies must be findable / streamable in Australia. No micro-budget obscurities.
Do not recommend any film I chose in the funnel: ${chosenTitles}
${exclusionsLine}
${diversityBlock}

Give short, specific reasons — name one of my chosen films and explain the connection (tone, pacing, texture, genre), not generic praise.

Return JSON only:
{"topGenres":["","",""],"themes":["",""],"preferredEras":["",""],"visualStyle":"one sentence using you/your","mood":"one sentence using you/your","recommendations":[
{"title":"Film Title","year":2000,"reason":"1-2 sentences"},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""}
]}`;

  const llmTemp = temperatureForLane(lane);
  const maxTokens = 2000;

  try {
    let analysis = await callRecommendationsLLM(prompt, llmTemp, maxTokens);

    if (!analysis.recommendations?.length) {
      throw new Error("LLM returned no recommendations");
    }

    const pre1970Count = countPre1970(analysis.recommendations);
    const recentHits = countRecentCollisions(analysis.recommendations, recentTitlesSet);
    if (pre1970Count > MAX_PRE_1970_FILMS || recentHits >= 3) {
      console.warn(`[ai-recommender] Retrying: ${recentHits} recent collisions, ${pre1970Count} pre-1970`);
      const fixPrompt = `${prompt}\n\nRegenerate entirely: max ${MAX_PRE_1970_FILMS} pre-1970; avoid titles in the recent-shown list; 8 new titles; keep diversity rules; JSON only.`;
      analysis = await callRecommendationsLLM(fixPrompt, llmTemp, maxTokens);
    }

    if (!analysis.recommendations?.length) {
      throw new Error("LLM returned no recommendations after retry");
    }

    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));
    const resolvedRecs = (
      await Promise.all(
        analysis.recommendations.slice(0, 8).map((r) => resolveOneRecommendation(r, chosenTmdbIds))
      )
    ).filter((x): x is Recommendation => x !== null);

    const freshRecs = resolvedRecs.filter((r) => !recentTitlesSet.has(normalizeTitleKey(r.movie.title)));
    const recommendations = (freshRecs.length >= 5 ? freshRecs : resolvedRecs).slice(0, 5);

    recordRecommendedTitles(resolvedRecs.map((r) => r.movie.title));

    return {
      recommendations,
      preferenceProfile: {
        topGenres: analysis.topGenres || [],
        themes: analysis.themes || [],
        preferredEras: analysis.preferredEras || [],
        visualStyle: analysis.visualStyle || "",
        mood: analysis.mood || "",
      },
    };
  } catch (error) {
    console.error("AI recommendation error:", error);
    return fallbackRecommendations(chosenMovies);
  }
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

  const prompt = `Curate ONE replacement. Picks:\n${picks}${rejHints}\nSeen/dismissed: ${excludeTmdbIds.length}.\n${replacementLaneRules(lane)}\nFindable in Australia. Avoid repeating obvious franchise defaults. JSON only:\n{"title":"","year":2000,"reason":"1-2 sentences."}`;

  try {
    const resp = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0.88,
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
