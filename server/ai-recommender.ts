import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailer, getMovieTrailers, getMovieDetails, getWatchProviders } from "./tmdb";
import { getAllMovies } from "./catalogue";
import { storage } from "./storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Cross-session memory — persisted to DB so server restarts don't wipe it
const recentlyRecommendedTitles: string[] = [];
const MAX_RECENT_TRACKED = 200;
let recsLoaded = false;

async function ensureRecsLoaded(): Promise<void> {
  if (recsLoaded) return;
  recsLoaded = true;
  try {
    const saved = await storage.getRecentRecommendations();
    recentlyRecommendedTitles.push(...saved);
    console.log(`[recent-recs] Loaded ${saved.length} previously recommended titles from DB`);
  } catch {
    // Non-fatal — start with empty list
  }
}

function recordRecommendedTitles(titles: string[]): void {
  for (const t of titles) {
    const normalised = t.toLowerCase().trim();
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
  initialGenreFilters: string[] = []
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
      overview: m.overview,
      director: m.director || "Unknown",
      cast: m.cast?.slice(0, 5) || [],
      keywords: m.keywords?.slice(0, 10) || [],
      rating: m.rating,
      round,
      weight,
    };
  });

  // Rich rejection context including all metadata — the negative signal is just as important
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

  // Build exclusion list from cross-session memory
  const chosenTitles = chosenMovies.map(m => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-50);

  const filterContext = initialGenreFilters.length > 0
    ? `\nStarting mood (supporting only): the user hinted at these genres before the funnel: ${initialGenreFilters.join(", ")}. The A/B evidence below is the primary signal — use the funnel profile first.\n`
    : "";

  const prompt = `You are a sharp film curator. The user finished a 7-step head-to-head funnel — NOT seven unrelated tests. Think of it as ONE narrowing path: early rounds explore contrast; later rounds (marked 🔥) matter more. Your job is to infer ONE unified "tonight" profile, then pick 7 films that feel like a single coherent shortlist from one movie buff who knows their taste — not seven separate answers to seven separate questions.${filterContext}

${recentExclusions.length > 0 ? `=== DO NOT RECOMMEND — already shown in recent sessions ===
${recentExclusions.map(t => `• ${t}`).join("\n")}

` : ""}Never recommend these (their own picks): ${chosenTitles}

=== EVIDENCE — what they chose (rounds 5–7 🔥 weighted more) ===
${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥" : ""}: "${m.title}" (${m.year}) — ${m.primaryGenre} | Dir: ${m.director} | Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
  Keywords: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
  Synopsis: ${m.overview || "N/A"}`).join("\n\n")}

=== EVIDENCE — what they rejected (negative signal; use to sharpen the profile) ===
${rejectionContext.length > 0 ? rejectionContext.map((m) => `Round ${m.round}: rejected "${m.title}" (${m.year}, ${m.primaryGenre}) vs chose ${m.lostTo}`).join("\n\n") : "No rejection data"}

=== STEP 1 — UNIFIED PROFILE (do this mentally before picking) ===
Synthesize ONE profile for "what they want tonight": tone, pacing, era band, how "prestige" vs mainstream, subgenre lean, and what rejections ruled OUT. Rounds 🔥 pull the profile more than early rounds. Do not treat round 2 as "give them a comedy" unless the whole funnel says comedy is central.

=== STEP 2 — PICK 7 FILMS AS ONE SET ===
- Coherence: every pick should feel like it belongs to the SAME evening and the SAME emotional register as the profile. Avoid "quota filling" (e.g. forcing one comedy, one thriller) unless the profile genuinely spans that.
- Anti-cluster: do NOT default to the same overused "prestige slow-burn psychological thriller" canon (same few critically famous titles that models repeat). Only lean that way if their choices clearly point there. If their profile is broader, show breadth in subgenre and era while staying tonally unified.
- Recognisability: titles must be widely known to a general Australian audience — household-name level or obvious classics. If older, pick famous, highly-rated classics — not obscure festival picks.
- Quality: IMDb ~6.5+ territory, broadly popular; English-language or internationally famous; findable in Australia; no micro-budget or ultra-obscure low-vote titles.
- Constraints: no two films from the same director or same franchise. Prefer a natural spread of release years when it fits the profile — do NOT force "one recent + one old" if it would feel random vs their funnel.

=== OUTPUT — exact JSON only ===
{
  "topGenres": ["3 genres that summarise the UNIFIED profile, not one genre per round"],
  "themes": ["2-4 thematic through-lines for tonight"],
  "preferredEras": ["decade bands that fit the unified profile"],
  "visualStyle": "One sentence, 'you/your', how their choices look and feel on screen (texture, pacing, colour/lighting in plain words if keywords support it)",
  "mood": "One sentence, 'you/your', the emotional register for tonight",
  "recommendations": [
    {"title": "Film Title 1", "year": 2022, "reason": "1-2 sentences: tie to their unified profile; name 1-2 of their actual picks; same register as the set", "category": "flexible"},
    {"title": "Film Title 2", "year": 1999, "reason": "same", "category": "flexible"},
    {"title": "Film Title 3", "year": 2016, "reason": "same", "category": "flexible"},
    {"title": "Film Title 4", "year": 2014, "reason": "same", "category": "flexible"},
    {"title": "Film Title 5", "year": 2019, "reason": "same", "category": "flexible"},
    {"title": "Film Title 6", "year": 2011, "reason": "same", "category": "flexible"},
    {"title": "Film Title 7", "year": 2008, "reason": "same", "category": "flexible"}
  ]
}

Return exactly 7 recommendations. Each reason must name at least one of their actual chosen films.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2200,
      temperature: 0.82,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === "length") {
      console.error("[ai-recommender] WARNING: response was cut off at max_tokens — JSON may be incomplete");
    }

    const analysis: AIAnalysis = JSON.parse(content);

    if (!analysis.recommendations || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      console.error("[ai-recommender] LLM returned no recommendations array. Keys:", Object.keys(analysis));
      throw new Error("LLM returned no recommendations");
    }

    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    // Resolve all 7 LLM recommendations in parallel — poster + trailer required
    const recPromises = analysis.recommendations.map(async (rec) => {
      try {
        const searchResult = await searchMovieByTitle(rec.title, rec.year);

        if (!searchResult || chosenTmdbIds.has(searchResult.id)) {
          return null;
        }

        const [movieDetails, tmdbTrailers, watchProviders] = await Promise.all([
          getMovieDetails(searchResult.id),
          getMovieTrailers(searchResult.id),
          getWatchProviders(searchResult.id, rec.title, rec.year),
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

        // Streaming data enriches the result but is NOT a hard filter —
        // most films are available to rent/buy even if not indexed in TMDb AU providers
        movieDetails.listSource = "ai-recommendation";

        return {
          movie: movieDetails,
          trailerUrl: tmdbTrailers[0],
          trailerUrls: tmdbTrailers,
          reason: rec.reason,
          watchProviders,
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
    const recentTitlesSet = new Set(recentlyRecommendedTitles.map(t => t.toLowerCase().trim()));
    const freshRecs = resolvedRecs.filter(r =>
      !recentTitlesSet.has(r.movie.title.toLowerCase().trim())
    );
    const dedupedRecs = freshRecs.length >= 4 ? freshRecs : resolvedRecs;

    const mainRecs = dedupedRecs.slice(0, 6);
    const recommendations: Recommendation[] = [...mainRecs];

    // Record what resolved so future sessions explore different films
    recordRecommendedTitles(mainRecs.map(r => r.movie.title));

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
    for (const candidate of eligibleWildcards.slice(0, 10)) {
      if (!candidate.posterPath || !candidate.posterPath.trim()) continue;

      const [wildcardTrailers, wildcardProviders] = await Promise.all([
        getMovieTrailers(candidate.tmdbId),
        getWatchProviders(candidate.tmdbId, candidate.title, candidate.year),
      ]);

      if (wildcardTrailers.length === 0) continue;

      recommendations.push({
        movie: { ...candidate, listSource: "wildcard" },
        trailerUrl: wildcardTrailers[0],
        trailerUrls: wildcardTrailers,
        reason: `A surprise pick from our curated collection — this ${candidate.genres.slice(0, 2).join("/")} film from ${candidate.year} might just become your next favourite.`,
      });
      wildcardAdded = true;
      break;
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

    const fallbackRecs: Recommendation[] = [];
    for (const movie of fallbackMovies) {
      const trailerUrls = await getMovieTrailers(movie.tmdbId);
      fallbackRecs.push({
        movie,
        trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
        trailerUrls,
        reason: "A great pick based on your taste!",
      });
    }

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

// Generate a single replacement recommendation when user marks one as "seen it"
export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = []
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

${categoryInstruction}

Rules: stay tonally consistent with their choices; prefer household-name films; IMDb 7.0+; well-known in English-speaking markets. [Seed: ${randomSeed}]

Respond in JSON:
{
  "title": "Movie Title",
  "year": 2020,
  "reason": "1-2 sentences using 'you'/'your', referencing their specific picks and at least one intangible quality (pacing/feel/texture/tone)"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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

    const [movieDetails, tmdbTrailers, watchProviders] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id),
      getWatchProviders(searchResult.id, result.title, result.year || null),
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
