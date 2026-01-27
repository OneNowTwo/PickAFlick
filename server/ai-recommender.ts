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

  // Add randomization seed to encourage varied responses
  const randomSeed = Math.floor(Math.random() * 100000);
  const sessionTime = new Date().toISOString();

  const prompt = `You are an expert film analyst with encyclopedic knowledge of cinema. A user played a movie picker game, choosing between pairs of films. They selected these 7 movies:

${movieDescriptions.map((m, i) => `${i + 1}. "${m.title}" (${m.year}, ${m.era})
   Director: ${m.director}
   Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
   Genres: ${m.genres.join(", ")}
   Keywords/Themes: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
   Synopsis: ${m.overview || "No synopsis available"}`).join("\n\n")}

[Session: ${sessionTime} | Seed: ${randomSeed}]

DEEP ANALYSIS REQUIRED - Go beyond surface-level genre matching. Examine:

1. **Narrative DNA**: What storytelling structures resonate? (nonlinear timelines, unreliable narrators, slow burns, ensemble casts, character studies, plot-driven thrillers)
2. **Cinematographic Fingerprint**: What visual language appeals? (long takes, handheld intimacy, symmetrical compositions, naturalistic lighting, saturated colors, desaturated palettes, wide establishing shots)
3. **Thematic Undercurrents**: What deeper themes connect these films? (existential dread, family dysfunction, moral ambiguity, identity crisis, societal critique, redemption arcs)
4. **Pacing & Rhythm**: Fast-paced editing or contemplative pacing? Action set-pieces or dialogue-driven scenes?
5. **Era & Movement**: Are they drawn to French New Wave aesthetics, 70s New Hollywood grit, 90s indie sensibility, modern A24 style, classic Hollywood glamour?
6. **Emotional Register**: Cathartic release, intellectual stimulation, visceral thrills, melancholic beauty, dark humor?
7. **Director Signatures**: Identify any auteur influences - are these Fincher-esque, Nolan-like, Villeneuve style, Coen Brothers tone, Ari Aster vibes?

Based on this DEEP analysis, recommend 5 films that match this unique taste profile.

CRITICAL RULES:
1. DO NOT recommend any movie already in their selections
2. THINK CREATIVELY - draw from world cinema, underseen gems, cult classics, and lesser-known works by famous directors
3. Each recommendation should connect to MULTIPLE dimensions of their taste profile, not just genre
4. Vary your recommendations across eras and styles - don't cluster around one type
5. Your reasons must be SPECIFIC - cite exact visual, thematic, or narrative parallels to their choices
6. Address the user directly using "you" and "your"
7. If a well-known film genuinely fits perfectly, recommend it - but justify deeply WHY it matches

Respond in this exact JSON format:
{
  "topGenres": ["genre1", "genre2", "genre3"],
  "themes": ["theme1", "theme2", "theme3"],
  "preferredEras": ["era1", "era2"],
  "visualStyle": "Write a SHORT, playful one-liner (15-25 words max) that sounds like a witty friend describing their taste. Must reference 1-2 of their chosen films naturally. Example: 'You've got an eye for that slick, dark aesthetic - think 'Parasite' meets 'No Country for Old Men' vibes.'",
  "mood": "Write a SHORT, playful one-liner (15-25 words max) that feels personal and a little cheeky. Must mention 1-2 of their picks. Example: 'Clearly you like your films like your coffee - dark, complex, and keeps you up thinking.'",
  "recommendations": [
    {"title": "Movie Title", "year": 2020, "reason": "Personalized reason connecting to your preferences"},
    {"title": "Movie Title 2", "year": 2018, "reason": "Personalized reason connecting to your preferences"}
  ]
}

CRITICAL for visualStyle and mood:
- Keep them SHORT (one punchy sentence, 15-25 words max)
- Make them feel personal and conversational - like a witty friend, not a film professor
- Reference 1-2 specific films they chose, woven naturally into the sentence
- Add a touch of personality/humor but don't overdo it - warm and clever, not silly`;

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

  const prompt = `You are a film expert. A user selected these movies in a preference game:

${movieDescriptions.map((m, i) => `${i + 1}. "${m.title}" (${m.year}) - ${m.genres.join(", ")}`).join("\n")}

They've already seen or dismissed movies with TMDb IDs: ${excludeTmdbIds.join(", ")}

Recommend ONE movie that fits their taste profile. Choose something they likely haven't seen - explore international films, cult classics, or underseen gems.

[Seed: ${randomSeed}]

Respond in JSON format:
{
  "title": "Movie Title",
  "year": 2020,
  "reason": "A short, personalized reason (1-2 sentences) why this fits their taste"
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

    // Search for the movie on TMDb
    const searchResult = await searchMovieByTitle(result.title, result.year);
    
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
