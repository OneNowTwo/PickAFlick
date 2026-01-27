import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailer, getMovieDetails } from "./tmdb";
import { getAllMovies } from "./catalogue";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface AIRecommendationResult {
  title: string;
  year?: number;
  reason: string;
  category?: string;
}

// List of commonly over-suggested movies to filter out for variety
const BANNED_REPEATED_MOVIES = [
  "a ghost story",
  "moonlight", 
  "lady bird",
  "the florida project",
  "eighth grade",
  "hereditary",
  "midsommar",
  "the witch",
  "drive",
  "nightcrawler",
  "ex machina",
  "her",
  "arrival",
  "blade runner 2049",
  "the lobster",
  "under the skin",
  "it follows",
  "the babadook",
];

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
  chosenMovies: Movie[]
): Promise<RecommendationsResponse> {
  // Build a rich profile of what the user chose with extended metadata
  const movieDescriptions = chosenMovies.map((m) => ({
    title: m.title,
    year: m.year,
    era: getEra(m.year),
    genres: m.genres,
    overview: m.overview,
    director: m.director || "Unknown",
    cast: m.cast?.slice(0, 3) || [],
    keywords: m.keywords?.slice(0, 5) || [],
    rating: m.rating,
  }));

  // Add randomization seed to encourage varied responses
  const randomSeed = Math.floor(Math.random() * 100000);
  const sessionTime = new Date().toISOString();

  // Get current year for recent movie calculation
  const currentYear = new Date().getFullYear();
  const recentThreshold = currentYear - 3; // Movies from last 3 years

  const prompt = `You are an expert film analyst with encyclopedic knowledge of cinema from all eras and countries. A user played a movie picker game, choosing between pairs of films. They selected these 7 movies:

${movieDescriptions.map((m, i) => `${i + 1}. "${m.title}" (${m.year}, ${m.era})
   Director: ${m.director}
   Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
   Genres: ${m.genres.join(", ")}
   Keywords/Themes: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
   Synopsis: ${m.overview || "No synopsis available"}`).join("\n\n")}

[Session: ${sessionTime} | Variation Seed: ${randomSeed}]

DEEP ANALYSIS REQUIRED - Go beyond surface-level genre matching. Examine:

1. **Narrative DNA**: What storytelling structures resonate? (nonlinear timelines, unreliable narrators, slow burns, ensemble casts, character studies, plot-driven thrillers)
2. **Cinematographic Fingerprint**: What visual language appeals? (long takes, handheld intimacy, symmetrical compositions, naturalistic lighting, saturated colors, desaturated palettes)
3. **Thematic Undercurrents**: What deeper themes connect these films? (existential dread, family dysfunction, moral ambiguity, identity crisis, societal critique, redemption arcs)
4. **Pacing & Rhythm**: Fast-paced editing or contemplative pacing? Action set-pieces or dialogue-driven scenes?
5. **Emotional Register**: Cathartic release, intellectual stimulation, visceral thrills, melancholic beauty, dark humor?

Based on this analysis, recommend 5 films that match this taste profile.

=== CRITICAL VARIETY REQUIREMENTS ===

Your 5 recommendations MUST include this diversity mix:
1. **ONE RECENT RELEASE (${recentThreshold}-${currentYear})**: A movie from the last 3 years that relates to their taste. This could be a theatrical release, streaming original, or festival hit. Think: current directors' new work, recent genre entries, or buzzy films they might have missed.

2. **ONE UNDERSEEN GEM**: A critically acclaimed but lesser-known film (not a mainstream blockbuster). Could be an indie darling, festival winner, or cult classic that never got wide release.

3. **ONE CLASSIC OR OLDER FILM**: Something from before 2010 that connects thematically or stylistically.

4. **TWO FLEXIBLE PICKS**: Can be any era, but should add variety to the mix.

=== ANTI-REPETITION RULES ===

DO NOT recommend these commonly over-suggested movies (find alternatives that match similar themes):
- A Ghost Story, Moonlight, Lady Bird, The Florida Project, Eighth Grade
- Hereditary, Midsommar, The Witch (unless they specifically chose A24 horror)
- Drive, Nightcrawler, Ex Machina (unless very specifically thematically relevant)
- Her, Arrival, Blade Runner 2049 (find fresher sci-fi alternatives)

Instead, DIG DEEPER. For every "obvious" recommendation, ask: "What less-known film shares these same qualities?" Recommend THAT instead.

=== QUALITY STANDARDS ===
- All films should be English-language OR have significant English-speaking audience appeal (no obscure foreign films without mainstream crossover)
- All films should have generally positive reception (no poorly-rated films)
- Avoid direct-to-video quality films

=== OUTPUT REQUIREMENTS ===

Respond in this exact JSON format:
{
  "topGenres": ["genre1", "genre2", "genre3"],
  "themes": ["theme1", "theme2", "theme3"],
  "preferredEras": ["era1", "era2"],
  "visualStyle": "Short playful one-liner (15-25 words) describing their visual taste. Reference 1-2 of their films.",
  "mood": "Short playful one-liner (15-25 words) about their emotional preferences. Reference 1-2 of their picks.",
  "recommendations": [
    {"title": "Recent Film Title", "year": ${currentYear}, "reason": "Why this recent release matches their taste", "category": "recent"},
    {"title": "Underseen Gem Title", "year": 2015, "reason": "Why this hidden gem fits", "category": "underseen"},
    {"title": "Classic Title", "year": 1995, "reason": "Why this older film connects", "category": "classic"},
    {"title": "Flexible Pick 1", "year": 2019, "reason": "Personalized reason", "category": "flexible"},
    {"title": "Flexible Pick 2", "year": 2021, "reason": "Personalized reason", "category": "flexible"}
  ]
}

CRITICAL NOTES:
- The first recommendation MUST be from ${recentThreshold}-${currentYear} (labeled "recent")
- One recommendation MUST be a lesser-known gem (labeled "underseen")
- One recommendation MUST be from before 2010 (labeled "classic")
- Keep visualStyle and mood SHORT (one punchy sentence each)
- Address the user as "you" and "your" in reasons`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.9,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const analysis: AIAnalysis = JSON.parse(content);

    // Resolve recommended movies through TMDb with FULL DETAILS
    const recommendations: Recommendation[] = [];
    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    for (const rec of analysis.recommendations) {
      try {
        // Skip banned/commonly repeated movies for variety
        const titleLower = rec.title.toLowerCase();
        if (BANNED_REPEATED_MOVIES.some(banned => titleLower.includes(banned))) {
          console.log(`Skipping banned repeated movie: ${rec.title}`);
          continue;
        }
        
        // Search for the movie on TMDb
        const searchResult = await searchMovieByTitle(rec.title, rec.year);
        
        if (!searchResult || chosenTmdbIds.has(searchResult.id)) {
          continue; // Skip if not found or already chosen
        }

        // Get FULL movie details from TMDb (this gets poster, overview, etc.)
        const movieDetails = await getMovieDetails(searchResult.id);
        
        if (!movieDetails) {
          continue; // Skip if we couldn't get details
        }

        // Get trailer
        const trailerUrl = await getMovieTrailer(searchResult.id);

        // Set the list source
        movieDetails.listSource = "ai-recommendation";

        recommendations.push({
          movie: movieDetails,
          trailerUrl,
          reason: rec.reason,
        });

        // Stop once we have 5 recommendations
        if (recommendations.length >= 5) break;
      } catch (error) {
        console.error(`Failed to resolve recommendation "${rec.title}":`, error);
        continue;
      }
    }

    // Add a "wildcard" random pick from the catalogue for variety
    const allMovies = getAllMovies();
    const usedTmdbIds = new Set([
      ...Array.from(chosenTmdbIds),
      ...recommendations.map((r) => r.movie.tmdbId),
    ]);
    
    const eligibleWildcards = allMovies.filter(
      (m) => !usedTmdbIds.has(m.tmdbId) && m.rating && m.rating >= 7.0
    );
    
    if (eligibleWildcards.length > 0) {
      const wildcardMovie = shuffleArray([...eligibleWildcards])[0];
      const wildcardTrailer = await getMovieTrailer(wildcardMovie.tmdbId);
      
      recommendations.push({
        movie: { ...wildcardMovie, listSource: "wildcard" },
        trailerUrl: wildcardTrailer,
        reason: `A surprise pick from our curated collection! This ${wildcardMovie.genres.slice(0, 2).join("/")} gem from ${wildcardMovie.year} might just become your next favorite.`,
      });
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
    
    // Fallback: return random movies from catalogue
    const allMovies = getAllMovies();
    const fallbackMovies = shuffleArray([...allMovies])
      .filter((m) => !chosenMovies.some((c) => c.tmdbId === m.tmdbId))
      .slice(0, 5);

    const fallbackRecs: Recommendation[] = [];
    for (const movie of fallbackMovies) {
      const trailerUrl = await getMovieTrailer(movie.tmdbId);
      fallbackRecs.push({
        movie,
        trailerUrl,
        reason: "A great pick based on your taste!",
      });
    }

    return {
      recommendations: fallbackRecs,
      preferenceProfile: {
        topGenres: extractTopGenres(chosenMovies),
        themes: [],
      },
    };
  }
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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
  excludeTmdbIds: number[]
): Promise<Recommendation | null> {
  const movieDescriptions = chosenMovies.map((m) => ({
    title: m.title,
    year: m.year,
    genres: m.genres,
    director: m.director || "Unknown",
    cast: m.cast?.slice(0, 3) || [],
    keywords: m.keywords?.slice(0, 5) || [],
  }));

  const randomSeed = Math.floor(Math.random() * 100000);

  const currentYear = new Date().getFullYear();
  const recentThreshold = currentYear - 3;
  
  // Randomly pick a category for variety
  const categories = ["recent", "underseen", "classic", "flexible"];
  const targetCategory = categories[Math.floor(Math.random() * categories.length)];
  
  let categoryInstruction = "";
  switch (targetCategory) {
    case "recent":
      categoryInstruction = `Pick a RECENT film from ${recentThreshold}-${currentYear} that matches their taste.`;
      break;
    case "underseen":
      categoryInstruction = `Pick an UNDERSEEN GEM - a critically acclaimed but lesser-known film they likely haven't seen.`;
      break;
    case "classic":
      categoryInstruction = `Pick a CLASSIC film from before 2010 that connects thematically to their choices.`;
      break;
    default:
      categoryInstruction = `Pick a film from any era that genuinely fits their taste profile.`;
  }

  const prompt = `You are a film expert with encyclopedic knowledge of cinema. A user selected these movies in a preference game:

${movieDescriptions.map((m, i) => `${i + 1}. "${m.title}" (${m.year}) - ${m.genres.join(", ")}`).join("\n")}

They've already seen or dismissed ${excludeTmdbIds.length} movies, so we need something FRESH.

${categoryInstruction}

VARIETY RULES:
- DO NOT recommend commonly over-suggested films (A Ghost Story, Moonlight, Hereditary, Drive, Ex Machina, etc.)
- DIG DEEPER - find something they truly haven't heard of
- Should be English-language or have mainstream crossover appeal
- Should be well-rated (no poorly received films)

[Variation Seed: ${randomSeed}]

Respond in JSON format:
{
  "title": "Movie Title",
  "year": 2020,
  "reason": "A personalized 1-2 sentence reason using 'you' and 'your'"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 300,
      temperature: 0.95,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const result: AIRecommendationResult = JSON.parse(content);

    // Skip banned/commonly repeated movies for variety
    const titleLower = result.title.toLowerCase();
    if (BANNED_REPEATED_MOVIES.some(banned => titleLower.includes(banned))) {
      console.log(`Skipping banned repeated movie in replacement: ${result.title}`);
      // Fall through to fallback
    }
    
    // Search for the movie on TMDb
    const searchResult = !BANNED_REPEATED_MOVIES.some(banned => titleLower.includes(banned))
      ? await searchMovieByTitle(result.title, result.year)
      : null;
    
    if (!searchResult || excludeTmdbIds.includes(searchResult.id)) {
      // Try from catalogue as fallback
      const allMovies = getAllMovies();
      const eligibleMovies = allMovies.filter(
        (m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0
      );
      
      if (eligibleMovies.length > 0) {
        const fallbackMovie = shuffleArray([...eligibleMovies])[0];
        const trailerUrl = await getMovieTrailer(fallbackMovie.tmdbId);
        return {
          movie: { ...fallbackMovie, listSource: "replacement" },
          trailerUrl,
          reason: `A great pick based on your taste in ${fallbackMovie.genres.slice(0, 2).join(" and ")} films!`,
        };
      }
      return null;
    }

    // Get full movie details
    const movieDetails = await getMovieDetails(searchResult.id);
    if (!movieDetails) return null;

    const trailerUrl = await getMovieTrailer(searchResult.id);
    movieDetails.listSource = "replacement";

    return {
      movie: movieDetails,
      trailerUrl,
      reason: result.reason,
    };
  } catch (error) {
    console.error("Failed to generate replacement:", error);
    
    // Fallback: pick from catalogue
    const allMovies = getAllMovies();
    const eligibleMovies = allMovies.filter(
      (m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0
    );
    
    if (eligibleMovies.length > 0) {
      const fallbackMovie = shuffleArray([...eligibleMovies])[0];
      const trailerUrl = await getMovieTrailer(fallbackMovie.tmdbId);
      return {
        movie: { ...fallbackMovie, listSource: "replacement" },
        trailerUrl,
        reason: `A fresh pick for your ${fallbackMovie.genres[0]} cravings!`,
      };
    }
    
    return null;
  }
}
