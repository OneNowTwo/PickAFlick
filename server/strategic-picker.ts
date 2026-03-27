/**
 * Strategic A/B Pair Selection
 *
 * Instead of random pairs, each round targets a specific "contrast axis" to
 * extract maximum taste signal from 7 choices. By the end the LLM has rich,
 * multi-dimensional data: genre preference, tone, era, pacing and prestige.
 *
 * Round 1 — genre axis   : dark/intense  vs light/fun          (pure genre signal)
 * Round 2 — tone axis    : dark          vs light               (confirms/refines mood)
 * Round 3 — era axis     : pre-2000      vs 2015+               (classic vs modern)
 * Round 4 — pacing axis  : slow-burn     vs kinetic/fast        (rhythm preference)
 * Round 5 — prestige axis: mainstream    vs critically acclaimed (taste level)
 * Rounds 6-7 — refinement: both in confirmed zone, differ on one remaining dimension
 */

import type { Movie } from "@shared/schema";

// Rolling cross-session memory — prevents the same movies appearing in back-to-back sessions
const recentlyShownInAB: number[] = []; // stores tmdbIds
const MAX_RECENT_AB = 300;

function recordShown(tmdbIds: number[]): void {
  for (const id of tmdbIds) {
    if (!recentlyShownInAB.includes(id)) {
      recentlyShownInAB.push(id);
      if (recentlyShownInAB.length > MAX_RECENT_AB) recentlyShownInAB.shift();
    }
  }
}

// ─── Heuristic scoring ─────────────────────────────────────────────────────

/** 1 = lightest/most fun, 10 = darkest/heaviest */
function scoreTone(movie: Movie): number {
  const dark = new Set(["Horror", "Thriller", "Crime", "War"]);
  const light = new Set(["Comedy", "Animation", "Family", "Romance"]);
  const mid = new Set(["Action", "Adventure", "Sci-Fi", "Fantasy", "Mystery"]);

  const primary = movie.genres[0] ?? "";
  let tone = 5;

  if (dark.has(primary)) tone = 7;
  else if (light.has(primary)) tone = 3;
  else if (mid.has(primary)) tone = 5;

  // Secondary genre modifiers
  const allGenres = movie.genres;
  if (allGenres.some(g => dark.has(g))) tone = Math.min(10, tone + 1);
  if (allGenres.some(g => light.has(g))) tone = Math.max(1, tone - 1);
  if (allGenres.includes("Drama") && tone >= 5) tone = Math.min(10, tone + 1);

  // Very high rated films skew toward prestige/drama territory
  if (movie.rating && movie.rating >= 8.5) tone = Math.min(10, tone + 1);

  return Math.round(tone);
}

/** 1 = slowest/most meditative, 10 = most kinetic/fast-paced */
function scorePacing(movie: Movie): number {
  const fast = new Set(["Action", "Thriller", "Horror", "Adventure"]);
  const slow = new Set(["Drama", "Documentary", "Romance"]);

  const primary = movie.genres[0] ?? "";
  let pacing = 5;

  if (fast.has(primary)) pacing = 7;
  else if (slow.has(primary)) pacing = 3;

  // Runtime heuristic: shorter films tend to feel faster
  if (movie.runtime) {
    if (movie.runtime < 95) pacing = Math.min(10, pacing + 1);
    else if (movie.runtime > 155) pacing = Math.max(1, pacing - 1);
  }

  if (movie.genres.includes("Animation")) pacing = Math.min(10, pacing + 1);

  return Math.round(pacing);
}

/** 1 = mainstream blockbuster, 10 = arthouse / critically acclaimed */
function scorePrestige(movie: Movie): number {
  const blockbuster = new Set(["Action", "Animation", "Family", "Adventure"]);
  const prestige = new Set(["Drama", "Documentary", "History"]);

  let p = 5;
  const r = movie.rating ?? 0;
  if (r >= 8.2) p = 8;
  else if (r >= 7.8) p = 7;
  else if (r >= 7.3) p = 6;
  else if (r < 6.5) p = 4;

  const primary = movie.genres[0] ?? "";
  if (prestige.has(primary)) p = Math.min(10, p + 1);
  if (blockbuster.has(primary)) p = Math.max(1, p - 1);

  return Math.round(p);
}

/** 1 = pre-1980, 2 = 1980s, 3 = 1990s, 4 = 2000s, 5 = 2010s, 6 = 2020s */
function scoreEra(movie: Movie): number {
  const y = movie.year;
  if (!y) return 3;
  if (y < 1980) return 1;
  if (y < 1990) return 2;
  if (y < 2000) return 3;
  if (y < 2010) return 4;
  if (y < 2020) return 5;
  return 6;
}

function genreBucket(movie: Movie): string {
  const genre = movie.genres[0] ?? "";
  if (["Horror", "Thriller", "Crime"].includes(genre)) return "dark-intense";
  if (["Drama", "Mystery", "Documentary", "History"].includes(genre)) return "drama-prestige";
  if (["Action", "Adventure", "War"].includes(genre)) return "action-adventure";
  if (["Sci-Fi", "Fantasy", "Animation"].includes(genre)) return "scifi-fantasy";
  if (["Comedy", "Family", "Romance"].includes(genre)) return "light-fun";
  return "indie-other";
}

interface ScoredMovie {
  movie: Movie;
  tone: number;
  pacing: number;
  prestige: number;
  era: number;
  bucket: string;
}

function buildScoreMap(movies: Movie[]): Map<number, ScoredMovie> {
  const map = new Map<number, ScoredMovie>();
  for (const m of movies) {
    map.set(m.tmdbId, {
      movie: m,
      tone: scoreTone(m),
      pacing: scorePacing(m),
      prestige: scorePrestige(m),
      era: scoreEra(m),
      bucket: genreBucket(m),
    });
  }
  return map;
}

// ─── Taste profile derived from choice history ──────────────────────────────

export interface ChoiceEntry {
  round: number;
  chosenMovie: Movie;
  rejectedMovie: Movie;
}

interface TasteProfile {
  avgTone: number;
  avgPacing: number;
  avgPrestige: number;
  avgEra: number;
  dominantBucket: string;
}

function deriveProfile(history: ChoiceEntry[], scoreMap: Map<number, ScoredMovie>): TasteProfile {
  if (history.length === 0) {
    return { avgTone: 5, avgPacing: 5, avgPrestige: 5, avgEra: 3.5, dominantBucket: "" };
  }
  let tone = 0, pacing = 0, prestige = 0, era = 0;
  const buckets: Record<string, number> = {};
  let n = 0;

  for (const h of history) {
    const s = scoreMap.get(h.chosenMovie.tmdbId);
    if (!s) continue;
    tone += s.tone;
    pacing += s.pacing;
    prestige += s.prestige;
    era += s.era;
    buckets[s.bucket] = (buckets[s.bucket] ?? 0) + 1;
    n++;
  }

  if (n === 0) return { avgTone: 5, avgPacing: 5, avgPrestige: 5, avgEra: 3.5, dominantBucket: "" };

  const dominantBucket = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return {
    avgTone: tone / n,
    avgPacing: pacing / n,
    avgPrestige: prestige / n,
    avgEra: era / n,
    dominantBucket,
  };
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick from the top qualifying candidates with significant randomness so the
 * same films don't dominate every session. We take the top 40% by the prefer
 * score, then shuffle that pool and return the first `count` entries.
 */
function pickBest(pool: ScoredMovie[], prefer: (s: ScoredMovie) => number, count = 8): Movie[] {
  const sorted = [...pool].sort((a, b) => prefer(b) - prefer(a));
  const topSlice = sorted.slice(0, Math.max(count * 4, Math.ceil(sorted.length * 0.4)));
  return shuffle(topSlice).slice(0, count).map(s => s.movie);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * selectStrategicPair
 *
 * @param round         1-indexed current round number
 * @param history       choices made so far (chosen + rejected per round)
 * @param allMovies     full catalogue
 * @param usedIds       movie IDs already shown this session (to avoid repeats)
 */
export function selectStrategicPair(
  round: number,
  history: ChoiceEntry[],
  allMovies: Movie[],
  usedIds: Set<number>
): [Movie, Movie] | null {

  // Build pool: English-language, post-1980, recognisable (rating ≥ 7.0), not already shown
  const alreadyShown = new Set([
    ...Array.from(usedIds),
    ...history.flatMap(h => [h.chosenMovie.tmdbId, h.rejectedMovie.tmdbId]),
    ...recentlyShownInAB,
  ]);

  const pool = allMovies.filter(m =>
    !alreadyShown.has(m.tmdbId) &&
    m.posterPath && m.posterPath.trim() &&
    m.year && m.year >= 1980 &&
    m.rating && m.rating >= 7.0 &&
    // English-language only — keeps pairs recognisable to the average user
    (!m.original_language || m.original_language === "en")
  );

  if (pool.length < 2) return null;

  const scoreMap = buildScoreMap(pool);
  const scored = pool.map(m => scoreMap.get(m.tmdbId)!).filter(Boolean);
  const profile = deriveProfile(history, scoreMap);

  let movieA: Movie | undefined;
  let movieB: Movie | undefined;

  switch (round) {
    // ── Round 1: genre axis ─────────────────────────────────────────────────
    case 1: {
      const dark = scored.filter(s => ["dark-intense", "drama-prestige"].includes(s.bucket));
      const light = scored.filter(s => ["light-fun", "action-adventure", "scifi-fantasy"].includes(s.bucket));

      const darkPool = pickBest(dark.length >= 3 ? dark : scored, s => s.tone + (s.movie.rating ?? 0) * 0.3);
      const lightPool = pickBest(light.length >= 3 ? light : scored, s => (10 - s.tone) + (s.movie.rating ?? 0) * 0.3);

      movieA = darkPool[0];
      movieB = lightPool.find(m => m.tmdbId !== movieA?.tmdbId) ?? lightPool[1];
      break;
    }

    // ── Round 2: tone axis ──────────────────────────────────────────────────
    case 2: {
      const byTone = [...scored].sort((a, b) => b.tone - a.tone);
      const topThird = Math.max(3, Math.ceil(byTone.length * 0.25));
      const botThird = Math.max(3, Math.ceil(byTone.length * 0.25));

      const darkPool = shuffle(byTone.slice(0, topThird)).map(s => s.movie);
      const lightPool = shuffle(byTone.slice(-botThird)).map(s => s.movie);

      movieA = darkPool[0];
      movieB = lightPool.find(m => m.tmdbId !== movieA?.tmdbId) ?? lightPool[1];
      break;
    }

    // ── Round 3: era axis ───────────────────────────────────────────────────
    case 3: {
      // Soft-filter to movies in the user's emerging tone zone (±3)
      const toneZone = scored.filter(s => Math.abs(s.tone - profile.avgTone) <= 3);
      const zonePool = toneZone.length >= 6 ? toneZone : scored;

      const classic = zonePool.filter(s => s.movie.year! < 2000);
      const modern  = zonePool.filter(s => s.movie.year! >= 2015);

      if (classic.length > 0 && modern.length > 0) {
        movieA = shuffle(classic.map(s => s.movie))[0];
        movieB = shuffle(modern.map(s => s.movie)).find(m => m.tmdbId !== movieA?.tmdbId) ?? modern[1]?.movie;
      } else {
        const byEra = [...zonePool].sort((a, b) => a.era - b.era);
        movieA = byEra[0]?.movie;
        movieB = byEra[byEra.length - 1]?.movie;
      }
      break;
    }

    // ── Round 4: pacing axis ────────────────────────────────────────────────
    case 4: {
      const zonePool = scored.filter(s =>
        Math.abs(s.tone - profile.avgTone) <= 3 ||
        Math.abs(s.era - profile.avgEra) <= 1.5
      );
      const usePool = zonePool.length >= 6 ? zonePool : scored;

      const fast = pickBest(usePool, s => s.pacing);
      const slow = pickBest(usePool, s => 10 - s.pacing);

      movieA = fast[0];
      movieB = slow.find(m => m.tmdbId !== movieA?.tmdbId) ?? slow[1];
      break;
    }

    // ── Round 5: prestige axis ──────────────────────────────────────────────
    case 5: {
      const zonePool = scored.filter(s => Math.abs(s.tone - profile.avgTone) <= 3);
      const usePool = zonePool.length >= 6 ? zonePool : scored;

      const highPrestige = pickBest(usePool, s => s.prestige);
      const mainstream   = pickBest(usePool, s => 10 - s.prestige);

      movieA = highPrestige[0];
      movieB = mainstream.find(m => m.tmdbId !== movieA?.tmdbId) ?? mainstream[1];
      break;
    }

    // ── Rounds 6–7: refinement in confirmed zone ────────────────────────────
    default: {
      // Score each candidate by how closely it matches the confirmed profile
      const fitness = (s: ScoredMovie) =>
        10
        - Math.abs(s.tone     - profile.avgTone)     * 0.35
        - Math.abs(s.pacing   - profile.avgPacing)   * 0.25
        - Math.abs(s.era      - profile.avgEra)      * 0.20
        - Math.abs(s.prestige - profile.avgPrestige) * 0.20;

      const topMatches = pickBest(scored, fitness, 20);
      const shuffled = shuffle(topMatches);
      movieA = shuffled[0];
      movieB = shuffled.find(m => m.tmdbId !== movieA?.tmdbId) ?? shuffled[1];
      break;
    }
  }

  // Safety: fallback if algorithm returned identical or null movies
  if (!movieA || !movieB || movieA.id === movieB.id) {
    const fallback = shuffle(pool);
    if (fallback.length < 2) return null;
    recordShown([fallback[0].tmdbId, fallback[1].tmdbId]);
    return [fallback[0], fallback[1]];
  }

  // Record so these movies are excluded from the next few sessions
  recordShown([movieA.tmdbId, movieB.tmdbId]);

  return [movieA, movieB];
}
