import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailer } from "./tmdb";
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
  recommendations: AIRecommendationResult[];
}

export async function generateRecommendations(
  chosenMovies: Movie[]
): Promise<RecommendationsResponse> {
  // Build a profile of what the user chose
  const movieDescriptions = chosenMovies.map((m) => ({
    title: m.title,
    year: m.year,
    genres: m.genres,
    overview: m.overview,
  }));

  const prompt = `You are a movie recommendation expert. A user has been shown pairs of movies and chose the following 7 movies as their preferences:

${movieDescriptions.map((m, i) => `${i + 1}. "${m.title}" (${m.year}) - Genres: ${m.genres.join(", ")}
   Synopsis: ${m.overview || "No synopsis available"}`).join("\n\n")}

Based on these choices, analyze what the user likes and recommend 5 movies they would enjoy.

IMPORTANT RULES:
1. DO NOT recommend any movie the user already chose
2. Recommend well-known movies that are likely to be found on TMDb
3. Match the user's apparent taste in genres, themes, tone, and era
4. Provide a brief, personalized reason for each recommendation

Respond in this exact JSON format:
{
  "topGenres": ["genre1", "genre2", "genre3"],
  "themes": ["theme1", "theme2"],
  "recommendations": [
    {"title": "Movie Title", "year": 2020, "reason": "Brief reason why they'd like it"},
    {"title": "Movie Title 2", "year": 2018, "reason": "Brief reason why they'd like it"}
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const analysis: AIAnalysis = JSON.parse(content);

    // Resolve recommended movies through TMDb
    const recommendations: Recommendation[] = [];
    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    for (const rec of analysis.recommendations) {
      try {
        // Search for the movie on TMDb
        const searchResult = await searchMovieByTitle(rec.title, rec.year);
        
        if (!searchResult || chosenTmdbIds.has(searchResult.id)) {
          continue; // Skip if not found or already chosen
        }

        // Get trailer
        const trailerUrl = await getMovieTrailer(searchResult.id);

        // Build a simple movie object from the recommendation
        const movie: Movie = {
          id: searchResult.id,
          tmdbId: searchResult.id,
          title: rec.title,
          year: rec.year || null,
          posterPath: null, // Will be fetched below
          backdropPath: null,
          overview: null,
          genres: [],
          rating: null,
          listSource: "ai-recommendation",
        };

        // Try to find this movie in our catalogue for poster/details
        const catalogueMatch = getAllMovies().find((m) => m.tmdbId === searchResult.id);
        if (catalogueMatch) {
          movie.posterPath = catalogueMatch.posterPath;
          movie.backdropPath = catalogueMatch.backdropPath;
          movie.overview = catalogueMatch.overview;
          movie.genres = catalogueMatch.genres;
          movie.rating = catalogueMatch.rating;
        }

        recommendations.push({
          movie,
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

    return {
      recommendations,
      preferenceProfile: {
        topGenres: analysis.topGenres || [],
        themes: analysis.themes || [],
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
