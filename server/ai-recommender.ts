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

  const prompt = `You are an expert film analyst and recommendation engine. A user has been shown pairs of movies and chose the following 7 movies as your preferences:

${movieDescriptions.map((m, i) => `${i + 1}. "${m.title}" (${m.year}, ${m.era})
   Director: ${m.director}
   Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
   Genres: ${m.genres.join(", ")}
   Keywords/Themes: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
   Synopsis: ${m.overview || "No synopsis available"}`).join("\n\n")}

Analyze your choices deeply. Consider:
1. **Genres & Themes**: What genres and narrative themes do you prefer?
2. **Era Preference**: Do you favor classic cinema, modern blockbusters, or a specific decade?
3. **Director Style**: Look for patterns in directors you chose (auteur films, commercial directors, indie filmmakers)
4. **Visual Style & Feel**: Based on the movies, what cinematographic style appeals to you? (gritty, polished, atmospheric, colorful, noir, etc.)
5. **Mood & Tone**: Are you drawn to dark/serious films, feel-good movies, thrilling suspense, or quirky indie vibes?
6. **Cast Patterns**: Do you seem to follow certain actors or types of performances?

Based on this deep analysis, recommend 5 movies you would love.

IMPORTANT RULES:
1. DO NOT recommend any movie the user already chose
2. Recommend movies that exist on TMDb with trailers - but AVOID overused recommendations like Fight Club, Prisoners, Se7en, Shawshank Redemption, Inception, The Dark Knight, Interstellar
3. ENSURE DIVERSITY: Include at least one movie from a different era than the majority of choices, and ensure variety across genres
4. Match your taste across all dimensions: genre, era, director style, visual feel, mood
5. Provide a personalized reason explaining WHY this matches your preferences - always use "you" and "your", never "they" or "their"
6. Be specific - mention what elements connect the recommendation to your choices
7. Think outside the box - suggest hidden gems and lesser-known films that match the taste profile

Respond in this exact JSON format:
{
  "topGenres": ["genre1", "genre2", "genre3"],
  "themes": ["theme1", "theme2", "theme3"],
  "preferredEras": ["era1", "era2"],
  "visualStyle": "Brief description of your preferred visual/cinematographic style (use 'you' not 'they')",
  "mood": "Brief description of the overall mood/tone you prefer (use 'you' not 'they')",
  "recommendations": [
    {"title": "Movie Title", "year": 2020, "reason": "Personalized reason connecting to your preferences"},
    {"title": "Movie Title 2", "year": 2018, "reason": "Personalized reason connecting to your preferences"}
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const analysis: AIAnalysis = JSON.parse(content);

    // Resolve recommended movies through TMDb with FULL DETAILS
    const recommendations: Recommendation[] = [];
    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    for (const rec of analysis.recommendations) {
      try {
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
