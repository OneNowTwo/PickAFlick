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

  const randomSeed = Math.floor(Math.random() * 100000);
  const sessionTime = new Date().toISOString();

  // Build exclusion list from cross-session memory only (no permanent blacklist)
  const chosenTitles = chosenMovies.map(m => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-40);

  const currentYear = new Date().getFullYear();
  const recentThreshold = currentYear - 3;

  const filterContext = initialGenreFilters.length > 0
    ? `\n🎯 **USER'S INITIAL MOOD/GENRE FILTERS**: They specifically chose to explore ${initialGenreFilters.join(", ")} films. This tells you their starting intent — honour it but don't be constrained by it.\n`
    : "";

  const prompt = `You are a world-class film critic and cinema historian with deep knowledge of GLOBAL cinema spanning 100+ years. You're like a Criterion Collection curator meets film school professor meets that friend who's seen 10,000 movies and can match anyone's taste with uncanny precision.

A user played a head-to-head picker game where they chose 7 movies (and rejected 7 others). This A/B test gives you BOTH positive AND negative signals about their exact taste. Your job is to use these signals to make the most perfectly matched recommendations possible.${filterContext}

${recentExclusions.length > 0 ? `=== ❌ RECENTLY RECOMMENDED — DO NOT REPEAT ===

These films have been recommended in recent sessions. Avoid them to ensure fresh discoveries:
${recentExclusions.map(t => `• ${t}`).join("\n")}

` : ""}The user themselves chose: ${chosenTitles} — exclude these too.

=== 🎯 A/B TEST RESULTS — THIS IS THE CORE DATA ===

**THE POSITIVE SIGNAL — What they CHOSE:**

${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥 (STRONGER SIGNAL — later choice)" : ""}
  "${m.title}" (${m.year}, ${m.era}) — Rating: ${m.rating || "N/A"}/10
  Director: ${m.director}
  Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
  PRIMARY Genre: ${m.primaryGenre}
  All Genres: ${m.allGenres.join(", ")}
  Keywords/Themes: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
  Synopsis: ${m.overview || "No synopsis available"}`).join("\n\n")}

**THE NEGATIVE SIGNAL — What they REJECTED (and what beat it):**

${rejectionContext.length > 0 ? rejectionContext.map((m) => `Round ${m.round}: REJECTED "${m.title}" (${m.year})
  Genre: ${m.primaryGenre} | Director: ${m.director}
  Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
  Keywords: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
  Synopsis: ${m.overview || "N/A"}
  ↳ CHOSE INSTEAD: ${m.lostTo}
  ↳ WHAT THIS TELLS YOU: They actively passed on ${m.primaryGenre}/${m.director}'s style in favour of something else. This is a precise taste signal.`).join("\n\n") : "No rejection data available"}

=== 🎬 MULTI-DIMENSIONAL TASTE ANALYSIS — DO ALL OF THESE ===

The A/B test tells you FAR more than genre. Analyse every dimension:

1. **Genre Signals**: Not just "they like Action" — what TYPE? Gritty realism vs CGI spectacle? Character-driven vs set pieces? What did the rejections eliminate?

2. **Era & Period**: Are they drawn to 70s grit, 80s neon, 90s indie, 2000s prestige, modern aesthetics? Every pick and rejection narrows this.

3. **Director & Actor Sensibility**: Did they pick Villeneuve over Bay? Phoenix over Cruise? These choices reveal taste in craft, not just entertainment.

4. **Cinematographic Style**: Handheld rawness vs. carefully composed frames? Naturalistic lighting vs. heightened/stylised? Desaturated grit vs. rich colour? This is often MORE important than genre.

5. **Pacing & Rhythm**: Slow-burn and meditative vs. kinetic and propulsive? Did they pick the 2-hour slow drama over the 90-minute thriller? Pace preference is diagnostic.

6. **Script & Dialogue Style**: Sharp/witty vs. sparse/naturalistic vs. poetic vs. functional? Did they choose the dialogue-heavy film or the more visual one?

7. **Tone & Emotional Register**: Cold/detached, warm/intimate, oppressive/tense, playful/ironic, melancholic/beautiful. Two films can share a genre but feel COMPLETELY different tonally.

8. **Themes & Substance**: Existential questions, social commentary, psychological depth, pure entertainment? The keywords tell you what content they connect with.

9. **Cinematic Texture & Feel** — THIS IS CRITICAL AND OFTEN MISSED:
   - Production texture: gritty/grimy realism, polished studio sheen, lo-fi indie rawness, dream-like surrealism
   - Score character: electronic/synthetic, orchestral/sweeping, minimal/diegetic, silence as sound design
   - Color palette: desaturated/grey, warm/golden hour, neon/heightened, cold/clinical, nostalgic/faded
   - Emotional texture: the FEELING you leave the cinema with — gutted, exhilarated, unsettled, comforted, provoked
   - A Fincher thriller and a Dardennes thriller are NOT interchangeable. A Villeneuve sci-fi and a Luc Besson sci-fi are NOT interchangeable. Match the TEXTURE, not just the label.

10. **USE THE REJECTIONS AS NEGATIVE FILTERS**: 
    - If they rejected a loud action film for a quiet drama — they want substance over spectacle
    - If they rejected a warm romantic film for a cold thriller — they want tension over comfort
    - If they rejected a director's famous work — they may not connect with that filmmaker's sensibility
    - Every rejection eliminates a category of films from your recommendations

⚠️ **RECENCY WEIGHTING**: Rounds 5-7 (marked 🔥) are MORE IMPORTANT — their taste crystallised as they went. Weight these choices 1.5x more heavily in your analysis.

=== 🎲 DIVERSITY REQUIREMENT ===

Diversity Seed: ${randomSeed}. Use this to deterministically vary your exploration:
- Seed ending 0-1: Prioritise 1970s–1980s cinema and neo-noir
- Seed ending 2-3: Prioritise underseen European / Latin American / African cinema
- Seed ending 4-5: Prioritise 1990s–2000s indie and cult films
- Seed ending 6-7: Prioritise recent (last 5 years) lesser-known releases
- Seed ending 8-9: Prioritise 2010s arthouse and prestige dramas

**MANDATORY ANTI-REPETITION:**
1. For every film you first think of — go one level deeper. The obvious choice is rarely the best match.
2. If a film appears in the top 20 Google results for its genre — too obvious, skip it
3. Recommend directors' lesser-known works, NOT their most famous films
4. At least 2 of your 7 must be from outside the US/UK
5. No two recommendations from the same director or franchise
6. **BRAINSTORM 4 OPTIONS PER SLOT, then choose the most precisely matched one** — not the first that came to mind

=== 🎯 RECOMMENDATION QUALITY STANDARD ===

Each recommendation must:
- Address the user as "you" and "your"
- Reference SPECIFIC films from their picks to explain the connection
- Include at least ONE intangible quality (pacing, visual texture, tonal feel, script approach, emotional register, score) that directly links to something they chose or rejected
- Go beyond genre — explain the FEEL, not just the category
- Be genuinely surprising yet perfectly matched — "I didn't expect to love this but I couldn't stop watching"

=== VARIETY REQUIREMENTS ===

Your 10 recommendations MUST include:
1. **ONE RECENT (${recentThreshold}-${currentYear})**: Something from the last 3 years that matches their taste
2. **ONE UNDERSEEN GEM**: Critically acclaimed but lesser-known — a discovery
3. **ONE CLASSIC (pre-2010)**: A foundational film that connects to their preferences
4. **SEVEN FLEXIBLE**: Mix of eras, but each with a SPECIFIC multi-dimensional reason

=== QUALITY STANDARDS ===

**INCLUDE:**
- Critically acclaimed (RT 70%+, Metacritic 65+, or IMDb 7.0+)
- English-language OR prestigious international films with wide recognition
- Award winners/nominees (Oscar, BAFTA, Cannes, etc.) or cult classics

**NEVER RECOMMEND:**
- Direct-to-streaming cheaply-made content
- Low-budget horror with <6.0 ratings
- Obscure films with <10,000 IMDb ratings unless festival darlings

=== OUTPUT FORMAT ===

Respond in this exact JSON format:
{
  "topGenres": ["genre1", "genre2", "genre3"],
  "themes": ["theme1", "theme2", "theme3"],
  "preferredEras": ["era1", "era2"],
  "visualStyle": "One punchy sentence (15-25 words) about their visual/cinematic taste, referencing 1-2 specific films they chose.",
  "mood": "One punchy sentence (15-25 words) about their emotional/tonal preferences, referencing 1-2 specific picks.",
  "recommendations": [
    {"title": "Recent Film Title", "year": ${currentYear}, "reason": "Personalised reason referencing their specific picks and at least one intangible quality", "category": "recent"},
    {"title": "Underseen Gem Title", "year": 2015, "reason": "Why this hidden gem fits — reference texture/feel/pacing", "category": "underseen"},
    {"title": "Classic Title", "year": 1995, "reason": "Why this older film connects — reference specific quality from their picks", "category": "classic"},
    {"title": "Flexible Pick 1", "year": 2019, "reason": "Personalised, multi-dimensional reason", "category": "flexible"},
    {"title": "Flexible Pick 2", "year": 2021, "reason": "Personalised, multi-dimensional reason", "category": "flexible"},
    {"title": "Flexible Pick 3", "year": 2017, "reason": "Personalised, multi-dimensional reason", "category": "flexible"},
    {"title": "Flexible Pick 4", "year": 2016, "reason": "Personalised, multi-dimensional reason", "category": "flexible"},
    {"title": "Backup Pick 1", "year": 2018, "reason": "Alternative — different angle on their taste", "category": "backup"},
    {"title": "Backup Pick 2", "year": 2020, "reason": "Alternative — different angle on their taste", "category": "backup"},
    {"title": "Backup Pick 3", "year": 2014, "reason": "Alternative — different angle on their taste", "category": "backup"}
  ]
}

CRITICAL: Exactly 10 recommendations. First must be recent (${recentThreshold}-${currentYear}). One underseen gem. One pre-2010 classic. All reasons must reference their actual picks and include intangible qualities.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.92,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const analysis: AIAnalysis = JSON.parse(content);

    const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));

    // Resolve all 7 LLM recommendations in parallel — no streaming filter, poster + trailer only
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
    const mainRecs = resolvedRecs.slice(0, 6);
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
      .filter((m) => !chosenMovies.some((c) => c.tmdbId === m.tmdbId))
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
