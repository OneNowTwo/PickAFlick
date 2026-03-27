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

  const currentYear = new Date().getFullYear();
  const recentThreshold = currentYear - 3;

  const filterContext = initialGenreFilters.length > 0
    ? `\nThe user selected these genres as their starting mood: ${initialGenreFilters.join(", ")}. Use this as supporting context — it confirms direction but the A/B data below is the primary signal.\n`
    : "";

  const prompt = `You are an expert film recommender. A user just completed a head-to-head movie picker — 7 choices, 7 rejections. Use the CONTRAST between what they chose vs rejected to identify their exact taste, then recommend films that fit that specific profile.${filterContext}

${recentExclusions.length > 0 ? `=== DO NOT RECOMMEND — already shown in recent sessions ===
${recentExclusions.map(t => `• ${t}`).join("\n")}

` : ""}User's own picks (exclude these too): ${chosenTitles}

=== WHAT THEY CHOSE ===
${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥 (higher weight)" : ""}: "${m.title}" (${m.year}) — ${m.primaryGenre} | Dir: ${m.director} | Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
  Themes: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
  Synopsis: ${m.overview || "N/A"}`).join("\n\n")}

=== WHAT THEY REJECTED (equally important signal) ===
${rejectionContext.length > 0 ? rejectionContext.map((m) => `Round ${m.round}: REJECTED "${m.title}" (${m.year}, ${m.primaryGenre}, dir. ${m.director})
  → Chose instead: ${m.lostTo}
  → Signal: they passed on ${m.primaryGenre}/${m.director}'s style`).join("\n\n") : "No rejection data"}

=== TASTE ANALYSIS ===
Read BOTH lists. For each round the contrast between chosen vs rejected tells you something specific about their preferences — genre, tone, era, pacing, style, director sensibility. Look for the PATTERN across all 7 rounds. Rounds 5-7 (marked 🔥) carry more weight as their taste crystallised.

Key dimensions to analyse:
- Genre & subgenre: what TYPE of films did they gravitate toward?
- Era: are they drawn to a specific decade or aesthetic?  
- Tone: dark/heavy vs light/fun, or somewhere specific in between?
- Pacing: slow-burn vs kinetic, dialogue-driven vs visual?
- Director/craft sensibility: what filmmaking approach did they consistently choose?
- What did rejections ELIMINATE? Each rejection is a negative filter.

=== RECOMMENDATION RULES ===
1. Every recommendation must match the taste pattern derived from their specific A/B results
2. Ask yourself: could this same film be recommended to someone with the OPPOSITE A/B results? If yes, it's not specific enough
3. Quality floor — every pick must pass: IMDb 6.5+ AND RT audience score 60%+ AND be recognisable/findable in Australia
4. English language or internationally well-known film only
5. No direct-to-streaming low-budget content, no films under 10,000 IMDb votes
6. No two picks from the same director or franchise
7. Natural variety across eras — at least one from last 3 years (${recentThreshold}–${currentYear}), at least one pre-2010

=== OUTPUT — respond in this exact JSON format ===
{
  "topGenres": ["genre1", "genre2", "genre3"],
  "themes": ["theme1", "theme2", "theme3"],
  "preferredEras": ["era1", "era2"],
  "visualStyle": "One sentence addressed to the user using 'you'/'your' about their cinematic taste, referencing 1-2 specific films they chose. Example: 'You gravitate toward...'",
  "mood": "One sentence addressed to the user using 'you'/'your' about their emotional/tonal preferences, referencing 1-2 specific picks. Example: 'You're in the mood for...'",
  "recommendations": [
    {"title": "Film Title 1", "year": 2022, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "recent"},
    {"title": "Film Title 2", "year": 1999, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "classic"},
    {"title": "Film Title 3", "year": 2016, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "flexible"},
    {"title": "Film Title 4", "year": 2014, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "flexible"},
    {"title": "Film Title 5", "year": 2019, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "flexible"},
    {"title": "Film Title 6", "year": 2011, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "flexible"},
    {"title": "Film Title 7", "year": 2008, "reason": "Explain why this matches their specific A/B choices — reference their actual picks by name, explain the tonal/stylistic connection", "category": "flexible"}
  ]
}

Return exactly 7 recommendations. Every reason must reference their actual film picks by name.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2500,
      temperature: 0.88,
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

  const categories = ["recent", "underseen", "classic", "flexible"];
  const targetCategory = categories[Math.floor(Math.random() * categories.length)];

  let categoryInstruction = "";
  switch (targetCategory) {
    case "recent":
      categoryInstruction = `Pick a RECENT film from ${recentThreshold}-${currentYear} matching their taste.`;
      break;
    case "underseen":
      categoryInstruction = `Pick an UNDERSEEN GEM — critically acclaimed but lesser-known.`;
      break;
    case "classic":
      categoryInstruction = `Pick a CLASSIC from before 2010 that connects thematically.`;
      break;
    default:
      categoryInstruction = `Pick a film from any era that genuinely fits their taste profile.`;
  }

  const prompt = `You're a passionate film expert helping someone find something new to watch. You know their taste from their picks:

${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥" : ""}: "${m.title}" (${m.year}) — Director: ${m.director}, Cast: ${m.cast.join(", ") || "Unknown"}, Themes: ${m.keywords.join(", ") || "N/A"}`).join("\n")}${rejectionHints}

They've already seen or dismissed ${excludeTmdbIds.length} suggestions. Dig DEEPER.

${categoryInstruction}

Think multi-dimensionally:
- Cinematic texture and feel (pacing, visual style, score, emotional register)
- Director sensibility or kindred vision
- Thematic resonance beyond surface genre
- Era matching and tonal kinship

Make an unexpected but precisely right connection. Reference specific films from their picks in your reason.
Well-rated only (IMDb 7.0+). [Seed: ${randomSeed}]

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
