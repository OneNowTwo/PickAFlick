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
/** Keep a long tail so repeat titles across sessions drop in probability */
const MAX_RECENT_TRACKED = 400;
/** How many recent titles to inject into the prompt (must be ≤ MAX_RECENT_TRACKED) */
const RECENT_EXCLUSIONS_PROMPT_COUNT = 200;
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

/**
 * Titles models over-recommend on “smart” taste — cap how many may appear per response.
 * Not exhaustive; extend as you spot repeats in PostHog / support tickets.
 */
/** Stricter = fewer "award carousel" titles per response */
const USUAL_SUSPECTS_MAX = 1;
const USUAL_SUSPECTS_TITLES_LOWER = new Set(
  [
    "gone girl",
    "the prestige",
    "arrival",
    "drive",
    "mad max: fury road",
    "the lord of the rings: the fellowship of the ring",
    "the lord of the rings the fellowship of the ring",
    "1917",
    "in bruges",
    "get out",
    "the cabin in the woods",
    "the nice guys",
    "knives out",
    "annihilation",
    "inside man",
    "la la land",
    "the wolf of wall street",
    "the grand budapest hotel",
    "catch me if you can",
    "the social network",
    "shutter island",
    "the talented mr. ripley",
    "her",
    "donnie darko",
    "no country for old men",
    "prisoners",
    "interstellar",
    "inception",
    "fight club",
    "the dark knight",
    "blade runner 2049",
    "ex machina",
    "whiplash",
    "nightcrawler",
    "zodiac",
    "se7en",
    "the silence of the lambs",
    "parasite",
    "everything everywhere all at once",
    "dune",
    "oppenheimer",
    "barbie",
    "the revenant",
    "the matrix",
    "edge of tomorrow",
    "fantastic beasts and where to find them",
    "march of the penguins",
    "life of pi",
    "the hunt for red october",
    "schindler's list",
    "schindlers list",
    "amy",
    "heat",
    "birdman",
    "the sixth sense",
    "the shape of water",
    "the curious case of benjamin button",
    "the witch",
    "deadpool",
    "midnight in paris",
    "ford v ferrari",
    "green book",
    "the trial of the chicago 7",
    "the jungle book",
    "chef",
    "10 things i hate about you",
    "call me by your name",
    "the fault in our stars",
    "spider-man: far from home",
    "spider-man far from home",
    "easy a",
    "gladiator",
    "jojo rabbit",
    "hugo",
    "tangled",
  ].map((t) => t.toLowerCase().trim())
);

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, "");
}

function countUsualSuspects(recs: { title: string }[]): number {
  return recs.filter((r) => USUAL_SUSPECTS_TITLES_LOWER.has(r.title.toLowerCase().trim())).length;
}

function countRecentCollisions(recs: { title: string }[], recentSet: Set<string>): number {
  return recs.filter((r) => recentSet.has(normalizeTitleKey(r.title))).length;
}

async function callRecommendationsLLM(promptText: string): Promise<AIAnalysis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: promptText }],
    response_format: { type: "json_object" },
    max_tokens: 2200,
    temperature: 0.88,
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

  // Build exclusion list from cross-session memory (large list → lower repeat rate across sessions)
  const chosenTitles = chosenMovies.map(m => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map((t) => normalizeTitleKey(t)));

  const filterContext = initialGenreFilters.length > 0
    ? `\nStarting mood (supporting only): the user hinted at these genres before the funnel: ${initialGenreFilters.join(", ")}. The A/B evidence below is the primary signal — use the funnel profile first.\n`
    : "";

  const usualSuspectsRule = `
=== SOURCE OF TITLES (read this) ===
You are NOT choosing from any app database or catalogue we gave you. Use your full knowledge of real released films — any country, any era — the way a human curator would. We only need correct **English title + year** to look films up (same as recommending from memory and film culture at large).

=== ANTI–"USUAL SUSPECTS" (critical) ===
Models default to the same ~50 "Reddit / Letterboxd / film-bro" prestige titles (2000s–2010s psych-thrillers, same A-list directors). **Do not fill the list with those.**

- At most **${USUAL_SUSPECTS_MAX}** of your 7 picks may be from this overused cluster (examples — also avoid obvious equivalents): Gone Girl, The Prestige, Drive, Knives Out, Parasite, Dune, Arrival, Grand Budapest Hotel, Green Book, 1917, The Revenant, The Matrix, etc.
- The **other ${7 - USUAL_SUSPECTS_MAX}** must be **recognisable** but **not** the same Oscar-season / "Netflix top 10 for smart people" row. Think: **studio hits, cult favourites, famous international crossovers, iconic older Hollywood** — still household-level, but **different cultural lanes** (not seven Best Picture nominees from the 2010s).
- If their taste is genuinely that cluster, still obey the **${USUAL_SUSPECTS_MAX}-from-list cap** and use **adjacent** equally famous films.

=== ERA SPREAD (unless profile is purely one era) ===
Include **at least one** widely known film **before 1990** and **at least one** from **2020+** (still mainstream: major release / cultural footprint). This breaks the "all 2005–2016" clump.
`;

  const prompt = `You are a sharp film curator. The user finished a 7-step funnel: early rounds explore contrast; later rounds (🔥) matter more. Infer ONE clear taste profile from the whole run — then recommend 7 films that **vary** within that profile (different subgenres, eras, pacing, "vibes") so the list feels like a rich menu, not seven copies of the same film.${filterContext}
${usualSuspectsRule}

${recentExclusions.length > 0 ? `=== DO NOT RECOMMEND — already shown in recent sessions ===
${recentExclusions.map(t => `• ${t}`).join("\n")}

` : ""}Never recommend these (their own picks): ${chosenTitles}

=== EVIDENCE — what they chose (🔥 rounds weighted more) ===
${movieDescriptions.map((m) => `Round ${m.round}${m.weight > 1 ? " 🔥" : ""}: "${m.title}" (${m.year}) — ${m.primaryGenre} | Dir: ${m.director} | Cast: ${m.cast.length > 0 ? m.cast.join(", ") : "Unknown"}
  Keywords: ${m.keywords.length > 0 ? m.keywords.join(", ") : "N/A"}
  Synopsis: ${m.overview || "N/A"}`).join("\n\n")}

=== EVIDENCE — what they rejected ===
${rejectionContext.length > 0 ? rejectionContext.map((m) => `Round ${m.round}: rejected "${m.title}" (${m.year}, ${m.primaryGenre}) vs chose ${m.lostTo}`).join("\n\n") : "No rejection data"}

=== PROFILE ===
Summarise what they like and what rejections ruled out. 🔥 rounds pull more weight.

=== A/B MUST DRIVE THE LIST (non-negotiable) ===
These recommendations exist **because** of this session's picks and rejects — not as a generic "good movies" row. **Every** reason must:
- Name **at least one film they actually chose** in the funnel, AND
- Explain **why this recommendation matches the *pattern* of their choices vs rejects** (tone, era, pacing, genre — not vague praise).

If you cannot tie a film to their evidence, pick a different film.

=== CULTURAL BREADTH (recognisable ≠ vanilla) ===
"Recognisable" includes: **big non-US hits**, **famous non-English crossover** films, **beloved 70s–90s Hollywood**, **crowd-pleasing blockbusters**, **well-known comedy/horror/action** — not only late-capital prestige drama. Spread films across **different "where it lives in culture"** (arthouse crossover vs multiplex vs classic cable-TV famous vs streaming-era hit) while still matching their profile.

=== HOW TO PICK 7 ===
- **Not one niche:** Avoid seven films that are all the same "award-bait" band even if genres differ on paper.
- **Quality:** Broadly popular / well-voted; findable in Australia; no micro-budget obscurities.
- **Hard rules:** No two from the same director or same franchise. **Visible year spread** — include at least one **pre-1990** famous title and at least one **2020+** title when the profile allows.

=== OUTPUT — exact JSON only ===
{
  "topGenres": ["up to 3 genres spanning their taste, not a single label repeated"],
  "themes": ["2-4 themes"],
  "preferredEras": ["decade bands they lean toward"],
  "visualStyle": "One sentence, 'you/your', screen feel",
  "mood": "One sentence, 'you/your', emotional register",
  "recommendations": [
    {"title": "Film Title 1", "year": 2022, "reason": "1-2 sentences: tie to their A/B evidence; name a film they chose; what cultural lane this fills (not generic praise)", "category": "flexible"},
    {"title": "Film Title 2", "year": 1999, "reason": "same idea", "category": "flexible"},
    {"title": "Film Title 3", "year": 2016, "reason": "same idea", "category": "flexible"},
    {"title": "Film Title 4", "year": 2014, "reason": "same idea", "category": "flexible"},
    {"title": "Film Title 5", "year": 2019, "reason": "same idea", "category": "flexible"},
    {"title": "Film Title 6", "year": 2011, "reason": "same idea", "category": "flexible"},
    {"title": "Film Title 7", "year": 2008, "reason": "same idea", "category": "flexible"}
  ]
}

Return exactly 7 recommendations. Each reason must name at least one of their actual chosen films.`;

  try {
    let analysis = await callRecommendationsLLM(prompt);

    if (!analysis.recommendations || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      console.error("[ai-recommender] LLM returned no recommendations array. Keys:", Object.keys(analysis));
      throw new Error("LLM returned no recommendations");
    }

    const recentHits = countRecentCollisions(analysis.recommendations, recentTitlesSet);
    const needsRetry =
      countUsualSuspects(analysis.recommendations) > USUAL_SUSPECTS_MAX ||
      recentHits >= 2;

    if (needsRetry) {
      console.warn(
        `[ai-recommender] Retrying LLM: usual-suspects over cap and/or ${recentHits} recent-title collision(s)`
      );
      const fixPrompt = `${prompt}

=== REGENERATE (strict) ===
Your previous answer broke rules: at most ${USUAL_SUSPECTS_MAX} from the usual-suspects cluster; **zero** titles from the DO NOT RECOMMEND list; each reason must tie to their A/B picks. Output valid JSON only with **7 completely NEW titles**.`;
      analysis = await callRecommendationsLLM(fixPrompt);
    }

    if (!analysis.recommendations || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      throw new Error("LLM returned no recommendations after retry");
    }

    const usualSuspectCount = countUsualSuspects(analysis.recommendations);
    if (usualSuspectCount > USUAL_SUSPECTS_MAX) {
      console.warn(`[ai-recommender] usual-suspects count ${usualSuspectCount} still exceeds cap ${USUAL_SUSPECTS_MAX} after retry`);
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
