import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse, RecommendationLane } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailer, getMovieTrailers, getMovieDetails, getWatchProviders } from "./tmdb";
import { getAllMovies } from "./catalogue";
import { storage } from "./storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

/** Override with e.g. gpt-4o-mini for lower latency (default keeps current behaviour). */
const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";

// Cross-session memory — persisted to DB so server restarts don't wipe it
const recentlyRecommendedTitles: string[] = [];
/** Keep a long tail so repeat titles across sessions drop in probability */
const MAX_RECENT_TRACKED = 400;
/** How many recent titles to inject into the prompt (must be ≤ MAX_RECENT_TRACKED). Smaller = faster LLM; collision detection still uses the full in-memory list. */
const RECENT_EXCLUSIONS_PROMPT_COUNT = 90;
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

/** Short system preamble so lane wins over contradictory user-message bullets (OpenAI habit). */
function systemMessageForLane(lane: RecommendationLane): string {
  const labels: Record<RecommendationLane, string> = {
    mainstream: "MAINSTREAM",
    movie_buff: "MOVIE BUFF",
    left_field: "LEFT FIELD",
  };
  return `You are PickAFlick's recommender. The user chose lane ${labels[lane]}.

CRITICAL: Later instructions may use words like "popular", "recognisable", or "crowd-pleasing". You MUST interpret those ONLY through this lane's meaning. If generic text conflicts with ${labels[lane]}, follow ${labels[lane]}.

The A/B funnel evidence is always the spine — but HOW bold vs safe the picks are is decided ONLY by ${labels[lane]}.`;
}

/**
 * Lane instructions — duplicated at end as compliance checklist (models often skip mid-prompt).
 */
function lanePrimaryTask(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `=== PRIMARY TASK — LANE: MAINSTREAM ===
Deliver the **accessible default row**: polished, broadly appealing, **easy "good tonight"** films that still match their A/B taste. This is what people mean by "something good on" — **not** obscure.

- Vary studios, eras, and subgenres; avoid **seven films that feel like the same movie**.
- The funnel is the **only** justification for each title — not IMDb Top 250 nostalgia.`;
    case "movie_buff":
      return `=== PRIMARY TASK — LANE: MOVIE BUFF ===
**You must NOT output the model's default "smart recommendation" row** — seven similar US prestige / blockbuster-adjacent films **cut from the same cloth**.

Deliver **more specific, less obvious** picks that still express the **same** A/B taste pattern. Think: **where would a film buff go after rejecting the obvious row?** — acclaimed indie, international, auteur, mid-budget festival fare — **not** micro-budget experiments.

- **Hard:** at least **4 of 7** titles should be films a casual streamer **would not** name in 10 seconds (i.e. not the usual Reddit / Letterboxd top-20 suspects for that vibe).
- **Avoid** leaning entirely on globally meme-famous international titles (*Parasite*, *Oldboy*, *Pan's Labyrinth*, etc.) — **at most one** such anchor; find **less exposed** films with the **same emotional DNA**.
- **Australia:** every film plausibly findable (rent / major streamers / SBS / Mubi / etc.).`;
    case "left_field":
      return `=== PRIMARY TASK — LANE: LEFT FIELD ===
**"Foreign prestige everyone has heard of" is NOT Left Field** — that is still mainstream, just subtitled.

Go **one tier deeper**: festival depth, regional cinema, **non-obvious** work by serious directors — **not** their most famous film unless the A/B pattern demands it.

- **Hard:** at least **5 of 7** should feel like **discovery** to someone who only watches Netflix top-10.
- **Hard:** **at most one** "globally household name" international title (Oscar/Palme meme-tier) — the rest must be **less exposed** with the same **pattern** (tone, morality, craft) from their A/B picks.
- **Australia:** still actually watchable here (rent / SBS / Mubi / niche streamers — say so in reason text when helpful).`;
  }
}

function laneCulturalBreadthLine(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `"Recognisable" includes: **big non-US hits**, **famous crossover** films, **beloved Hollywood**, **crowd-pleasers** — spread across **different cultural lanes** (multiplex vs cable-famous vs streaming hit) while matching their profile.`;
    case "movie_buff":
      return `**Cultural breadth here means variety of *specific* films** — not variety of famous IP. Mix **indie, international, auteur**, and **one** wider-audience anchor if needed. **Do not** use this section as an excuse to pick seven blockbusters.`;
    case "left_field":
      return `**Ignore** generic "crowd-pleasing blockbuster" language for this lane. Breadth = **different countries, eras, and subgenres of serious cinema** — still **A/B-justified**.`;
  }
}

function laneQualityLine(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return "- **Quality:** Broadly popular / well-voted; findable in Australia; no micro-budget obscurities.";
    case "movie_buff":
      return "- **Quality:** Well-reviewed and **substantive** — **not** all household-name; at least half should be **outside** the obvious default set for that taste; findable in Australia.";
    case "left_field":
      return "- **Quality:** Critically strong **or** festival-respected; **deliberately** less obvious than mainstream; still real releases with verifiable title+year; findable in Australia; no micro-budget obscurities.";
  }
}

/** Repeated immediately before JSON — models often attend to the end. */
function laneComplianceBeforeJson(lane: RecommendationLane): string {
  switch (lane) {
    case "mainstream":
      return `=== STOP — CHECK LANE (MAINSTREAM) BEFORE JSON ===
- [ ] 7 films are **accessible / good-tonight** level, not a cinephile-only list
- [ ] Titles **vary** (not same cloth × 7)
- [ ] Every pick ties to **A/B evidence**`;
    case "movie_buff":
      return `=== STOP — CHECK LANE (MOVIE BUFF) BEFORE JSON ===
- [ ] **NOT** the default 7 similar blockbusters / prestige clones
- [ ] **≥4** picks are **not** obvious first answers a casual fan would shout out
- [ ] **≤1** globally meme-famous international anchor (Parasite/Oldboy/Pan's etc. tier)
- [ ] Every pick ties to **A/B evidence**`;
    case "left_field":
      return `=== STOP — CHECK LANE (LEFT FIELD) BEFORE JSON ===
- [ ] **NOT** a row of "famous foreign film" defaults
- [ ] **≥5** picks feel like **discovery** to a casual viewer
- [ ] **≤1** globally household-name prestige title
- [ ] Every pick ties to **A/B evidence**`;
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
    max_tokens: 2000,
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

  const curatorPreamble = `
=== SOURCE OF TITLES ===
You are **not** limited to any in-app catalogue. Use real films — any country — with accurate **English release title + year** for lookup. **Follow the PRIMARY TASK lane above first**; do not default to a generic "best movies" list.

=== RELEASE YEAR — PRE-1970 CAP ===
At most **${MAX_PRE_1970_FILMS}** of the 7 films may have a theatrical release year **before 1970** (i.e. 1969 or earlier). The rest must be **1970 or later**. If a classic pre-1970 title truly fits best, use **one**; do not stack multiple oldies unless the user's A/B choices are overwhelmingly classic-era (still respect the cap).

=== ERA BREADTH (within 1970+) ===
Across the six **1970+** slots, spread decades where it fits their profile — include at least one **2020 or newer** when it fits, so the row is not all 1990s–2010s.
`;

  const laneTask = lanePrimaryTask(lane);

  const prompt = `${laneTask}

You are a sharp film curator. The user finished a 7-step funnel: early rounds explore contrast; later rounds (🔥) matter more. Infer ONE clear taste profile from the whole run — then recommend 7 films that **vary** within that profile (different subgenres, eras, pacing, "vibes") so the list feels like a rich menu, not seven copies of the same film.${filterContext}
${curatorPreamble}

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

=== CULTURAL BREADTH (lane-specific) ===
${laneCulturalBreadthLine(lane)}

=== HOW TO PICK 7 ===
- **Not one niche:** Avoid seven films that are all the same tone/band even if genres differ on paper.
${laneQualityLine(lane)}
- **Hard rules:** No two from the same director or same franchise. Respect the **pre-1970 cap** above.

${laneComplianceBeforeJson(lane)}

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

Return exactly 7 recommendations. Each \`year\` must be the film's theatrical release year; **at most one** may be before 1970. Each reason must name at least one of their actual chosen films.`;

  try {
    const llmTemp = temperatureForLane(lane);
    let analysis = await callRecommendationsLLM(prompt, llmTemp, systemMessageForLane(lane));

    if (!analysis.recommendations || !Array.isArray(analysis.recommendations) || analysis.recommendations.length === 0) {
      console.error("[ai-recommender] LLM returned no recommendations array. Keys:", Object.keys(analysis));
      throw new Error("LLM returned no recommendations");
    }

    const recentHits = countRecentCollisions(analysis.recommendations, recentTitlesSet);
    const pre1970Count = countPre1970(analysis.recommendations);
    const needsRetry = recentHits >= 2 || pre1970Count > MAX_PRE_1970_FILMS;

    if (needsRetry) {
      console.warn(
        `[ai-recommender] Retrying LLM: ${recentHits} recent-title collision(s), ${pre1970Count} pre-1970 pick(s) (max ${MAX_PRE_1970_FILMS})`
      );
      const fixPrompt = `${prompt}

=== REGENERATE (strict) ===
Your previous answer broke rules: **zero** titles from the DO NOT RECOMMEND list; at most **one** film with release year before 1970; each reason must tie to their A/B picks. Output valid JSON only with **7 completely NEW titles**.

Re-read **PRIMARY TASK** and **STOP — CHECK LANE** for this request — your last answer must satisfy the lane, not a generic good list.`;
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
    const wildcardCandidates = eligibleWildcards
      .filter((m) => m.posterPath && m.posterPath.trim())
      .slice(0, 10);
    const trailerResults =
      wildcardCandidates.length > 0
        ? await Promise.all(
            wildcardCandidates.map(async (candidate) => ({
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
