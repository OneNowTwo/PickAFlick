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

/** gpt-4o-mini is much faster for structured JSON; set OPENAI_RECOMMENDATIONS_MODEL=gpt-4o if you need max quality. */
const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o-mini";

// Cross-session memory — persisted to DB so server restarts don't wipe it
const recentlyRecommendedTitles: string[] = [];
/** Keep a long tail so repeat titles across sessions drop in probability */
const MAX_RECENT_TRACKED = 400;
/** How many recent titles to inject into the prompt (must be ≤ MAX_RECENT_TRACKED). Smaller = faster LLM; collision detection still uses the full in-memory list. */
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
    // Non-fatal — start with empty list
  }
}

/** Warm the cross-session title list on startup so the first request skips a DB round-trip. */
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
  category?: string;
}

interface AIAnalysis {
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
  visualStyle: string;
  mood: string;
  recommendations: AIRecommendationResult[];
}

/** At most this many picks may have theatrical release year strictly before 1970 */
const MAX_PRE_1970_FILMS = 1;

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, "");
}

function countPre1970(recs: { year?: number }[]): number {
  return recs.filter((r) => typeof r.year === "number" && r.year < 1970).length;
}

function countRecentCollisions(recs: { title: string }[], recentSet: Set<string>): number {
  return recs.filter((r) => recentSet.has(normalizeTitleKey(r.title))).length;
}

/** Short system preamble — lane wins over any generic wording below. */
function systemMessageForLane(lane: RecommendationLane): string {
  const labels: Record<RecommendationLane, string> = {
    mainstream: "MAINSTREAM",
    movie_buff: "MOVIE BUFF",
    left_field: "LEFT FIELD",
  };
  return `PickAFlick recommender. Lane: ${labels[lane]}. All picks must match that lane (not generic "best movies"). A/B choices below are the evidence.`;
}

/**
 * Lane instructions — duplicated at end as compliance checklist (models often skip mid-prompt).
 */
function lanePrimaryTask(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `LANE MAINSTREAM: Accessible, crowd-pleasing "good tonight" picks from their A/B pattern. Vary subgenres/eras; not 7 samey films.`;
    case "movie_buff":
      return `LANE MOVIE BUFF: Curated, less obvious — indie/international/auteur over default prestige blockbusters. ≥4/7 not instant household names; max 1 mega-famous foreign title. AU findable.`;
    case "left_field":
      return `LANE LEFT FIELD: Deeper / discovery cinema — not "famous foreign hits" row. ≥5/7 feel like discovery; max 1 household-name prestige title. AU findable.`;
  }
}

function temperatureForLane(lane: RecommendationLane): number {
  switch (lane) {
    case "left_field":
      return 0.94;
    case "movie_buff":
      return 0.91;
    default:
      return 0.88;
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
    max_tokens: 1600,
    temperature,
  });

  const content = response.choices[0]?.message?.content || "{}";
  const finishReason = response.choices[0]?.finish_reason;
  if (finishReason === "length") {
    console.error("[ai-recommender] WARNING: response was cut off at max_tokens — JSON may be incomplete");
  }

  return JSON.parse(content) as AIAnalysis;
}

function getEra(year: number | null): string {
  if (!year) return "unknown";
  if (year >= 2020) return "2020s";
  if (year >= 2010) return "2010s";
  if (year >= 2000) return "2000s";
  if (year >= 1990) return "90s";
  if (year >= 1980) return "80s";
  if (year >= 1970) return "70s";
  if (year >= 1960) return "60s";
  return "pre-60s classic";
}

export async function generateRecommendations(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = [],
  initialGenreFilters: string[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();

  const movieDescriptions = chosenMovies.map((m, index) => {
    const round = index + 1;
    const weight = round >= 5 ? 1.5 : 1.0;
    return {
      title: m.title,
      year: m.year,
      era: getEra(m.year),
      primaryGenre: m.genres[0] || "Unknown",
      allGenres: m.genres,
      overview: (m.overview || "").slice(0, 140),
      director: m.director || "Unknown",
      cast: m.cast?.slice(0, 5) || [],
      keywords: m.keywords?.slice(0, 5) || [],
      rating: m.rating,
      round,
      weight,
    };
  });

  const rejectionContext = rejectedMovies.map((m, index) => {
    const chosenMovie = chosenMovies[index];
    return {
      title: m.title,
      year: m.year,
      primaryGenre: m.genres[0] || "Unknown",
      allGenres: m.genres,
      director: m.director || "Unknown",
      cast: m.cast?.slice(0, 3) || [],
      keywords: m.keywords?.slice(0, 5) || [],
      overview: m.overview,
      lostTo: chosenMovie ? `"${chosenMovie.title}" (${chosenMovie.genres[0]}, dir. ${chosenMovie.director || "Unknown"})` : "unknown",
      round: index + 1,
    };
  });

  // Build exclusion list from cross-session memory (large list → lower repeat rate across sessions)
  const chosenTitles = chosenMovies.map(m => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map((t) => normalizeTitleKey(t)));

  const filterContext = initialGenreFilters.length > 0
    ? `Mood hint (weak): ${initialGenreFilters.join(", ")}. `
    : "";

  const laneTask = lanePrimaryTask(lane);

  const choicesBlock = movieDescriptions
    .map(
      (m) =>
        `R${m.round}${m.weight > 1 ? "*" : ""}: "${m.title}" (${m.year}) ${m.primaryGenre} | ${m.director} | kw:${m.keywords.slice(0, 3).join(",") || "—"} | ${m.overview || "—"}`
    )
    .join("\n");

  const rejectsBlock =
    rejectionContext.length > 0
      ? rejectionContext.map((m) => `R${m.round}: no "${m.title}" (${m.year}) — picked ${m.lostTo}`).join("\n")
      : "(none)";

  const exclusionsBlock =
    recentExclusions.length > 0 ? `Do not repeat: ${recentExclusions.join("; ")}` : "";

  const prompt = `${laneTask}

${filterContext}7-round A/B funnel. Infer one taste profile; rounds marked * matter more. Real films, English titles, accurate year. Max ${MAX_PRE_1970_FILMS} film(s) before 1970; include a 2020s title when it fits. No two same director. No picks from: ${chosenTitles}

${exclusionsBlock}

CHOSEN:
${choicesBlock}

REJECTED:
${rejectsBlock}

Return JSON only. recommendations must have exactly 7 objects:
{"topGenres":["",""],"themes":[""],"preferredEras":[""],"visualStyle":"","mood":"","recommendations":[
{"title":"","year":2000,"reason":"One sentence; cite a chosen film."},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""},
{"title":"","year":2000,"reason":""}
]}`;

  try {
    const llmTemp = temperatureForLane(lane);
    let analysis = await callRecommendationsLLM(prompt, llmTemp, systemMessageForLane(lane));

    if (!analysis.recommendations || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      console.error("[ai-recommender] LLM returned no recommendations array. Keys:", Object.keys(analysis));
      throw new Error("LLM returned no recommendations");
    }

    const recentHits = countRecentCollisions(analysis.recommendations, recentTitlesSet);
    const pre1970Count = countPre1970(analysis.recommendations);
    const needsRetry = pre1970Count > MAX_PRE_1970_FILMS || recentHits >= 4;

    if (needsRetry) {
      console.warn(
        `[ai-recommender] Retrying LLM: ${recentHits} recent-title collision(s), ${pre1970Count} pre-1970 pick(s) (max ${MAX_PRE_1970_FILMS})`
      );
      const fixPrompt = `${prompt}

Regenerate: max ${MAX_PRE_1970_FILMS} pre-1970 film(s); avoid recent-session repeats; 7 new titles; JSON only.`;
      analysis = await callRecommendationsLLM(fixPrompt, llmTemp, systemMessageForLane(lane));
    }

    if (!analysis.recommendations || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      throw new Error("LLM returned no recommendations after retry");
    }

    const pre1970After = countPre1970(analysis.recommendations);
    if (pre1970After > MAX_PRE_1970_FILMS) {
      console.warn(`[ai-recommender] pre-1970 count ${pre1970After} still exceeds cap ${MAX_PRE_1970_FILMS} after retry`);
    }

    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    // Resolve all 7 LLM recommendations in parallel — poster + trailer required
    const recPromises = analysis.recommendations.map(async (rec) => {
      try {
        const searchResult = await searchMovieByTitle(rec.title, rec.year);

        if (!searchResult || chosenTmdbIds.has(searchResult.id)) {
          return null;
        }

        const [movieDetails, tmdbTrailers] = await Promise.all([
          getMovieDetails(searchResult.id),
          getMovieTrailers(searchResult.id),
        ]);

        if (!movieDetails) return null;

        if (!movieDetails.posterPath || !movieDetails.posterPath.trim()) {
          console.log(`Skipping "${movieDetails.title}" - no poster`);
          return null;
        }

        if (tmdbTrailers.length === 0) {
          console.log(`Skipping "${movieDetails.title}" - no trailer`);
          return null;
        }

        movieDetails.listSource = "ai-recommendation";

        return {
          movie: movieDetails,
          trailerUrl: tmdbTrailers[0],
          trailerUrls: tmdbTrailers,
          reason: rec.reason,
        } as Recommendation;
      } catch (error) {
        console.error(`Failed to resolve recommendation "${rec.title}":`, error);
        return null;
      }
    });

    const resolvedRecs = (await Promise.all(recPromises)).filter((r): r is Recommendation => r !== null);

    // Code-level repetition guard — filter out titles already in cross-session memory.
    // Only apply if it leaves enough results; if the LLM picked mostly fresh films this
    // is a no-op. If the filter is too aggressive, fall back to full resolved list.
    const freshRecs = resolvedRecs.filter(
      (r) => !recentTitlesSet.has(normalizeTitleKey(r.movie.title))
    );
    const dedupedRecs = freshRecs.length >= 4 ? freshRecs : resolvedRecs;

    const mainRecs = dedupedRecs.slice(0, 6);
    const recommendations: Recommendation[] = [...mainRecs];

    // Record every AI-resolved title so repeats across sessions drop (not only the 6 shown)
    recordRecommendedTitles(resolvedRecs.map((r) => r.movie.title));

    // Wildcard: try up to 10 candidates from catalogue until one passes poster + trailer
    const allMovies = getAllMovies();
    const usedTmdbIds = new Set([
      ...Array.from(chosenTmdbIds),
      ...recommendations.map((r) => r.movie.tmdbId),
    ]);

    const eligibleWildcards = shuffleArray(
      allMovies.filter((m) => !usedTmdbIds.has(m.tmdbId) && m.rating && m.rating >= 7.0)
    );

    let wildcardAdded = false;
    const wildcardCandidates = eligibleWildcards
      .filter((m) => m.posterPath && m.posterPath.trim())
      .slice(0, 10);
    const trailerResults =
      wildcardCandidates.length > 0
        ? await Promise.all(
            wildcardCandidates.slice(0, 5).map(async (candidate) => ({
              candidate,
              trailers: await getMovieTrailers(candidate.tmdbId),
            }))
          )
        : [];
    const firstWildcard = trailerResults.find((r) => r.trailers.length > 0);
    if (firstWildcard) {
      const { candidate, trailers } = firstWildcard;
      recommendations.push({
        movie: { ...candidate, listSource: "wildcard" },
        trailerUrl: trailers[0],
        trailerUrls: trailers,
        reason: `A surprise pick from our curated collection — this ${candidate.genres.slice(0, 2).join("/")} film from ${candidate.year} might just become your next favourite.`,
      });
      wildcardAdded = true;
    }

    // If wildcard failed, use 6th AI backup
    if (!wildcardAdded && resolvedRecs.length >= 6) {
      recommendations.push(resolvedRecs[5]);
    }

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

    // Fallback: return random catalogue movies
    const allMovies = getAllMovies();
    const fallbackMovies = shuffleArray([...allMovies])
      .filter((m) =>
        !chosenMovies.some((c) => c.tmdbId === m.tmdbId) &&
        m.posterPath && m.posterPath.trim() &&
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
    const sampleTitles = chosenMovies.slice(0, 2).map((m) => m.title).join(" and ");
    return {
      recommendations: fallbackRecs,
      preferenceProfile: {
        topGenres,
        themes: [],
        preferredEras: [],
        visualStyle: sampleTitles
          ? `You enjoy films like "${sampleTitles}" — we've matched that vibe.`
          : "We've matched films to your taste.",
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
      return `LANE — **Mainstream:** one accessible, polished pick that matches their A/B taste (default "good tonight" energy).`;
    case "movie_buff":
      return `LANE — **Movie Buff:** do **not** pick the same kind of obvious blockbuster row. One **less obvious, more specific** film that still fits their funnel — indie / international / auteur energy OK; findable in Australia.`;
    case "left_field":
      return `LANE — **Left Field:** one **deep** pick — international / arthouse / critical darling energy that **still** maps to their A/B pattern; must be plausibly watchable in Australia; not random.`;
  }
}

// Generate a single replacement recommendation when user marks one as "seen it"
export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = [],
  lane: RecommendationLane = "mainstream"
): Promise<Recommendation | null> {
  const movieDescriptions = chosenMovies.map((m, index) => {
    const round = index + 1;
    const weight = round >= 5 ? 1.5 : 1.0;
    return {
      title: m.title,
      year: m.year,
      genres: m.genres,
      director: m.director || "Unknown",
      cast: m.cast?.slice(0, 5) || [],
      keywords: m.keywords?.slice(0, 10) || [],
      round,
      weight,
    };
  });

  const rejectionHints = rejectedMovies.length > 0
    ? `\n\nThey REJECTED: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}" (${m.genres[0]})`).join(", ")} — avoid similar style/tone.`
    : "";

  const randomSeed = Math.floor(Math.random() * 100000);
  const currentYear = new Date().getFullYear();
  const recentThreshold = currentYear - 3;

  const categories = ["recent", "classic", "flexible"] as const;
  const targetCategory = categories[Math.floor(Math.random() * categories.length)];

  let categoryInstruction = "";
  switch (targetCategory) {
    case "recent":
      categoryInstruction = `Pick a RECENT, widely recognisable film (${recentThreshold}–${currentYear}) that fits their unified taste — not obscure.`;
      break;
    case "classic":
      categoryInstruction = `Pick a famous, highly-rated classic (pre-2010) that fits the same emotional register as their picks.`;
      break;
    default:
      categoryInstruction = `Pick one film from any era that fits their overall funnel profile — must be recognisable to a general audience (no obscure festival picks).`;
  }

  const prompt = `You're curating ONE replacement pick for someone who already has recommendations. Infer a single coherent taste profile from their funnel (not round-by-round quotas).

Their picks:
${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥" : ""}: "${m.title}" (${m.year}) — Director: ${m.director}, Cast: ${m.cast.join(", ") || "Unknown"}, Themes: ${m.keywords.join(", ") || "N/A"}`).join("\n")}${rejectionHints}

They've already seen or dismissed ${excludeTmdbIds.length} suggestions — avoid repeating that list.

${replacementLaneRules(lane)}

${categoryInstruction}

Rules: stay tonally consistent with their choices; IMDb 7.0+; well-known enough to find in Australia. [Seed: ${randomSeed}]

Respond in JSON:
{
  "title": "Movie Title",
  "year": 2020,
  "reason": "1-2 sentences using 'you'/'your', referencing their specific picks and at least one intangible quality (pacing/feel/texture/tone)"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 250,
      temperature: 0.92,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const result: AIRecommendationResult = JSON.parse(content);

    const searchResult = await searchMovieByTitle(result.title, result.year);

    if (!searchResult || excludeTmdbIds.includes(searchResult.id)) {
      // Fallback: try catalogue
      return await catalogueFallbackReplacement(excludeTmdbIds);
    }

    const [movieDetails, tmdbTrailers] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id),
    ]);

    if (!movieDetails) return catalogueFallbackReplacement(excludeTmdbIds);

    if (!movieDetails.posterPath || !movieDetails.posterPath.trim()) {
      console.log(`Skipping replacement "${movieDetails.title}" - no poster`);
      return catalogueFallbackReplacement(excludeTmdbIds);
    }

    if (tmdbTrailers.length === 0) {
      console.log(`Skipping replacement "${movieDetails.title}" - no trailer`);
      return catalogueFallbackReplacement(excludeTmdbIds);
    }

    // No hard streaming filter — most films are available to rent/buy
    movieDetails.listSource = "replacement";

    return {
      movie: movieDetails,
      trailerUrl: tmdbTrailers[0],
      trailerUrls: tmdbTrailers,
      reason: result.reason,
    };
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
    if (!movie.posterPath || !movie.posterPath.trim()) continue;
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
