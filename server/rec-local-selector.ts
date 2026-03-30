import type { Movie, Recommendation, RecommendationTrack } from "@shared/schema";
import {
  flavourCluster,
  decadeCluster,
  toneCluster,
  isLikelyTopListObvious,
} from "./rec-cluster-diversity";

const RATING_FLOOR = 5.85;
const MAX_FLAVOUR_IN_ROW = 2;
const MAX_DECADE_IN_ROW = 2;
const MAX_TONE_IN_ROW = 2;
const MAX_SAME_LANG_BUCKET = 4;

const W_LLM_ORDER = 14;
const W_SESSION_FIT = 92;
const PEN_RECENT_TITLE = 420;
const PEN_RECENT_FP = 130;
const PEN_RECENT_DIR = 160;
const PEN_CANON_TITLE = 220;
const PEN_PRESTIGE_KW = 35;
const PEN_ROW_FLAVOUR = 100;
const PEN_ROW_DECADE = 58;
const PEN_ROW_TONE = 78;
const PEN_ROW_LANG_MINOR = 22;

export interface LocalSelectorContext {
  track: RecommendationTrack;
  chosenMovies: Movie[];
  /** Cheap mood / taste text for token overlap */
  moodBlob: string;
  recentTitleKeys: Set<string>;
  recentFingerprints: Set<string>;
  recentDirectorKeys: Set<string>;
  canonNormalizedTitles: Set<string>;
  target: number;
}

export interface LocalSelectStats {
  candidates_in: number;
  after_dedupe: number;
  after_quality_floor: number;
  final: number;
  select_ms: number;
}

function normTitle(t: string): string {
  return t.toLowerCase().trim().replace(/^the\s+/i, "");
}

function directorNorm(movie: Movie): string {
  const d = (movie.director || "").toLowerCase().trim();
  return d || `__dir_${movie.tmdbId}`;
}

/** Stable fingerprint for novelty vs recent rows (genres + keywords + flavour + decade). */
export function metadataFingerprint(movie: Movie): string {
  const fv = flavourCluster(movie);
  const dec = decadeCluster(movie.year);
  const g = movie.genres
    .map((x) => x.toLowerCase().replace(/\s+/g, "_"))
    .slice(0, 5)
    .sort()
    .join("|");
  const k = (movie.keywords || [])
    .map((x) => x.toLowerCase().replace(/\s+/g, "_"))
    .slice(0, 8)
    .sort()
    .join("|");
  return `${fv}|${dec}|${g}|${k.slice(0, 140)}`;
}

function langBucket(movie: Movie): string {
  const lang = (movie.original_language || "en").toLowerCase();
  return lang && lang !== "en" ? "non_en" : "en";
}

function tokenize(blob: string): Set<string> {
  const out = new Set<string>();
  for (const raw of blob.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4) out.add(raw);
  }
  return out;
}

function sessionFitScore(movie: Movie, chosen: Movie[], moodBlob: string): number {
  let s = 0;
  const chosenGenre = new Map<string, number>();
  for (const m of chosen) {
    for (const g of m.genres) {
      const k = g.toLowerCase();
      chosenGenre.set(k, (chosenGenre.get(k) ?? 0) + 1);
    }
  }
  for (const g of movie.genres) {
    const gl = g.toLowerCase();
    if (chosenGenre.has(gl)) s += 22 + (chosenGenre.get(gl) ?? 0) * 8;
  }

  const moodTok = tokenize(moodBlob);
  if (moodTok.size > 0) {
    const blob = `${movie.genres.join(" ")} ${(movie.keywords || []).join(" ")} ${movie.overview || ""}`.toLowerCase();
    moodTok.forEach((t) => {
      if (blob.includes(t)) s += 6;
    });
  }
  return s;
}

function prestigeKeywordPenalty(movie: Movie): number {
  const o = `${movie.overview || ""} ${(movie.keywords || []).join(" ")}`.toLowerCase();
  if (/oscar|academy award|palme d|cannes winner|golden globe|bafta|best picture/i.test(o)) return PEN_PRESTIGE_KW;
  return 0;
}

function baseQualityScore(movie: Movie, llmIndex: number): number {
  let q = 220 - llmIndex * W_LLM_ORDER;
  const r = movie.rating;
  if (r != null && r >= RATING_FLOOR) {
    q += Math.min(28, (r - RATING_FLOOR) * 4);
  }
  return q;
}

function rowPenalty(movie: Movie, picked: Movie[], track: RecommendationTrack): number {
  let p = 0;
  const f = flavourCluster(movie);
  const d = decadeCluster(movie.year);
  const t = toneCluster(movie);
  const lb = langBucket(movie);

  const fc = picked.filter((m) => flavourCluster(m) === f).length;
  const dc = picked.filter((m) => decadeCluster(m.year) === d).length;
  const tc = picked.filter((m) => toneCluster(m) === t).length;
  const lc = picked.filter((m) => langBucket(m) === lb).length;

  if (fc >= MAX_FLAVOUR_IN_ROW) p += PEN_ROW_FLAVOUR * (fc - MAX_FLAVOUR_IN_ROW + 1);
  if (dc >= MAX_DECADE_IN_ROW) p += PEN_ROW_DECADE * (dc - MAX_DECADE_IN_ROW + 1);
  if (tc >= MAX_TONE_IN_ROW) p += PEN_ROW_TONE * (tc - MAX_TONE_IN_ROW + 1);
  if (lc >= MAX_SAME_LANG_BUCKET) p += PEN_ROW_LANG_MINOR * (lc - MAX_SAME_LANG_BUCKET + 1);

  if (track === "indie") {
    const ob = picked.filter((m) => isLikelyTopListObvious(m)).length;
    if (isLikelyTopListObvious(movie) && ob >= 2) p += 500;
  }

  return p;
}

function noveltyPenalty(movie: Movie, ctx: LocalSelectorContext): number {
  let p = 0;
  const tk = normTitle(movie.title);
  if (ctx.recentTitleKeys.has(tk)) p += PEN_RECENT_TITLE;
  const fp = metadataFingerprint(movie);
  if (ctx.recentFingerprints.has(fp)) p += PEN_RECENT_FP;
  const dk = directorNorm(movie);
  if (ctx.recentDirectorKeys.has(dk)) p += PEN_RECENT_DIR;
  if (ctx.canonNormalizedTitles.has(tk)) p += PEN_CANON_TITLE;
  p += prestigeKeywordPenalty(movie);
  return p;
}

function totalBaseScore(
  rec: Recommendation,
  llmIndex: number,
  ctx: LocalSelectorContext
): number {
  const m = rec.movie;
  return (
    baseQualityScore(m, llmIndex) +
    sessionFitScore(m, ctx.chosenMovies, ctx.moodBlob) * (W_SESSION_FIT / 100) -
    noveltyPenalty(m, ctx)
  );
}

/**
 * One LLM-ordered candidate pool → dedupe → quality floor → greedy max-gain selection
 * using session fit, recent novelty, in-row diversity, light quality.
 */
export function selectLocalFinalRow(
  settledInOrder: (Recommendation | null)[],
  ctx: LocalSelectorContext
): { selected: Recommendation[]; stats: LocalSelectStats } {
  const t0 = Date.now();
  const withIdx: { rec: Recommendation; llmIndex: number }[] = [];
  for (let i = 0; i < settledInOrder.length; i++) {
    const r = settledInOrder[i];
    if (r) withIdx.push({ rec: r, llmIndex: i });
  }

  const seenT = new Set<string>();
  const seenD = new Set<string>();
  const deduped: { rec: Recommendation; llmIndex: number }[] = [];
  for (const x of withIdx) {
    const tk = normTitle(x.rec.movie.title);
    if (seenT.has(tk)) continue;
    const dk = directorNorm(x.rec.movie);
    if (seenD.has(dk)) continue;
    seenT.add(tk);
    seenD.add(dk);
    deduped.push(x);
  }

  const afterDedupe = deduped.length;
  const pool = deduped.filter(({ rec }) => {
    const r = rec.movie.rating;
    return r == null || r >= RATING_FLOOR;
  });
  const afterFloor = pool.length;

  const picked: Recommendation[] = [];
  const used = new Set<number>();

  while (picked.length < ctx.target && used.size < pool.length) {
    let best: { rec: Recommendation; llmIndex: number } | null = null;
    let bestEff = -Infinity;

    for (const item of pool) {
      if (used.has(item.rec.movie.tmdbId)) continue;
      const dkn = directorNorm(item.rec.movie);
      if (picked.some((p) => directorNorm(p.movie) === dkn)) continue;
      const eff =
        totalBaseScore(item.rec, item.llmIndex, ctx) -
        rowPenalty(item.rec.movie, picked.map((p) => p.movie), ctx.track);
      if (eff > bestEff) {
        bestEff = eff;
        best = item;
      }
    }

    if (!best) break;
    used.add(best.rec.movie.tmdbId);
    picked.push(best.rec);
  }

  return {
    selected: picked.slice(0, ctx.target),
    stats: {
      candidates_in: settledInOrder.length,
      after_dedupe: afterDedupe,
      after_quality_floor: afterFloor,
      final: picked.length,
      select_ms: Date.now() - t0,
    },
  };
}
