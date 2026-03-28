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
    const merged = [...new Set(saved.map(normalizeTitleKey))];
    recentlyRecommendedTitles.push(...merged);
    console.log(`[recent-recs] Loaded ${merged.length} previously recommended titles from DB`);
  } catch {
    // Non-fatal
  }
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

interface AIRecommendationResult {
  title: string;
  year?: number;
  reason: string;
}

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

// ── Lane prompts (user-authored, clear and differentiated) ──────────

function lanePromptBlock(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `Important: this is the Mainstream lane.

That means:
- recommendations should still be tailored to my taste from the A/B results
- but they should lean toward recognisable, polished, accessible films
- broadly liked, high-confidence, "good tonight watch" picks
- not lazy generic blockbusters, but films with reach, momentum, and clear watchability
- avoid five films that all feel cut from the same cloth

Output:
For each recommendation, give a short but specific explanation of why it fits my selections.`;

    case "movie_buff":
      return `Important: this is the Movie Buff lane.

That means:
- recommendations should be more curated, more discerning, and less default than the obvious mainstream picks
- do not just return the usual internet-canon films or prestige/blockbuster titles that always show up
- include stronger film-lover picks, including acclaimed indies, smart genre films, A24-type films where appropriate, and more specific/director-led choices
- still keep the results aligned with my inferred taste and mood
- still recommend films I would plausibly want to watch tonight
- avoid micro-budget obscurities or "homework" picks that feel too niche or punishing

Output:
For each recommendation, give a short but specific explanation of why it fits my selections and why it belongs in the Movie Buff lane rather than the obvious mainstream one.`;

    case "left_field":
      return `Important: this is the Left Field lane.

That means:
- recommendations should still be anchored in my A/B-inferred taste
- but they should allow for more surprising, unusual, adventurous, and less predictable choices
- this is the place for stranger tonal swings, bolder genre moves, international titles where relevant, more cult or off-centre picks, and films that feel fresh rather than default
- do not make the list random or deliberately weird for the sake of it
- every pick still needs to feel like a believable recommendation for my taste and current mood

Output:
For each recommendation, give a short but specific explanation of why it fits my selections and why it is a Left Field recommendation rather than a safer or more obvious one.`;
  }
}

function temperatureForLane(lane: RecommendationLane): number {
  switch (lane) {
    case "left_field": return 0.94;
    case "movie_buff": return 0.91;
    default: return 0.88;
  }
}

async function callRecommendationsLLM(
  promptText: string,
  temperature = 0.88,
  systemMessage?: string
): Promise<AIAnalysis> {
  const messages = systemMessage
    ? [
        { role: "system" as const, content: systemMessage },
        { role: "user" as const, content: promptText },
      ]
    : [{ role: "user" as const, content: promptText }];
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages,
    response_format: { type: "json_object" },
    max_tokens: 1200,
    temperature,
  });

  const content = response.choices[0]?.message?.content || "{}";
  return JSON.parse(content) as AIAnalysis;
}

// ── Main recommendation generator ───────────────────────────────────

export async function generateRecommendations(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = [],
  initialGenreFilters: string[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();

  const choicesBlock = chosenMovies.map((m, i) => {
    const round = i + 1;
    const star = round >= 5 ? "*" : "";
    return `R${round}${star}: "${m.title}" (${m.year}) — ${m.genres[0] || "Unknown"}, dir. ${m.director || "Unknown"}, kw: ${(m.keywords || []).slice(0, 4).join(", ") || "—"}`;
  }).join("\n");

  const rejectsBlock = rejectedMovies.length > 0
    ? rejectedMovies.map((m, i) => {
        const chosen = chosenMovies[i];
        return `R${i + 1}: rejected "${m.title}" (${m.year}) — chose "${chosen?.title}"`;
      }).join("\n")
    : "(none)";

  const chosenTitles = chosenMovies.map(m => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map(normalizeTitleKey));

  const exclusionsLine = recentExclusions.length > 0
    ? `\nDo not recommend these (recently shown): ${recentExclusions.join("; ")}\n`
    : "";

  const prompt = `These are the results of my A/B testing funnel. Rounds marked * matter more.

Based on those selections, recommend 5 movies I am most likely in the mood for and would genuinely enjoy right now.

You should infer my taste from the choices and analyse:
title, year, primary genre, director, cast, keywords, synopsis, subgenre, era, pacing, tone, and overall vibe.

${lanePromptBlock(lane)}

Constraints:
- exactly 5 films
- at most ${MAX_PRE_1970_FILMS} film released before 1970
- among 1970+ picks, spread across decades
- include at least one 2020+ film when it fits naturally
- films should be findable in Australia
- no micro-budget obscurities
- keep variety in pacing, texture, and energy while staying true to the inferred taste
- no two from the same director
- do not recommend any film I chose in the funnel: ${chosenTitles}
${exclusionsLine}
CHOSEN (what I picked):
${choicesBlock}

REJECTED (what I passed on):
${rejectsBlock}

Return JSON only:
{"topGenres":["",""],"themes":[""],"preferredEras":[""],"visualStyle":"short","mood":"short","recommendations":[
{"title":"Film Title","year":2000,"reason":"Short specific explanation."},
{"title":"Film Title","year":2000,"reason":""},
{"title":"Film Title","year":2000,"reason":""},
{"title":"Film Title","year":2000,"reason":""},
{"title":"Film Title","year":2000,"reason":""}
]}`;

  try {
    const llmTemp = temperatureForLane(lane);
    const systemMsg = `PickAFlick recommender. Respond only with valid JSON matching the schema.`;
    let analysis = await callRecommendationsLLM(prompt, llmTemp, systemMsg);

    if (!analysis.recommendations?.length) {
      throw new Error("LLM returned no recommendations");
    }

    const pre1970Count = countPre1970(analysis.recommendations);
    const recentHits = countRecentCollisions(analysis.recommendations, recentTitlesSet);
    if (pre1970Count > MAX_PRE_1970_FILMS || recentHits >= 4) {
      console.warn(`[ai-recommender] Retrying: ${recentHits} collisions, ${pre1970Count} pre-1970`);
      const fixPrompt = `${prompt}\n\nRegenerate: max ${MAX_PRE_1970_FILMS} pre-1970; avoid recent repeats; 5 new titles; JSON only.`;
      analysis = await callRecommendationsLLM(fixPrompt, llmTemp, systemMsg);
    }

    if (!analysis.recommendations?.length) {
      throw new Error("LLM returned no recommendations after retry");
    }

    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    const recPromises = analysis.recommendations.slice(0, 5).map(async (rec) => {
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
      } catch {
        return null;
      }
    });

    const resolvedRecs = (await Promise.all(recPromises)).filter((r): r is Recommendation => r !== null);

    const freshRecs = resolvedRecs.filter(
      (r) => !recentTitlesSet.has(normalizeTitleKey(r.movie.title))
    );
    const recommendations = (freshRecs.length >= 3 ? freshRecs : resolvedRecs).slice(0, 5);

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

    const allMovies = getAllMovies();
    const fallbackMovies = shuffleArray([...allMovies])
      .filter((m) =>
        !chosenMovies.some((c) => c.tmdbId === m.tmdbId) &&
        m.posterPath?.trim() &&
        m.year && m.year >= 1980 &&
        m.rating && m.rating >= 7.0 &&
        (!m.original_language || m.original_language === "en")
      )
      .slice(0, 5);

    const fallbackRecs = await Promise.all(
      fallbackMovies.map(async (movie) => {
        const trailerUrls = await getMovieTrailers(movie.tmdbId);
        return {
          movie,
          trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
          trailerUrls,
          reason: "A great pick based on your taste!",
        } satisfies Recommendation;
      })
    );

    const topGenres = extractTopGenres(chosenMovies);
    return {
      recommendations: fallbackRecs,
      preferenceProfile: {
        topGenres,
        themes: [],
        preferredEras: [],
        visualStyle: "We've matched films to your taste.",
        mood: "Based on your choices, you're in the mood for something that hits the same notes.",
      },
    };
  }
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
    for (const genre of movie.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }
  return Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([genre]) => genre);
}

function replacementLaneRules(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `LANE — Mainstream: one accessible, polished pick that matches their A/B taste.`;
    case "movie_buff":
      return `LANE — Movie Buff: one less obvious, more specific film — indie/international/auteur energy OK; findable in Australia.`;
    case "left_field":
      return `LANE — Left Field: one deep pick — international/arthouse/critical darling energy that still maps to their A/B pattern; watchable in Australia.`;
  }
}

export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<Recommendation | null> {
  const movieDescriptions = chosenMovies.map((m, index) => {
    const round = index + 1;
    const weight = round >= 5 ? 1.5 : 1.0;
    return { title: m.title, year: m.year, genres: m.genres, director: m.director || "Unknown", round, weight };
  });

  const rejectionHints = rejectedMovies.length > 0
    ? `\nREJECTED: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}" (${m.genres[0]})`).join(", ")}`
    : "";

  const prompt = `Curate ONE replacement pick. Infer taste from their funnel.

Picks:
${movieDescriptions.map((m) => `R${m.round}${m.weight > 1 ? "*" : ""}: "${m.title}" (${m.year}) — ${m.director}`).join("\n")}${rejectionHints}

They've seen/dismissed ${excludeTmdbIds.length} titles already.

${replacementLaneRules(lane)}

Rules: tonally consistent; findable in Australia. JSON only:
{"title":"","year":2000,"reason":"1-2 sentences referencing their picks."}`;

  try {
    const response = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0.92,
    });

    const result: AIRecommendationResult = JSON.parse(response.choices[0]?.message?.content || "{}");
    const searchResult = await searchMovieByTitle(result.title, result.year);

    if (!searchResult || excludeTmdbIds.includes(searchResult.id)) {
      return await catalogueFallbackReplacement(excludeTmdbIds);
    }

    const [movieDetails, tmdbTrailers] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id),
    ]);

    if (!movieDetails || !movieDetails.posterPath?.trim() || tmdbTrailers.length === 0) {
      return catalogueFallbackReplacement(excludeTmdbIds);
    }

    movieDetails.listSource = "replacement";
    return { movie: movieDetails, trailerUrl: tmdbTrailers[0], trailerUrls: tmdbTrailers, reason: result.reason };
  } catch (error) {
    console.error("Failed to generate replacement:", error);
    return catalogueFallbackReplacement(excludeTmdbIds);
  }
}

async function catalogueFallbackReplacement(excludeTmdbIds: number[]): Promise<Recommendation | null> {
  const allMovies = getAllMovies();
  const eligible = shuffleArray(
    allMovies.filter((m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0)
  );

  for (const movie of eligible.slice(0, 10)) {
    if (!movie.posterPath?.trim()) continue;
    const trailerUrls = await getMovieTrailers(movie.tmdbId);
    if (trailerUrls.length === 0) continue;

    return {
      movie: { ...movie, listSource: "replacement" },
      trailerUrl: trailerUrls[0],
      trailerUrls,
      reason: `A great pick based on your taste in ${movie.genres.slice(0, 2).join(" and ")} films!`,
    };
  }
  return null;
}
