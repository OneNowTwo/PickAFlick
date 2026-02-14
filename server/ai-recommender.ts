import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailer, getMovieTrailers, getMovieDetails, getWatchProviders, getFallbackTrailerUrls } from "./tmdb";
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

function matchesGenreFilters(movie: Movie, genreFilters: string[]): boolean {
  if (genreFilters.length === 0) return true;
  const primaryGenre = movie.genres[0];
  return !!primaryGenre && genreFilters.includes(primaryGenre);
}

export async function generateRecommendations(
  chosenMovies: Movie[],
  rejectedMovies: Movie[] = [],
  initialGenreFilters: string[] = []
): Promise<RecommendationsResponse> {
  // Build a rich profile of what the user chose with extended metadata
  // Focus on PRIMARY genre (first in list) for more precise matching
  // Later rounds weighted more heavily (rounds 5-7 are 1.5x more important)
  const movieDescriptions = chosenMovies.map((m, index) => {
    const round = index + 1;
    const weight = round >= 5 ? 1.5 : 1.0; // Recency weighting
    return {
      title: m.title,
      year: m.year,
      era: getEra(m.year),
      primaryGenre: m.genres[0] || "Unknown", // PRIMARY genre is first
      allGenres: m.genres,
      overview: m.overview,
      director: m.director || "Unknown",
      cast: m.cast?.slice(0, 5) || [], // Increased from 3 to 5
      keywords: m.keywords?.slice(0, 10) || [], // Increased from 5 to 10
      rating: m.rating,
      round,
      weight, // Include weight in data for AI context
    };
  });

  // Build rejection context - what they passed on and WHY (what beat it)
  const rejectionContext = rejectedMovies.map((m, index) => {
    const chosenMovie = chosenMovies[index];
    return {
      title: m.title,
      year: m.year,
      primaryGenre: m.genres[0] || "Unknown",
      allGenres: m.genres,
      director: m.director || "Unknown",
      lostTo: chosenMovie ? `"${chosenMovie.title}" (${chosenMovie.genres[0]})` : "unknown",
      round: index + 1,
    };
  });

  // Add randomization seed to encourage varied responses
  const randomSeed = Math.floor(Math.random() * 100000);
  const sessionTime = new Date().toISOString();

  // Get current year for recent movie calculation
  const currentYear = new Date().getFullYear();
  const recentThreshold = currentYear - 3; // Movies from last 3 years

  // Build initial filter context
  const filterContext = initialGenreFilters.length > 0 
    ? `\n🎯 **USER'S INITIAL MOOD/GENRE FILTERS**: They specifically chose to explore ${initialGenreFilters.join(", ")} films. This tells you their starting intent - honor it but don't be constrained by it.\n`
    : "";

  const prompt = `You are a world-class film critic and cinema historian with deep knowledge of GLOBAL cinema spanning 100+ years. You're like a Criterion Collection curator meets film school professor meets that friend who's seen 10,000 movies.

A user played a head-to-head picker game where they chose 7 movies (and rejected 7 others). This gives you BOTH positive and negative signals about their taste.${filterContext}

=== MOVIES THEY CHOSE (Positive Signal) ===

${movieDescriptions.map((m, i) => `Round ${m.round}${m.weight > 1 ? " 🔥 (WEIGHTED - later choice, stronger signal)" : ""}
"${m.title}" (${m.year}, ${m.era}) - Rating: ${m.rating || "N/A"}/10
   Director: ${m.director}
   Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
   PRIMARY Genre: ${m.primaryGenre} (focus on this!)
   Secondary Genres: ${m.allGenres.slice(1).join(", ") || "None"}
   Keywords/Themes: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
   Synopsis: ${m.overview || "No synopsis available"}`).join("\n\n")}

=== MOVIES THEY REJECTED (Negative Signal - Avoid Similar) ===

${rejectionContext.length > 0 ? rejectionContext.map((m) => `Round ${m.round}: "${m.title}" (${m.year}) - ${m.primaryGenre}
   Rejected in favor of: ${m.lostTo}
   Why this matters: They actively chose something else, suggesting they're NOT drawn to ${m.primaryGenre === chosenMovies[m.round - 1]?.genres[0] ? "this style/tone" : m.primaryGenre} in this context`).join("\n\n") : "No rejections tracked (older session)"}

[Session: ${sessionTime} | Diversity Seed: ${randomSeed}]

⚠️ CRITICAL DIVERSITY REQUIREMENT: 

USE THIS SEED TO EXPLORE DIFFERENT CORNERS OF CINEMA EACH TIME. The seed (${randomSeed}) means you should vary your recommendations significantly.

**MANDATORY: You MUST avoid recommending the same films repeatedly across different sessions.** If you find yourself thinking of films like "A Ghost Story", "The Fall", "The Shape of Water", "Prisoners", etc. - STOP and think of 3-5 alternatives instead. These are great films but over-recommended.

**STRATEGY FOR DIVERSITY:**
- For EACH genre/theme you identify, brainstorm 5 different film options
- Prefer films from different decades than the obvious choice
- Recommend directors' lesser-known works over their famous ones
- Think internationally - European, Asian (non-K-pop/anime), Latin American, African cinema
- Consider underseen gems from the 60s-90s that match their taste
- If a film is "obvious" (appears in top 10 Google results for that genre) - dig deeper

Every user is unique and deserves FRESH discoveries tailored to their specific A/B test choices.

=== THINK LIKE A FILM BUFF - MULTI-DIMENSIONAL ANALYSIS ===

⚠️ **DEEPLY ANALYZE THE A/B TEST RESULTS - THIS IS THE WHOLE POINT**:

Every round tells you something SPECIFIC about the user's preferences. You must examine:

1. **Genre Signals**: Not just "they like Action" but what TYPE of action? Gritty realism vs CGI spectacle? Character-driven vs set pieces?

2. **Era/Period Preferences**: Are they drawn to 70s grit, 80s neon, 90s indie, or modern aesthetics? This matters for EVERY recommendation.

3. **Director/Actor Patterns**: Did they choose the Villeneuve over the Tarantino? The Phoenix over the Cruise? These are TASTE INDICATORS about sensibility, not just star power.

4. **Cinematography & Visual Style**: Did they pick the beautifully shot film over the scrappy indie? The neon noir over naturalistic? Visual preferences are CRITICAL.

5. **Mood, Tone, Pacing**: Dark vs light, slow-burn vs kinetic, cerebral vs visceral, grounded vs fantastical. EVERY choice reveals mood preferences.

6. **Themes & Substance**: Are they drawn to existential questions, social commentary, psychological depth, or pure entertainment? Look at the CONTENT of what they chose.

7. **Sound & Score**: Synth-heavy 80s throwbacks? Orchestral epics? Minimalist soundscapes? This matters.

8. **Color Palette & Feel**: Desaturated & bleak? Vibrant & poppy? Warm & nostalgic? Match the aesthetic FEEL.

⚠️ **PRIMARY GENRE FOCUS**: Pay special attention to each movie's PRIMARY genre (listed first). If they picked Crime, focus on Crime films - not just "anything with crime elements". Be precise with genre matching while still considering style, mood, and quality.

⚠️ **USE THE REJECTION DATA**: The movies they REJECTED tell you what they DON'T want. If they rejected a rom-com for a thriller, avoid romantic comedies. If they rejected action for drama, they want substance over spectacle. The rejections are NEGATIVE SIGNALS - learn from them!

⚠️ **RECENCY WEIGHTING**: Later rounds (5-7) marked with 🔥 are MORE IMPORTANT - their taste refined as they went. Weight these choices more heavily in your analysis.

Don't just match genres mechanically. A true cinephile sees CONNECTIONS across many dimensions:

1. **ACTOR CONNECTIONS**: "You picked Se7en with Brad Pitt - you'd love Fight Club where he's equally magnetic" or "Joaquin Phoenix in Joker? His work in The Master has that same intensity"

2. **CINEMATOGRAPHIC STYLE**: "Blade Runner's visual poetry? Tree of Life has that same painterly eye" or "The neon-drenched look of Drive? Nicolas Winding Refn's Only God Forgives doubles down on that aesthetic"

3. **DIRECTOR SENSIBILITIES**: Same director's other gems, or directors with kindred vision. "Loved Villeneuve's Arrival? Incendies is his emotional gut-punch you haven't seen yet"

4. **ERA MATCHING**: If they gravitate toward 80s films, recommend 80s classics OR modern films that capture that era's spirit. "Your 80s picks show you love practical effects and synth scores - It Follows nails that retro vibe"

5. **THEMATIC RESONANCE**: Not "it's a drama" but WHY the themes connect. "These picks share themes of identity fragmentation - you'd connect with Mulholland Drive's dreamlike identity puzzles"

6. **TONAL KINSHIP**: Dark humor, melancholic beauty, visceral tension, quiet devastation - match the FEELING

7. **NARRATIVE APPROACH**: Nonlinear storytelling? Slow-burn tension? Ensemble character studies? Match how stories unfold, not just what they're about

=== VARIETY REQUIREMENTS ===

Your 7 recommendations MUST include:
1. **ONE RECENT (${recentThreshold}-${currentYear})**: Something from the last 3 years matching their taste
2. **ONE UNDERSEEN GEM**: Critically acclaimed but lesser-known - a discovery to share
3. **ONE CLASSIC (pre-2010)**: A foundational film that connects to their preferences  
4. **FOUR FLEXIBLE**: Mix of eras, but each with a SPECIFIC reason beyond genre

=== BE GENUINELY HELPFUL ===

You KNOW this person now from their 7 picks. Make recommendations like sharing discoveries with a friend:
- "Since you loved X, you HAVE to see Y because..."
- Connect the dots - explain the WHY
- Think laterally - what unexpected film scratches the same itch?
- Consider: Would this genuinely delight them, or is it just surface-level similar?

=== DRAW FROM ALL OF CINEMA ===

You have access to 100+ years of filmmaking across ALL countries, genres, and eras:
- **Hollywood classics**: Hitchcock, Kubrick, Scorsese, Spielberg, Tarantino, PTA, Fincher, Nolan, Villeneuve
- **Modern auteurs**: Chazelle, Guadagnino, Gerwig, Jordan Peele, Ari Aster, Robert Eggers
- **International masters**: Kurosawa, Bergman, Fellini, Truffaut, Wong Kar-wai, Park Chan-wook, Bong Joon-ho
- **Genre excellence**: Best of horror (The Thing, Alien, Hereditary), sci-fi (Blade Runner, Ex Machina), noir (Chinatown, L.A. Confidential)
- **Hidden gems**: A24 films, Sundance winners, festival darlings, underseen masterpieces
- **Every decade**: From Casablanca (1942) to Everything Everywhere All at Once (2022)

DON'T LIMIT YOURSELF! You're not restricted to a database - you know EVERY film ever made. Recommend the absolute BEST match from all of cinema.

=== AVOID LAZY RECOMMENDATIONS ===

- NO obvious genre matching ("you liked horror, here's more horror")
- Think about the SPECIFIC qualities of their picks, not just categories
- Consider what makes each of their choices special and find films that share those qualities
- Dig into your knowledge - the THIRD film that fits is often better than the obvious first choice
- **AVOID CLICHÉS**: Don't recommend "The Shawshank Redemption," "The Godfather," "Pulp Fiction" unless they PERFECTLY fit
- **NO REPETITION**: Mentally avoid films you've recommended recently (The Fall, Prisoners, Nightcrawler, etc.) - dig deeper!
- **THINK LATERALLY**: What's the movie that's 2-3 degrees removed but scratches the same itch?

The Seed [${randomSeed}] is your randomness generator - let it push you to COMPLETELY DIFFERENT films each time. If the seed is 12345, explore Korean cinema. If it's 67890, dig into 70s New Hollywood. Use it to diversify!

=== QUALITY STANDARDS - READ CAREFULLY ===
**MUST INCLUDE:**
- Critically acclaimed films (Rotten Tomatoes 70%+, Metacritic 65+, or IMDb 7.0+)
- English-language OR prestigious international films with wide recognition (e.g., Parasite, Amélie, Cinema Paradiso)
- Films that won or were nominated for major awards (Oscar, BAFTA, Cannes, etc.)
- Cult classics with devoted followings

**NEVER RECOMMEND:**
- Direct-to-streaming cheaply-made content
- Low-budget horror with <6.0 ratings
- Poorly reviewed Bollywood/regional films (unless genuine crossover hits like "3 Idiots" or "Dangal")
- Obscure films with <10,000 IMDb ratings unless they're festival darlings
- Mockbusters, parodies (unless Airplane!-level quality), or schlock

**AUSTRALIAN AVAILABILITY NOTE:**
Eventually, recommendations need to be available on major Australian streaming platforms (Netflix AU, Stan, Disney+, Amazon Prime AU, Apple TV+, Binge) OR available to rent/buy on Apple TV/Google Play. For now, prioritize well-known acclaimed films that are LIKELY to be available somewhere.

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
    {"title": "Flexible Pick 2", "year": 2021, "reason": "Personalized reason", "category": "flexible"},
    {"title": "Backup Pick 1", "year": 2018, "reason": "Alternative recommendation", "category": "backup"},
    {"title": "Backup Pick 2", "year": 2020, "reason": "Alternative recommendation", "category": "backup"}
  ]
}

CRITICAL NOTES:
- Provide exactly 7 recommendations (5 main + 2 backups in case some aren't available)
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
      temperature: 0.95, // Higher temperature for more variety
    });

    const content = response.choices[0]?.message?.content || "{}";
    const analysis: AIAnalysis = JSON.parse(content);

    // Resolve recommended movies through TMDb with FULL DETAILS - PARALLELIZED for speed
    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    // Fetch all recommendations in parallel with full details and trailers
    const recPromises = analysis.recommendations.map(async (rec) => {
      try {
        // Search for the movie on TMDb
        const searchResult = await searchMovieByTitle(rec.title, rec.year);
        
        if (!searchResult || chosenTmdbIds.has(searchResult.id)) {
          return null; // Skip if not found or already chosen
        }

        // Get movie details, trailers, and watch providers in parallel
        const [movieDetails, tmdbTrailers, watchProviders] = await Promise.all([
          getMovieDetails(searchResult.id),
          getMovieTrailers(searchResult.id),
          getWatchProviders(searchResult.id, rec.title, rec.year),
        ]);
        
        if (!movieDetails) {
          return null; // Skip if we couldn't get details
        }
        
        // Skip movies without posters or trailers
        if (!movieDetails.posterPath || !movieDetails.posterPath.trim()) {
          console.log(`Skipping "${movieDetails.title}" - no poster available`);
          return null;
        }
        
        let trailerUrls = tmdbTrailers;
        if (trailerUrls.length === 0) {
          trailerUrls = await getFallbackTrailerUrls(movieDetails.title, movieDetails.year);
        }
        if (trailerUrls.length === 0) {
          console.log(`Skipping "${movieDetails.title}" - no trailer found (TMDb/YouTube fallback)`);
          return null;
        }

        // Don't drop LLM recommendations just because provider lookup fails.
        // Click-to-watch availability is handled separately by watch-provider endpoint.
        if (watchProviders.providers.length === 0) {
          console.log(`No AU providers for "${movieDetails.title}" - keeping recommendation`);
        }

        // Set the list source
        movieDetails.listSource = "ai-recommendation";

        return {
          movie: movieDetails,
          trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
          trailerUrls,
          reason: rec.reason,
        };
      } catch (error) {
        console.error(`Failed to resolve recommendation "${rec.title}":`, error);
        return null;
      }
    });

    // Wait for all promises and filter out nulls
    const resolvedRecs = await Promise.all(recPromises);
    const recommendations = resolvedRecs.filter((r): r is Recommendation => r !== null).slice(0, 5);

    // Backfill to preserve "5 recommendations" behavior when some LLM picks fail resolution.
    if (recommendations.length < 5) {
      const allMovies = getAllMovies();
      const usedIds = new Set<number>([
        ...Array.from(chosenTmdbIds),
        ...recommendations.map((r) => r.movie.tmdbId),
      ]);

      const candidates = shuffleArray(
        allMovies.filter((m) => {
          if (usedIds.has(m.tmdbId)) return false;
          if (!m.posterPath || !m.posterPath.trim()) return false;
          if (initialGenreFilters.length > 0 && !matchesGenreFilters(m, initialGenreFilters)) return false;
          return true;
        })
      );

      for (const candidate of candidates) {
        if (recommendations.length >= 5) break;
        let trailerUrls = await getMovieTrailers(candidate.tmdbId);
        if (trailerUrls.length === 0) {
          trailerUrls = await getFallbackTrailerUrls(candidate.title, candidate.year);
        }
        if (trailerUrls.length === 0) continue;

        recommendations.push({
          movie: { ...candidate, listSource: "ai-backfill" },
          trailerUrl: trailerUrls[0],
          trailerUrls,
          reason: `Based on your choices, this ${candidate.genres.slice(0, 2).join("/")} pick should fit your taste.`,
        });
        usedIds.add(candidate.tmdbId);
      }
    }

    // Add a "wildcard" random pick from the catalogue for variety
    const allMovies = getAllMovies();
    const usedTmdbIds = new Set([
      ...Array.from(chosenTmdbIds),
      ...recommendations.map((r) => r.movie.tmdbId),
    ]);
    
    const eligibleWildcards = allMovies.filter((m) => {
      if (usedTmdbIds.has(m.tmdbId)) return false;
      if (!m.rating || m.rating < 7.0) return false;
      if (initialGenreFilters.length > 0 && !matchesGenreFilters(m, initialGenreFilters)) return false;
      return true;
    });
    
    if (eligibleWildcards.length > 0) {
      const wildcardMovie = shuffleArray([...eligibleWildcards])[0];
      const [wildcardTrailers, wildcardProviders] = await Promise.all([
        getMovieTrailers(wildcardMovie.tmdbId),
        getWatchProviders(wildcardMovie.tmdbId, wildcardMovie.title, wildcardMovie.year),
      ]);

      let wildcardTrailerUrls = wildcardTrailers;
      if (wildcardTrailerUrls.length === 0) {
        wildcardTrailerUrls = await getFallbackTrailerUrls(wildcardMovie.title, wildcardMovie.year);
      }

      // Require poster + trailer only for surprise picks.
      if (
        wildcardMovie.posterPath &&
        wildcardMovie.posterPath.trim() &&
        wildcardTrailerUrls.length > 0
      ) {
        recommendations.push({
          movie: { ...wildcardMovie, listSource: "wildcard" },
          trailerUrl: wildcardTrailerUrls[0],
          trailerUrls: wildcardTrailerUrls,
          reason: `A surprise pick from our curated collection! This ${wildcardMovie.genres.slice(0, 2).join("/")} gem from ${wildcardMovie.year} might just become your next favorite.`,
        });
      } else {
        console.log(`Skipping wildcard "${wildcardMovie.title}" - missing poster or trailer`);
      }
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
      let trailerUrls = await getMovieTrailers(movie.tmdbId);
      if (trailerUrls.length === 0) {
        trailerUrls = await getFallbackTrailerUrls(movie.title, movie.year);
      }
      fallbackRecs.push({
        movie,
        trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
        trailerUrls,
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
      cast: m.cast?.slice(0, 5) || [], // Increased from 3 to 5
      keywords: m.keywords?.slice(0, 10) || [], // Increased from 5 to 10
      round,
      weight,
    };
  });

  const rejectionHints = rejectedMovies.length > 0
    ? `\n\nThey REJECTED: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}" (${m.genres[0]})`).join(", ")} - avoid similar styles.`
    : "";

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

  const prompt = `You're a passionate film buff helping a friend find something new to watch. Based on their picks, you KNOW their taste:

${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥" : ""}: "${m.title}" (${m.year}) - Director: ${m.director}, Cast: ${m.cast.join(", ") || "Unknown"}, Themes: ${m.keywords.join(", ") || "N/A"}`).join("\n")}${rejectionHints}

They've dismissed ${excludeTmdbIds.length} suggestions already, so dig DEEPER into your film knowledge.

${categoryInstruction}

THINK MULTI-DIMENSIONALLY like a true cinephile:
- Actor connections: Same performers in different roles
- Director sensibilities: Same filmmaker or kindred vision
- Cinematographic style: Visual language that resonates
- Era matching: If they love 80s, suggest 80s or modern films with retro spirit
- Thematic resonance: WHY the deeper themes connect

Make an unexpected but perfect connection - not just genre matching!
English-language or mainstream crossover. Well-rated only (7.0+).

[Seed: ${randomSeed}]

Respond in JSON:
{
  "title": "Movie Title",
  "year": 2020,
  "reason": "Personalized 1-2 sentences explaining the CONNECTION using 'you' and 'your'"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200, // Reduced for faster response
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
        const [tmdbTrailers, watchProviders] = await Promise.all([
          getMovieTrailers(fallbackMovie.tmdbId),
          getWatchProviders(fallbackMovie.tmdbId, fallbackMovie.title, fallbackMovie.year),
        ]);
        
        // Skip if no poster or trailer
        if (!fallbackMovie.posterPath || !fallbackMovie.posterPath.trim()) {
          return null;
        }
        let trailerUrls = tmdbTrailers;
        if (trailerUrls.length === 0) {
          trailerUrls = await getFallbackTrailerUrls(fallbackMovie.title, fallbackMovie.year);
        }
        if (trailerUrls.length === 0) {
          return null;
        }
        // Keep replacement even if providers are currently unavailable.
        if (watchProviders.providers.length === 0) {
          console.log(`Replacement fallback "${fallbackMovie.title}" has no AU providers - keeping replacement`);
        }
        
        return {
          movie: { ...fallbackMovie, listSource: "replacement" },
          trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
          trailerUrls,
          reason: `A great pick based on your taste in ${fallbackMovie.genres.slice(0, 2).join(" and ")} films!`,
        };
      }
      return null;
    }

    // Get full movie details, trailers, and watch providers
    const [movieDetails, tmdbTrailers, watchProviders] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id),
      getWatchProviders(searchResult.id, result.title, result.year ?? null),
    ]);
    
    if (!movieDetails) return null;
    
    // Skip if no poster, trailer, or streaming
    if (!movieDetails.posterPath || !movieDetails.posterPath.trim()) {
      console.log(`Skipping replacement "${movieDetails.title}" - no poster`);
      return null;
    }
    let trailerUrls = tmdbTrailers;
    if (trailerUrls.length === 0) {
      trailerUrls = await getFallbackTrailerUrls(movieDetails.title, movieDetails.year);
    }
    if (trailerUrls.length === 0) {
      console.log(`Skipping replacement "${movieDetails.title}" - no trailer`);
      return null;
    }
    if (watchProviders.providers.length === 0) {
      console.log(`Replacement "${movieDetails.title}" has no AU providers - keeping replacement`);
    }

    movieDetails.listSource = "replacement";

    return {
      movie: movieDetails,
      trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
      trailerUrls,
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
      const [tmdbTrailerUrls, watchProviders] = await Promise.all([
        getMovieTrailers(fallbackMovie.tmdbId),
        getWatchProviders(fallbackMovie.tmdbId, fallbackMovie.title, fallbackMovie.year),
      ]);

      let trailerUrls = tmdbTrailerUrls;
      if (trailerUrls.length === 0) {
        trailerUrls = await getFallbackTrailerUrls(fallbackMovie.title, fallbackMovie.year);
      }

      // Require trailer only for replacement fallback.
      if (trailerUrls.length === 0) {
        return null;
      }
      
      return {
        movie: { ...fallbackMovie, listSource: "replacement" },
        trailerUrl: trailerUrls.length > 0 ? trailerUrls[0] : null,
        trailerUrls,
        reason: `A fresh pick for your ${fallbackMovie.genres[0]} cravings!`,
      };
    }
    
    return null;
  }
}
