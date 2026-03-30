import OpenAI from "openai";
import { randomInt } from "node:crypto";
import type {
  Movie,
  Recommendation,
  RecommendationsResponse,
  RecommendationTrack,
} from "@shared/schema";
import { searchMovieByTitle, getMovieTrailers, getMovieDetails, getWatchProviders } from "./tmdb";
import type { AnonymousRecMemoryEntry } from "@shared/anonymous-rec-memory";
import { anonFingerprint } from "./anon-memory-request";
import {
  metadataFingerprint,
  selectLocalFinalRow,
  type LocalSelectorContext,
} from "./rec-local-selector";
import {
  flavourCluster,
  toneCluster,
  prestigeCanonCluster,
  overallFeelKey,
  dominantInLastRow,
} from "./rec-cluster-diversity";
import { getAllMovies } from "./catalogue";
import { storage } from "./storage";
import { sessionStorage as gameSessionStorage } from "./session-storage";
import type { SessionMoodProfile } from "./session-mood-profile";
export type { SessionMoodProfile } from "./session-mood-profile";
import {
  appendServedRow,
  cooldownHardSnapshot,
  recCooldownIdentity,
  type RecCooldownState,
} from "./rec-cooldown";
import { buildLockedSubtypePromptBlock, pickSessionSubtype } from "./session-subtype-picker";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  maxRetries: 1,
});

const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";

const recentlyRecommendedTitles: string[] = [];
const recentlyRecommendedFingerprints: string[] = [];
const recentlyRecommendedDirectors: string[] = [];
const recentlyRecommendedDisplayTitles: string[] = [];
const recentlyRecommendedFlavours: string[] = [];
const recentlyRecommendedTones: string[] = [];
const recentlyRecommendedPrestige: string[] = [];
const recentlyRecommendedFeelKeys: string[] = [];
const MAX_RECENT_TRACKED = 400;
/** Prior picks used for soft cluster repeat penalties (several rows). */
const RECENT_CLUSTER_SOFT_WINDOW = 36;
const TARGET_RESOLVED = 6;
/** Single LLM pass per lane: wide candidate pool; local selector picks final row (no extra LLM). */
const LLM_PICK_COUNT = 24;
/** If ban filter strips too many titles, allow one refill LLM (missing slots only). */
const MIN_POOL_AFTER_BAN_FILTER = 14;
const ANON_PRIMARY_GENRE_OVERUSE = 4;
const MAX_PRE_1970 = 1;
const MIN_PICKS_YEAR_LEQ_2010 = 2;

let recsLoaded = false;

async function ensureRecsLoaded(): Promise<void> {
  if (recsLoaded) return;
  recsLoaded = true;
  try {
    const b = await storage.getRecentRecommendationBundles();
    for (let i = 0; i < b.titles.length; i++) {
      const tk = normalizeTitleKey(b.titles[i] || "");
      if (!tk) continue;
      recentlyRecommendedTitles.push(tk);
      recentlyRecommendedFingerprints.push(b.fingerprints[i] ?? "");
      recentlyRecommendedDirectors.push(b.directors[i] ?? "");
      recentlyRecommendedDisplayTitles.push(
        (b.displayTitles[i] || b.titles[i] || "").trim() || tk
      );
      recentlyRecommendedFlavours.push(b.flavourClusters[i] ?? "");
      recentlyRecommendedTones.push(b.toneClusters[i] ?? "");
      recentlyRecommendedPrestige.push(b.prestigeCanonClusters[i] ?? "");
      recentlyRecommendedFeelKeys.push(b.feelKeys[i] ?? "");
    }
    console.log(
      `[recent-recs] Loaded ${recentlyRecommendedTitles.length} prior picks (+ fingerprints) from DB`
    );
  } catch {
    /* non-fatal */
  }
}

export async function preloadRecentRecommendationsCache(): Promise<void> {
  await ensureRecsLoaded();
}

function recordRecommendedRow(recs: Recommendation[]): void {
  for (const r of recs) {
    const tk = normalizeTitleKey(r.movie.title);
    if (!tk || recentlyRecommendedTitles.includes(tk)) continue;
    const m = r.movie;
    recentlyRecommendedTitles.push(tk);
    recentlyRecommendedFingerprints.push(metadataFingerprint(m));
    recentlyRecommendedDirectors.push(
      (m.director || "").toLowerCase().trim() || `__dir_${m.tmdbId}`
    );
    recentlyRecommendedDisplayTitles.push(m.title.trim() || tk);
    recentlyRecommendedFlavours.push(flavourCluster(m));
    recentlyRecommendedTones.push(toneCluster(m));
    recentlyRecommendedPrestige.push(prestigeCanonCluster(m));
    recentlyRecommendedFeelKeys.push(overallFeelKey(m));
    while (recentlyRecommendedTitles.length > MAX_RECENT_TRACKED) {
      recentlyRecommendedTitles.shift();
      recentlyRecommendedFingerprints.shift();
      recentlyRecommendedDirectors.shift();
      recentlyRecommendedDisplayTitles.shift();
      recentlyRecommendedFlavours.shift();
      recentlyRecommendedTones.shift();
      recentlyRecommendedPrestige.shift();
      recentlyRecommendedFeelKeys.shift();
    }
  }
  storage
    .saveRecentRecommendationBundles({
      titles: [...recentlyRecommendedTitles],
      fingerprints: [...recentlyRecommendedFingerprints],
      directors: [...recentlyRecommendedDirectors],
      displayTitles: [...recentlyRecommendedDisplayTitles],
      flavourClusters: [...recentlyRecommendedFlavours],
      toneClusters: [...recentlyRecommendedTones],
      prestigeCanonClusters: [...recentlyRecommendedPrestige],
      feelKeys: [...recentlyRecommendedFeelKeys],
    })
    .catch((err) => console.error("[recent-recs] Failed to save:", err));
}

export interface TasteObservationResult {
  headline: string;
  patternSummary: string;
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
}

interface AIRecommendationResult {
  title: string;
  year?: number;
  reason: string;
  tag?: string;
}

interface SingleTrackLLMResult {
  picks: AIRecommendationResult[];
  line_what_they_want?: string;
  line_what_they_avoid?: string;
  line_cinema_suggested?: string;
  line_trap_avoided?: string;
}

/** Model-collapse / overused titles — never recommend (plus recent + funnel bans). */
const OVERUSED_CANON_BANNED: string[] = [
  "Oldboy",
  "Prisoners",
  "No Country for Old Men",
  "Parasite",
  "Jojo Rabbit",
  "Fight Club",
  "Pulp Fiction",
  "The Shawshank Redemption",
  "The Dark Knight",
  "Inception",
  "Interstellar",
  "Forrest Gump",
  "The Godfather",
  "The Godfather Part II",
  "Schindler's List",
  "The Matrix",
  "Goodfellas",
  "Se7en",
  "Silence of the Lambs",
  "Whiplash",
  "Nightcrawler",
  "Drive",
  "Blade Runner 2049",
  "Arrival",
  "Dune",
  "Everything Everywhere All at Once",
  "Get Out",
  "Hereditary",
  "Midsommar",
  "The Witch",
  "Uncut Gems",
  "There Will Be Blood",
  "Zodiac",
  "Gone Girl",
  "The Social Network",
  "La La Land",
  "Moonlight",
  "Spotlight",
  "Birdman",
  "12 Years a Slave",
  "The Revenant",
  "Mad Max: Fury Road",
  "Django Unchained",
  "Inglourious Basterds",
  "The Prestige",
  "Memento",
  "Shutter Island",
  "The Departed",
];

interface PrefetchPhase1 {
  mood: SessionMoodProfile;
  taste: TasteObservationResult;
  banned: { bannedSet: Set<string>; bannedTitlesPrompt: string };
  variationBlock: string;
  chosen: Movie[];
  rejected: Movie[];
  filters: string[];
}

const prefetchPhase1BySession = new Map<string, Promise<PrefetchPhase1>>();
const laneLlmBySessionIdentity = new Map<
  string,
  { mainstream: Promise<SingleTrackLLMResult>; indie: Promise<SingleTrackLLMResult> }
>();
/** Subtype lock used for this session+identity LLM batch; persisted onto cooldown row. */
const sessionCreativeByLaneKey = new Map<
  string,
  { injectedSubtype: string; subtypePromptBlock: string }
>();

/** Serialize cooldown read-modify-write per identity when both lanes finalize close together. */
const recCooldownPersistChain = new Map<string, Promise<void>>();

function lanePrefetchKey(sessionId: string, anonFp: string): string {
  return `${sessionId}\t${recCooldownIdentity(sessionId, anonFp)}`;
}

function clearLanePrefetchForSession(sessionId: string): void {
  const prefix = `${sessionId}\t`;
  Array.from(laneLlmBySessionIdentity.keys()).forEach((k) => {
    if (k.startsWith(prefix)) laneLlmBySessionIdentity.delete(k);
  });
  Array.from(sessionCreativeByLaneKey.keys()).forEach((k) => {
    if (k.startsWith(prefix)) sessionCreativeByLaneKey.delete(k);
  });
}

async function buildPrefetchPhase1(
  sessionId: string,
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  filters: string[]
): Promise<PrefetchPhase1> {
  const mood = await extractSessionMood(chosenMovies, rejectedMovies, filters);
  const taste = moodToTasteObservation(mood, chosenMovies);
  const banned = buildBannedContext(chosenMovies, rejectedMovies);
  const { block: variationBlock } = getOrCreateSessionVariation(sessionId);
  return { mood, taste, banned, variationBlock, chosen: chosenMovies, rejected: rejectedMovies, filters };
}

async function startLaneLlmPrefetchIfNeeded(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[],
  phase1: PrefetchPhase1,
  cdState: RecCooldownState
): Promise<void> {
  const anonFp = anonFingerprint(clientAnonMemory);
  const key = lanePrefetchKey(sessionId, anonFp);
  if (laneLlmBySessionIdentity.has(key)) return;

  const snap = cooldownHardSnapshot(cdState);
  const merged = mergeHardCooldownIntoMerged(
    mergeAnonymousIntoBanned(phase1.banned, clientAnonMemory),
    cdState
  );
  const injectedSubtype = pickSessionSubtype(phase1.mood, snap.bannedInjectionSubtypes, sessionId);
  const subtypePromptBlock = buildLockedSubtypePromptBlock(injectedSubtype, snap);
  sessionCreativeByLaneKey.set(key, { injectedSubtype, subtypePromptBlock });

  laneLlmBySessionIdentity.set(key, {
    mainstream: generateSingleTrackPicks(
      phase1.chosen,
      phase1.rejected,
      phase1.filters,
      "mainstream",
      phase1.mood,
      merged,
      "",
      sessionId,
      phase1.variationBlock,
      subtypePromptBlock
    ),
    indie: generateSingleTrackPicks(
      phase1.chosen,
      phase1.rejected,
      phase1.filters,
      "indie",
      phase1.mood,
      merged,
      "",
      sessionId,
      phase1.variationBlock,
      subtypePromptBlock
    ),
  });
}

async function persistCooldownAfterServe(
  identity: string,
  laneKey: string,
  recs: Recommendation[]
): Promise<void> {
  const tail = recCooldownPersistChain.get(identity) ?? Promise.resolve();
  const job = tail.then(async () => {
    const creative = sessionCreativeByLaneKey.get(laneKey);
    const injectedSubtype = creative?.injectedSubtype ?? "session mix";
    const st = await storage.getRecCooldownState(identity);
    const titleKeys = recs.map((r) => normalizeTitleKey(r.movie.title)).filter(Boolean);
    const directorKeys = recs.map((r) => directorKeyForMovie(r.movie));
    const next = appendServedRow(st, { titleKeys, directorKeys, injectedSubtype });
    await storage.saveRecCooldownState(identity, next);
  });
  recCooldownPersistChain.set(identity, job);
  await job;
}

/** Per voting session: stable seed + prompt block so rows vary across sessions without random junk. */
const sessionVariationCache = new Map<string, { seed: number; block: string }>();

const EXPLORATION_CHIPS = [
  "non-English or non-US production voices",
  "a 1970s–1990s curiosity",
  "cold procedural or investigative framing",
  "emotional slow-burn with minimal spectacle",
  "heightened genre intensity (sci-fi, horror, or survival pressure)",
  "moral ambiguity or ethical trap",
  "surreal, uncanny, or anti-literal storytelling",
  "under-seen festival, cult, or singular-director energy",
  "rural or isolated setting as pressure-cooker",
  "political or social parable without speechifying",
];

function formatVariationBlock(seed: number): string {
  const n = EXPLORATION_CHIPS.length;
  const i0 = seed % n;
  const i1 = Math.floor(seed / 7) % n;
  const i2 = Math.floor(seed / 53) % n;
  const chosen: string[] = [];
  for (const i of [i0, i1, i2]) {
    const s = EXPLORATION_CHIPS[i];
    if (!chosen.includes(s)) chosen.push(s);
    if (chosen.length >= 2) break;
  }
  if (chosen.length < 2) chosen.push(EXPLORATION_CHIPS[(i0 + 3) % n]);
  return (
    `Session variation (obey taste_profile — same mood, different angles): lean into ${chosen[0]}; ` +
    `also surface ${chosen[1]}. ` +
    `Each pick should express a different subgenre texture (e.g. crime vs psychological vs sci-fi intensity vs survival vs moral drama vs horror unease) — never six of the same cluster.`
  );
}

function getOrCreateSessionVariation(sessionId: string): { seed: number; block: string } {
  let row = sessionVariationCache.get(sessionId);
  if (row) return row;
  const seed = randomInt(1, 1_000_000_000);
  row = { seed, block: formatVariationBlock(seed) };
  sessionVariationCache.set(sessionId, row);
  console.log(`[recs-variation] session=${sessionId.slice(0, 8)}… seed=${seed}`);
  return row;
}

function getOtherLaneTmdbIds(sessionId: string, anonFp: string, track: RecommendationTrack): Set<number> {
  const other: RecommendationTrack = track === "mainstream" ? "indie" : "mainstream";
  const bundle = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp));
  const list = bundle?.[other]?.recommendations ?? [];
  return new Set(list.map((r) => r.movie.tmdbId));
}

/** When the other lane is already resolved, nudge LLM regen/supplement away from overlap. */
function buildCrossLaneHint(sessionId: string, anonFp: string, track: RecommendationTrack): string {
  const bundle = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp));
  if (track === "indie") {
    const m = bundle?.mainstream?.recommendations ?? [];
    if (!m.length) return "";
    return `Mainstream row for this session already: ${m.map((r) => `"${r.movie.title}"`).join("; ")}. Left-field picks must be different films — not overlapping titles or obvious "safer" parallels.`;
  }
  const i = bundle?.indie?.recommendations ?? [];
  if (!i.length) return "";
  return `Left-field row for this session already: ${i.map((r) => `"${r.movie.title}"`).join("; ")}. Mainstream picks must not repeat those titles.`;
}

/** Taste/mood for a session (shared across anon-memory fingerprints). */
interface SessionTasteEntry {
  taste?: TasteObservationResult;
  mood?: SessionMoodProfile;
}

const sessionTasteMeta = new Map<string, SessionTasteEntry>();
type LaneBundle = Partial<Record<RecommendationTrack, RecommendationsResponse>>;
const sessionLaneBundleCache = new Map<string, LaneBundle>();

function laneBundleKey(sessionId: string, anonFp: string): string {
  return `${sessionId}::${anonFp}`;
}

const laneInflight = new Map<string, Promise<RecommendationsResponse>>();

function laneInflightKey(sessionId: string, track: RecommendationTrack, anonFp: string): string {
  return `${sessionId}:${track}:${anonFp}`;
}

function logRecsTiming(sessionId: string, phase: string, ms: number): void {
  const id = sessionId.length > 16 ? `${sessionId.slice(0, 8)}…` : sessionId;
  console.log(`[recs-timing] ${id} ${phase}=${ms}ms`);
}

function patchSessionTasteMeta(
  sessionId: string,
  partial: Partial<{ taste: TasteObservationResult; mood: SessionMoodProfile }>
): void {
  const cur = sessionTasteMeta.get(sessionId) ?? {};
  sessionTasteMeta.set(sessionId, { ...cur, ...partial });
}

function mergeLaneBundleIntoCache(
  sessionId: string,
  anonFp: string,
  track: RecommendationTrack,
  res: RecommendationsResponse
): void {
  const k = laneBundleKey(sessionId, anonFp);
  const cur = sessionLaneBundleCache.get(k) ?? {};
  cur[track] = res;
  sessionLaneBundleCache.set(k, cur);
}

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/^the\s+/i, "");
}

function humanizeClusterLabel(s: string): string {
  return s.replace(/\|/g, " · ").replace(/_/g, " ");
}

/** Mandatory LLM instruction: same mood twice must still change row “shape” vs last serve. */
function buildRecentRowFreshnessPrompt(): string {
  if (recentlyRecommendedTitles.length < TARGET_RESOLVED) return "";
  const start = recentlyRecommendedTitles.length - TARGET_RESOLVED;
  const titles = recentlyRecommendedDisplayTitles.slice(start);
  const flavs = recentlyRecommendedFlavours.slice(start).filter(Boolean);

  const domFl = dominantInLastRow(recentlyRecommendedFlavours, TARGET_RESOLVED, 3);
  const domTn = dominantInLastRow(recentlyRecommendedTones, TARGET_RESOLVED, 3);
  const domPr = dominantInLastRow(recentlyRecommendedPrestige, TARGET_RESOLVED, 3);
  const domFe = dominantInLastRow(recentlyRecommendedFeelKeys, TARGET_RESOLVED, 3);

  const list = titles.filter(Boolean).join("; ");
  const flavSummary =
    flavs.length > 0
      ? `Subgenre / texture buckets in that row: ${Array.from(new Set(flavs)).map(humanizeClusterLabel).join(", ")}.`
      : "";

  const domLines = [
    domFl &&
      `Dominant subgenre texture in that row (do not make this the spine again): ${humanizeClusterLabel(domFl)}.`,
    domTn &&
      `Dominant tonal delivery in that row (rotate how intensity lands): ${humanizeClusterLabel(domTn)}.`,
    domPr &&
      `Dominant prestige/canon tier in that row (shift obviousness / acclaim profile): ${humanizeClusterLabel(domPr)}.`,
    domFe && `Dominant overall-feel bucket in that row (tone × decade): ${humanizeClusterLabel(domFe)}.`,
  ].filter(Boolean) as string[];

  return (
    `## FRESH vs LAST SERVED ROW — same priority as taste_profile\n\n` +
    `The user may request another row with the same mood. You must still match taste_profile, but this pool must **not** replay the last row’s fingerprint: same broad mood is required (e.g. still intense thrillers), yet the **subtype, how tension is delivered, prestige tier, and era/feel** must read clearly different — not merely non-duplicate titles.\n\n` +
    `Last row included: ${list || "(see banned_titles for overlaps)"}.\n` +
    (flavSummary ? `${flavSummary}\n` : "") +
    (domLines.length > 0 ? `${domLines.join("\n")}\n` : "") +
    `\nExplicit rule: prefer directors and subgenre textures **absent or rare** in that row. Re-serving the same dominant clusters is a failure even with new titles.`
  );
}

function parseYearField(y: unknown): number | undefined {
  if (typeof y === "number" && Number.isFinite(y)) return Math.round(y);
  if (typeof y === "string") {
    const n = parseInt(y, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function directorKeyForMovie(movie: { tmdbId: number; director?: string | null }): string {
  const d = (movie.director || "").toLowerCase().trim();
  return d || `__anon_director_${movie.tmdbId}`;
}

function formatChoicesBlock(chosenMovies: Movie[]): string {
  return chosenMovies.map((m, i) => {
    const round = i + 1;
    const star = round >= 5 ? "*" : "";
    const kw = (m.keywords || []).slice(0, 5).join(", ") || "—";
    return `R${round}${star}: "${m.title}" (${m.year}) — ${m.genres[0] || "Unknown"}, dir. ${m.director || "Unknown"}, kw: ${kw}`;
  }).join("\n");
}

function formatRejectsBlock(rejectedMovies: Movie[], chosenMovies: Movie[]): string {
  if (rejectedMovies.length === 0) return "(none)";
  return rejectedMovies.map((m, i) => {
    const chosen = chosenMovies[i];
    return `R${i + 1}: passed on "${m.title}" (${m.year}) — picked "${chosen?.title ?? "—"}"`;
  }).join("\n");
}

function fallbackTaste(chosenMovies: Movie[]): TasteObservationResult {
  const g = extractTopGenres(chosenMovies);
  return {
    headline: "You’re narrowing in on what feels right tonight.",
    patternSummary:
      "Your picks sketch a clear direction across the rounds. So these recommendations try to honour that same instinct without repeating what you already saw.",
    topGenres: g,
    themes: [],
    preferredEras: [],
  };
}

function fallbackMood(): SessionMoodProfile {
  return {
    preferred_tone: "Something engaging that fits the night",
    rejected_tone: "What felt off in the passes",
    pacing: "moderate",
    darkness_level: "balanced",
    realism_vs_stylised: "mixed",
    complexity: "medium",
    emotional_texture: "grounded",
    what_they_want: ["a satisfying watch", "clear story stakes", "tone that matches tonight"],
    what_they_avoid: ["misaligned mood", "pacing that drags", "tone clashes"],
  };
}

function moodToTasteObservation(mood: SessionMoodProfile, chosenMovies: Movie[]): TasteObservationResult {
  const want = (mood.what_they_want || []).filter(Boolean).slice(0, 3).join("; ");
  const avoid = (mood.what_they_avoid || []).filter(Boolean).slice(0, 3).join("; ");
  return {
    headline: (mood.preferred_tone || "").trim() || fallbackTaste(chosenMovies).headline,
    patternSummary: [want && `Leaning toward: ${want}.`, avoid && `Steering clear of: ${avoid}.`]
      .filter(Boolean)
      .join(" ")
      .trim() || fallbackTaste(chosenMovies).patternSummary,
    topGenres: extractTopGenres(chosenMovies),
    themes: [mood.emotional_texture, mood.pacing, mood.complexity].filter(Boolean),
    preferredEras: [],
  };
}

/** Funnel + rejected + canon overuse + recent sessions — prompts and post-filter. */
function buildBannedContext(chosenMovies: Movie[], rejectedMovies: Movie[]): {
  bannedSet: Set<string>;
  bannedTitlesPrompt: string;
} {
  const bannedSet = new Set<string>();
  const labels: string[] = [];

  const addTitle = (raw: string) => {
    const k = normalizeTitleKey(raw);
    if (!k) return;
    if (bannedSet.has(k)) return;
    bannedSet.add(k);
    labels.push(raw.trim());
  };

  for (const m of chosenMovies) addTitle(m.title);
  for (const m of rejectedMovies) addTitle(m.title);
  for (const t of OVERUSED_CANON_BANNED) addTitle(t);

  const bannedTitlesPrompt = labels.slice(0, 100).join("; ");
  return { bannedSet, bannedTitlesPrompt };
}

interface MergedBannedContext {
  bannedSet: Set<string>;
  bannedTitlesPrompt: string;
  anonDirectorKeys: Set<string>;
  anonPrimaryGenreCounts: Map<string, number>;
  /** Hard rolling cooldown — resolve must reject these directors. */
  hardCooldownDirectorKeys: Set<string>;
}

function mergeHardCooldownIntoMerged(
  base: MergedBannedContext,
  cdState: RecCooldownState
): MergedBannedContext {
  const snap = cooldownHardSnapshot(cdState);
  const bannedSet = new Set(base.bannedSet);
  const hardCooldownDirectorKeys = new Set(base.hardCooldownDirectorKeys);
  snap.titleBan.forEach((t) => bannedSet.add(t));
  snap.directorBan.forEach((d) => {
    if (d) hardCooldownDirectorKeys.add(d);
  });
  const directorList = Array.from(snap.directorBan).filter(Boolean).slice(0, 24);
  const titleList = Array.from(snap.titleBan).slice(0, 40);
  const extraLines = [
    titleList.length > 0 &&
      `HARD COOLDOWN — do not output these titles (or close variants): ${titleList.join("; ")}.`,
    directorList.length > 0 &&
      `HARD COOLDOWN — do not output any film directed by: ${directorList.join("; ")}.`,
  ].filter(Boolean) as string[];
  const bannedTitlesPrompt = [base.bannedTitlesPrompt, ...extraLines].filter(Boolean).join(" ");

  return {
    bannedSet,
    bannedTitlesPrompt,
    anonDirectorKeys: new Set(base.anonDirectorKeys),
    anonPrimaryGenreCounts: new Map(base.anonPrimaryGenreCounts),
    hardCooldownDirectorKeys,
  };
}

function mergeAnonymousIntoBanned(
  base: { bannedSet: Set<string>; bannedTitlesPrompt: string },
  entries: AnonymousRecMemoryEntry[]
): MergedBannedContext {
  const bannedSet = new Set(base.bannedSet);
  const extraTitles: string[] = [];
  const anonDirectorKeys = new Set<string>();
  const anonPrimaryGenreCounts = new Map<string, number>();

  for (const e of entries) {
    const tk = normalizeTitleKey(e.title);
    if (tk && !bannedSet.has(tk)) {
      bannedSet.add(tk);
      extraTitles.push(e.title.trim());
    }
    const d = (e.director || "").toLowerCase().trim();
    if (d) anonDirectorKeys.add(d);
    const g0 = e.genres?.[0]?.trim().toLowerCase();
    if (g0) anonPrimaryGenreCounts.set(g0, (anonPrimaryGenreCounts.get(g0) ?? 0) + 1);
  }

  const memoryLines = [
    extraTitles.length > 0 &&
      `Browser memory — do NOT repeat these titles (or close variants): ${extraTitles.slice(0, 40).join("; ")}.`,
    anonDirectorKeys.size > 0 &&
      `Browser memory — avoid leaning on these directors again tonight (prefer fresh voices): ${Array.from(anonDirectorKeys).slice(0, 25).join("; ")}.`,
  ].filter(Boolean) as string[];

  const bannedTitlesPrompt = [base.bannedTitlesPrompt, ...memoryLines].filter(Boolean).join(" ");

  return {
    bannedSet,
    bannedTitlesPrompt,
    anonDirectorKeys,
    anonPrimaryGenreCounts,
    hardCooldownDirectorKeys: new Set<string>(),
  };
}

function cloneMergedBanned(m: MergedBannedContext): MergedBannedContext {
  return {
    bannedSet: new Set(m.bannedSet),
    bannedTitlesPrompt: m.bannedTitlesPrompt,
    anonDirectorKeys: new Set(m.anonDirectorKeys),
    anonPrimaryGenreCounts: new Map(m.anonPrimaryGenreCounts),
    hardCooldownDirectorKeys: new Set(m.hardCooldownDirectorKeys),
  };
}

function movieFailsAnonDiversity(movie: Movie, mb: MergedBannedContext): boolean {
  const d = (movie.director || "").toLowerCase().trim();
  if (d && mb.anonDirectorKeys.has(d)) return true;
  const p = (movie.genres[0] || "").trim().toLowerCase();
  if (p && (mb.anonPrimaryGenreCounts.get(p) ?? 0) >= ANON_PRIMARY_GENRE_OVERUSE) return true;
  return false;
}

function movieFailsMergedDiversity(movie: Movie, mb: MergedBannedContext): boolean {
  if (movieFailsAnonDiversity(movie, mb)) return true;
  const d = (movie.director || "").toLowerCase().trim();
  if (d && mb.hardCooldownDirectorKeys.has(d)) return true;
  return false;
}

function filterPicksAgainstBanned(
  picks: AIRecommendationResult[],
  bannedSet: Set<string>
): AIRecommendationResult[] {
  return picks.filter((p) => p.title && !bannedSet.has(normalizeTitleKey(p.title)));
}

// ── 1) Taste extraction (run first; winners vs losers; no film titles in output) ─

export async function extractSessionMood(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[] = []
): Promise<SessionMoodProfile> {
  const winners = formatChoicesBlock(chosenMovies);
  const losers = formatRejectsBlock(rejectedMovies, chosenMovies);
  const genreLine = initialGenreFilters.length > 0
    ? `Optional session genre hints: ${initialGenreFilters.join(", ")}.`
    : "";

  const prompt = `You are analysing a movie A/B voting session.

Input:
- winners:
${winners}

- losers:
${losers}
${genreLine}

Infer the user's CURRENT viewing mood for TONIGHT (not general lifelong taste).

Return JSON only:
{
  "preferred_tone": "",
  "rejected_tone": "",
  "pacing": "",
  "darkness_level": "",
  "realism_vs_stylised": "",
  "complexity": "",
  "emotional_texture": "",
  "what_they_want": ["", "", ""],
  "what_they_avoid": ["", "", ""]
}

Rules:
- Use winners AGAINST losers (contrast passes, not only wins).
- Be specific (e.g. "controlled tension" not "thriller").
- Do not mention any specific movie title in any field.
- This is tonight's mood only.`;

  try {
    const response = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [
        { role: "system", content: "PickAFlick mood analyst. JSON only. No film titles in output." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 550,
      temperature: 0.75,
    });
    const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as SessionMoodProfile;
    return {
      preferred_tone: String(raw.preferred_tone || "").trim(),
      rejected_tone: String(raw.rejected_tone || "").trim(),
      pacing: String(raw.pacing || "").trim(),
      darkness_level: String(raw.darkness_level || "").trim(),
      realism_vs_stylised: String(raw.realism_vs_stylised || "").trim(),
      complexity: String(raw.complexity || "").trim(),
      emotional_texture: String(raw.emotional_texture || "").trim(),
      what_they_want: Array.isArray(raw.what_they_want) ? raw.what_they_want.map(String) : [],
      what_they_avoid: Array.isArray(raw.what_they_avoid) ? raw.what_they_avoid.map(String) : [],
    };
  } catch (e) {
    console.error("[session-mood]", e);
    return fallbackMood();
  }
}

/** Taste preview + legacy shape: mood extraction mapped for UI. */
export async function buildTasteObservation(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[] = []
): Promise<TasteObservationResult> {
  const mood = await extractSessionMood(chosenMovies, rejectedMovies, initialGenreFilters);
  return moodToTasteObservation(mood, chosenMovies);
}

const MOOD_EXPRESSIONS_GUIDE = `MOOD EXPRESSIONS — same mood, different channels (you must span many, not ${LLM_PICK_COUNT} near-copies of one):

Example when the mood is intense / thriller-adjacent / high stakes — deliberately mix entries across types such as:
- procedural intensity (case-file, investigation momentum)
- psychological intensity (obsession, interior mind games)
- moral pressure / ethical trap (no clean villain)
- survival tension (physical desperation, clock pressure)
- slow-burn dread (unease without spectacle)
- chaotic energy (control unravelling)
- paranoid / conspiracy thriller
- action-driven propulsion (momentum-led, not “prestige crime” by default)
- genre pressure-cookers (sci-fi, horror, war) that carry intensity without defaulting to gritty urban crime

For calmer or different moods (warmth, comedy, romance, wonder, grief, etc.), use the same principle: **multiple legitimate expressions of that mood** — never one mental shelf repeated with small variations.`;

const ANTI_DEFAULT_SHELF_RULES = `ANTI-DEFAULT SHELF (non-negotiable):
- You are NOT listing the “best” films for the mood. You are listing a **broad candidate pool** so another step can choose a diverse final row. Optimise for: (1) mood fit, (2) **breadth of expression**, (3) freshness vs recent rows when that section appears, (4) **discovery / non-obviousness** — not peak canon.
- Avoid the usual fallback cluster unless taste_profile or the voting funnel **overwhelmingly** points there: English-language prestige crime / psychothriller / “intelligent thriller” staples that dominate Reddit, Letterboxd, and lazy listicles. Unless the session explicitly demands that narrow lane, **cap such titles at 2 in this entire ${LLM_PICK_COUNT}-title pool**; every other slot must skew **lesser-surfaced**, **unexpected but fitting**, or **outside the usual recommendation pool**.
- No duplicate directors. Avoid the same **director family** / house-style cluster: multiple picks that share the same industrial playbook (e.g. same mid-budget “awards-bait crime” mould) even with different names — spread countries, eras, budgets, and storytelling modes.
- At least **two thirds** of the pool must be titles a casual film fan would **not** instantly name for this mood — still legitimate, still watchable, still on-profile.`;

const DISCOVERY_ANTI_STAPLE_BLOCK = `DISCOVERY / ANTI–“TOP 20 THRILLERS” (CRITICAL):
- If a title could plausibly headline a **“Top 20 intense thrillers”** or **default intelligent-thriller** list without debate, it is **wrong** for this product unless you have **no** alternative that fits the locked subtype — and even then use **sparingly**.
- **Intelligent-thriller staples** (household-name twist films, prestige crime-psych defaults, Fincher-school reflex picks, critic-canon English crime) are **forbidden as the spine** of the pool. Prioritise **discovery**: regional cinema, pre-2000 deep cuts, non-English voices, festival/indie curios, under-marketed gems that still match the mood and subtype.
- Litmus test: *Would this appear on a generic “best thrillers” blog?* If yes → **replace it**.
- Downstream selection will enforce that **at least 3 of the final 6** feel like **non-default, lesser-widely-known** picks — bias your ${LLM_PICK_COUNT} titles heavily so that is achievable (do not front-load obvious answers).`;

const REC_TRACK_IMPL_NOTES = `Implementation — CANDIDATE POOL (one shot, no follow-up):
- taste_profile is the mood contract. **Breadth + discovery within that mood** beat “safest best” picks — the pool must not look like a critic’s default shelf.
- banned_titles: never output these (or close variants).
- FRESH_VS_RECENT_ROW: when that section appears, it is **co-equal** with taste_profile; rotate expressions vs the last row, not only titles.
- DISCOVERY_ANTI_STAPLE: obey the discovery block — **wrong** = feels like a lazy listicle pick; **right** = feels like a curated find.
- Emit exactly ${LLM_PICK_COUNT} objects in "picks". A downstream selector picks 6; your job is a **wide pool rich in non-obvious titles**, not a ranked shortlist of famous films.
- Each pick MUST include "tag": a short mood-expression label (which channel of the mood this title represents).
- No duplicate directors. Spread decades and languages; do not monoculture one decade or one country.
- session_variation is an exploratory nudge only; never override taste_profile, FRESH_VS_RECENT_ROW, anti-default, or discovery rules.`;

function buildMainstreamTrackPrompt(
  tasteProfileJson: string,
  bannedTitles: string,
  variationBlock: string
): string {
  const v = variationBlock.trim() || "Explore different angles of the mood; refuse a single-texture pool.";
  return `You are generating a WIDE CANDIDATE POOL for PickAFlick (MAINSTREAM lane), this session only.

This is NOT the final recommendation row. Another system will pick 6 films from your list. Your output must be **${LLM_PICK_COUNT} distinct, eligible titles** that **cover many different expressions of the same mood** — otherwise downstream selection has nothing to work with.

Inputs:
- taste_profile (JSON — mood contract):
${tasteProfileJson}

- banned_titles (never output these or obvious variants):
${bannedTitles}

- session_variation (optional nudge — still obey taste_profile):
${v}

MAINSTREAM here means: broadly watchable, satisfying tonight, accessible — but **not** “safest prestige answers.” Breadth and surprise within the mood are required.

${MOOD_EXPRESSIONS_GUIDE}

${ANTI_DEFAULT_SHELF_RULES}

${DISCOVERY_ANTI_STAPLE_BLOCK}

When FRESH vs LAST SERVED ROW appears below in the user message: same mood again is fine; **different expressions and shelf** than that row — co-equal with taste_profile.

Operational:
- Favour titles realistically streamable/rentable in Australia when plausible.
- Decades: at least ${MIN_PICKS_YEAR_LEQ_2010} picks with year ≤ 2010; at most ${MAX_PRE_1970} with year < 1970.
- No more than **3** picks in the same mood_expression "tag" family in the whole pool (force spread).

${REC_TRACK_IMPL_NOTES}

Output JSON only:
{
  "line_what_they_want": "one short sentence: mood they want tonight",
  "line_what_they_avoid": "one short sentence: what they are avoiding",
  "picks": [{"title":"","year":2020,"tag":"mood expression label (required)","reason":"one line: how this title fits taste_profile via this expression"}]
}`;
}

function buildIndieTrackPrompt(
  tasteProfileJson: string,
  bannedTitles: string,
  variationBlock: string
): string {
  const v = variationBlock.trim() || "Brave angles; under-seen voices; refuse the prestige-crime default shelf.";
  return `You are generating a WIDE CANDIDATE POOL for PickAFlick (LEFT-FIELD / INDIE lane), this session only.

NOT the final six. Another step selects 6 from your pool. You must output **${LLM_PICK_COUNT}** titles that **span many expressions of the mood** — if the pool collapses to one shelf, the product fails.

Inputs:
- taste_profile (JSON — mood contract):
${tasteProfileJson}

- banned_titles:
${bannedTitles}

- session_variation:
${v}

LEFT-FIELD means: categorically **not** a slightly-less-obvious mainstream list. Festival, auteur, cult, arthouse, singular — English or non-English. Still must match taste_profile.

${MOOD_EXPRESSIONS_GUIDE}

${ANTI_DEFAULT_SHELF_RULES}

${DISCOVERY_ANTI_STAPLE_BLOCK}

Stricter for this lane: at most **1** title in the whole pool may be “generic greatest-films / top-100 list” obvious; the rest must feel discoverable. Strongly prefer non-household directors, non-US or non-English-primary voices, and titles that are **not** the default Letterboxd-canon reflex for this mood.

When FRESH vs LAST SERVED ROW appears: same mood, **rotated expressions and shelf** — co-equal with taste_profile.

Operational:
- Decades: at least ${MIN_PICKS_YEAR_LEQ_2010} picks with year ≤ 2010; at most ${MAX_PRE_1970} with year < 1970.
- No more than **3** picks sharing the same "tag" expression family in the pool.

${REC_TRACK_IMPL_NOTES}

Output JSON only:
{
  "line_cinema_suggested": "one short sentence: what kind of cinema this session suggests",
  "line_trap_avoided": "one short sentence: default shelf you refused for this pool",
  "picks": [{"title":"","year":2020,"tag":"mood expression (required)","reason":"short, tied to taste_profile + this expression"}]
}`;
}

function parseMainstreamTrackResponse(raw: Record<string, unknown>): SingleTrackLLMResult {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const picks: AIRecommendationResult[] = picksIn
    .map((p: unknown) => {
      const o = p as Record<string, unknown>;
      const tag = String(o.tag || "").trim();
      return {
        title: String(o.title || "").trim(),
        year: parseYearField(o.year),
        reason: String(o.reason || "").trim(),
        ...(tag ? { tag } : {}),
      };
    })
    .filter((p) => p.title);
  return {
    line_what_they_want: String(raw.line_what_they_want || "").trim(),
    line_what_they_avoid: String(raw.line_what_they_avoid || "").trim(),
    picks,
  };
}

function parseIndieTrackResponse(raw: Record<string, unknown>): SingleTrackLLMResult {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const picks: AIRecommendationResult[] = picksIn
    .map((p: unknown) => {
      const o = p as Record<string, unknown>;
      return {
        title: String(o.title || "").trim(),
        year: parseYearField(o.year),
        reason: String(o.reason || "").trim(),
        tag: String(o.tag || "").trim() || undefined,
      };
    })
    .filter((p) => p.title);
  return {
    line_cinema_suggested: String(raw.line_cinema_suggested || "").trim(),
    line_trap_avoided: String(raw.line_trap_avoided || "").trim(),
    picks,
  };
}

function systemPromptForTrack(track: RecommendationTrack): string {
  if (track === "mainstream") {
    return "PickAFlick MAINSTREAM candidate pool. JSON only. Discovery-first: avoid Top-20-thriller / default intelligent-thriller staples; most picks must feel like finds, not listicles. ≥3 of final 6 will be non-obvious — bias pool accordingly. taste_profile + FRESH + locked subtype co-equal. banned_titles. No director repeats.";
  }
  return "PickAFlick LEFT-FIELD candidate pool. JSON only. Discovery mandatory; max 1 top-100-obvious in pool. Refuse default thriller/crime canon shelf. taste_profile + FRESH + subtype co-equal. banned_titles. No director repeats.";
}

async function callSingleTrackLLM(
  promptText: string,
  track: RecommendationTrack,
  timingSessionId?: string
): Promise<SingleTrackLLMResult> {
  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: systemPromptForTrack(track) },
      { role: "user", content: promptText },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2800,
    temperature: track === "indie" ? 0.95 : 0.88,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, `llm_${track}`, Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  return track === "mainstream" ? parseMainstreamTrackResponse(raw) : parseIndieTrackResponse(raw);
}

/** One-shot top-up when hard-ban filter removed too many LLM titles (max one call per finalize). */
async function refillCandidatePicksLLM(
  count: number,
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  track: RecommendationTrack,
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  creativeSubtypeBlock: string,
  variationBlock: string,
  timingSessionId?: string
): Promise<AIRecommendationResult[]> {
  if (count <= 0) return [];
  const tasteProfileJson = JSON.stringify(mood);
  const user = `Refill only: prior pool lost titles to HARD COOLDOWN / bans. Output JSON with **exactly ${count}** NEW objects in "picks".

taste_profile:
${tasteProfileJson}

Banned / cooldown (obey — do not repeat any of these titles or directors):
${bannedCtx.bannedTitlesPrompt.slice(0, 6000)}

${creativeSubtypeBlock}

session_variation:
${variationBlock}

Same track rules as the main pool: distinct directors, tag+reason, locked subtype channel, real films with plausible AU availability.
DISCOVERY: refill slots must be **lesser-surfaced / non-listicle** titles — not “Top 20 thriller” defaults; prefer curios and unexpected fits.

Output shape matches the main track response (picks array only is required).`;

  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      {
        role: "system",
        content: `${systemPromptForTrack(track)} Refill: exact count; no repeats of banned titles or directors.`,
      },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: track === "indie" ? 0.92 : 0.85,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, `llm_${track}_refill`, Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  const parsed = track === "mainstream" ? parseMainstreamTrackResponse(raw) : parseIndieTrackResponse(raw);
  return filterPicksAgainstBanned(parsed.picks || [], bannedCtx.bannedSet).slice(0, count);
}

export async function generateSingleTrackPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  track: RecommendationTrack,
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  promptExtra = "",
  timingSessionId?: string,
  variationBlock = "",
  creativeSubtypeBlock = ""
): Promise<SingleTrackLLMResult> {
  await ensureRecsLoaded();
  const tasteProfileJson = JSON.stringify(mood);
  const basePrompt =
    track === "mainstream"
      ? buildMainstreamTrackPrompt(tasteProfileJson, bannedCtx.bannedTitlesPrompt, variationBlock)
      : buildIndieTrackPrompt(tasteProfileJson, bannedCtx.bannedTitlesPrompt, variationBlock);
  const creative = creativeSubtypeBlock.trim() ? `\n\n${creativeSubtypeBlock.trim()}` : "";
  const genreLine =
    initialGenreFilters.length > 0
      ? `\n\nOptional genre hints: ${initialGenreFilters.join(", ")}.`
      : "";
  const freshness = buildRecentRowFreshnessPrompt();
  const freshnessBlock = freshness ? `\n\n${freshness}` : "";
  const extra = promptExtra.trim() ? `\n\n${promptExtra.trim()}` : "";
  const prompt = basePrompt + creative + genreLine + freshnessBlock + extra;

  const applyBanned = (r: SingleTrackLLMResult): SingleTrackLLMResult => ({
    ...r,
    picks: filterPicksAgainstBanned(r.picks || [], bannedCtx.bannedSet),
  });

  const result = applyBanned(await callSingleTrackLLM(prompt, track, timingSessionId));
  return result;
}

async function resolveOneRecommendation(
  rec: AIRecommendationResult,
  excludeTmdbIds: Set<number>,
  pickedAs: RecommendationTrack,
  mergedBanned?: MergedBannedContext | null
): Promise<Recommendation | null> {
  try {
    const searchResult = await searchMovieByTitle(rec.title, rec.year);
    if (!searchResult || excludeTmdbIds.has(searchResult.id)) return null;

    const [movieDetails, tmdbTrailers, watchResult] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id).catch(() => [] as string[]),
      getWatchProviders(searchResult.id, rec.title, rec.year ?? null),
    ]);

    if (!movieDetails) return null;
    if (!movieDetails.posterPath?.trim()) return null;
    if (!watchResult.providers.length) return null;

    if (mergedBanned && movieFailsMergedDiversity(movieDetails, mergedBanned)) return null;

    movieDetails.listSource = "ai-recommendation";
    const reason =
      rec.tag && rec.reason
        ? `${rec.reason} · ${rec.tag}`
        : rec.reason || rec.tag || "";
    const urls = Array.isArray(tmdbTrailers) ? tmdbTrailers : [];
    return {
      movie: movieDetails,
      trailerUrl: urls[0] ?? null,
      trailerUrls: urls,
      reason,
      pickedAs,
      auWatchAvailable: true,
    };
  } catch {
    return null;
  }
}

async function resolvePicksToRecommendations(
  picks: AIRecommendationResult[],
  chosenMovies: Movie[],
  track: RecommendationTrack,
  mood: SessionMoodProfile,
  mergedBanned: MergedBannedContext | null,
  opts: {
    otherLaneTmdbIds?: Set<number>;
    logCluster?: { sessionId: string };
  } = {}
): Promise<Recommendation[]> {
  const excludeTmdb = new Set(chosenMovies.map((m) => m.tmdbId));
  if (opts.otherLaneTmdbIds) {
    opts.otherLaneTmdbIds.forEach((id) => excludeTmdb.add(id));
  }

  const tResolve = Date.now();
  const settled = await Promise.all(
    picks
      .slice(0, LLM_PICK_COUNT)
      .map((r) => resolveOneRecommendation(r, excludeTmdb, track, mergedBanned))
  );
  const resolveMs = Date.now() - tResolve;

  const moodBlob = [
    mood.preferred_tone,
    mood.rejected_tone,
    mood.pacing,
    mood.darkness_level,
    mood.realism_vs_stylised,
    mood.complexity,
    mood.emotional_texture,
    ...(mood.what_they_want || []),
    ...(mood.what_they_avoid || []),
  ].join(" ");

  const canonNormalizedTitles = new Set(OVERUSED_CANON_BANNED.map((t) => normalizeTitleKey(t)));
  const recentTitleKeys = new Set(recentlyRecommendedTitles.slice(-160));
  const recentFingerprints = new Set(
    recentlyRecommendedFingerprints.filter(Boolean).slice(-120)
  );
  const recentDirectorKeys = new Set(recentlyRecommendedDirectors.filter(Boolean).slice(-120));

  const softFl = recentlyRecommendedFlavours.slice(-RECENT_CLUSTER_SOFT_WINDOW).filter(Boolean);
  const softTn = recentlyRecommendedTones.slice(-RECENT_CLUSTER_SOFT_WINDOW).filter(Boolean);
  const softPr = recentlyRecommendedPrestige.slice(-RECENT_CLUSTER_SOFT_WINDOW).filter(Boolean);
  const softFe = recentlyRecommendedFeelKeys.slice(-RECENT_CLUSTER_SOFT_WINDOW).filter(Boolean);

  const ctx: LocalSelectorContext = {
    track,
    chosenMovies,
    moodBlob,
    recentTitleKeys,
    recentFingerprints,
    recentDirectorKeys,
    recentFlavourKeys: new Set(softFl),
    recentToneKeys: new Set(softTn),
    recentPrestigeKeys: new Set(softPr),
    recentFeelKeys: new Set(softFe),
    lastRowDominantFlavour: dominantInLastRow(recentlyRecommendedFlavours, TARGET_RESOLVED, 3),
    lastRowDominantTone: dominantInLastRow(recentlyRecommendedTones, TARGET_RESOLVED, 3),
    lastRowDominantPrestige: dominantInLastRow(recentlyRecommendedPrestige, TARGET_RESOLVED, 3),
    lastRowDominantFeel: dominantInLastRow(recentlyRecommendedFeelKeys, TARGET_RESOLVED, 3),
    canonNormalizedTitles,
    target: TARGET_RESOLVED,
  };

  const tRank = Date.now();
  const { selected, stats } = selectLocalFinalRow(settled, ctx);
  const rankMs = Date.now() - tRank;

  if (opts.logCluster?.sessionId) {
    const sid = opts.logCluster.sessionId;
    const short = sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;
    console.log(
      `[recs-local] ${short} ${track} tmdb_au_resolve_ms=${resolveMs} local_select_ms=${stats.select_ms} ` +
        `rank_wall_ms=${rankMs} candidates_in=${stats.candidates_in} deduped=${stats.after_dedupe} ` +
        `after_floor=${stats.after_quality_floor} final=${stats.final}`
    );
  }

  return selected;
}

/** Fire when the last A/B choice is recorded — mood extraction only; lane LLMs start when client hits taste-preview/recommendations (with anon-aware cooldown). */
export function beginRecommendationPrefetch(sessionId: string): void {
  const session = gameSessionStorage.getSession(sessionId);
  if (!session?.isComplete) return;
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) return;

  if (!prefetchPhase1BySession.has(sessionId)) {
    console.log(`[prefetch] Starting taste extraction for ${sessionId} (lane LLMs deferred until results)`);
    const tMood = Date.now();
    const p1 = buildPrefetchPhase1(sessionId, chosen, rejected, filters).then((phase1) => {
      logRecsTiming(sessionId, "taste_extraction", Date.now() - tMood);
      return phase1;
    });
    prefetchPhase1BySession.set(sessionId, p1);
  }
}

export async function getTastePreviewForSession(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<TasteObservationResult> {
  const cachedTaste = sessionTasteMeta.get(sessionId)?.taste;
  if (cachedTaste) return cachedTaste;

  let p1 = prefetchPhase1BySession.get(sessionId);
  if (!p1) {
    const session = gameSessionStorage.getSession(sessionId);
    if (!session?.isComplete) return fallbackTaste([]);
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    const rejected = gameSessionStorage.getRejectedMovies(sessionId);
    const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
    if (chosen.length === 0) return fallbackTaste([]);
    p1 = buildPrefetchPhase1(sessionId, chosen, rejected, filters);
    prefetchPhase1BySession.set(sessionId, p1);
  }
  try {
    const phase1 = await p1;
    patchSessionTasteMeta(sessionId, { mood: phase1.mood, taste: phase1.taste });
    const cdId = recCooldownIdentity(sessionId, anonFingerprint(clientAnonMemory));
    const cdState = await storage.getRecCooldownState(cdId);
    await startLaneLlmPrefetchIfNeeded(sessionId, clientAnonMemory, phase1, cdState);
    return phase1.taste;
  } catch {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    return fallbackTaste(chosen);
  }
}

/**
 * One large pick pool → resolve + AU filter → at most one LLM regen if the row is still short.
 * Timing logs identify whether slowness is LLM vs TMDB/AU resolution.
 */
async function finalizeSingleTrackToResponse(
  track: RecommendationTrack,
  chosen: Movie[],
  rejected: Movie[],
  filters: string[],
  mood: SessionMoodProfile,
  banned: MergedBannedContext,
  taste: TasteObservationResult,
  rawFromPrefetch: SingleTrackLLMResult | null,
  timingSessionId: string | undefined,
  laneSessionId: string,
  anonFp: string,
  laneKey: string
): Promise<RecommendationsResponse> {
  const finalizeStart = Date.now();
  const sid = timingSessionId;
  const shortSid = sid && sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;

  const logFinalize = (msg: string, detail?: Record<string, number | string | boolean>) => {
    if (!sid) return;
    const tail = detail ? ` ${JSON.stringify(detail)}` : "";
    console.log(`[recs-finalize] ${shortSid} ${track} ${msg}${tail}`);
  };

  let banRefillLlmMs = 0;
  let auResolvePass1Ms = 0;
  let regenLlmMs = 0;
  let auResolvePass2Ms = 0;
  let regenUsed = false;

  const creative = sessionCreativeByLaneKey.get(laneKey) ?? {
    injectedSubtype: "session mix",
    subtypePromptBlock: "",
  };

  const variationBlock = getOrCreateSessionVariation(laneSessionId).block;
  const otherLaneTmdbIds = getOtherLaneTmdbIds(laneSessionId, anonFp, track);
  const crossLaneHint = buildCrossLaneHint(laneSessionId, anonFp, track);

  const workingBanned = cloneMergedBanned(banned);
  let picks = filterPicksAgainstBanned(rawFromPrefetch?.picks || [], workingBanned.bannedSet);
  if (picks.length < MIN_POOL_AFTER_BAN_FILTER && picks.length < LLM_PICK_COUNT) {
    const n = Math.min(LLM_PICK_COUNT - picks.length, 20);
    const tRefill = Date.now();
    const refill = await refillCandidatePicksLLM(
      n,
      chosen,
      rejected,
      filters,
      track,
      mood,
      workingBanned,
      creative.subtypePromptBlock,
      variationBlock,
      timingSessionId
    );
    banRefillLlmMs = Date.now() - tRefill;
    picks = filterPicksAgainstBanned([...picks, ...refill], workingBanned.bannedSet);
    logFinalize("ban_refill_done", { need: n, added: refill.length, pool: picks.length, refill_ms: banRefillLlmMs });
  }
  let trackCopy: SingleTrackLLMResult | null = rawFromPrefetch;

  const tAu1 = Date.now();
  let recommendations = await resolvePicksToRecommendations(
    picks,
    chosen,
    track,
    mood,
    workingBanned,
    {
      otherLaneTmdbIds: otherLaneTmdbIds,
      logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
    }
  );
  auResolvePass1Ms = Date.now() - tAu1;
  logFinalize("au_resolve_pass1_ms", {
    ms: auResolvePass1Ms,
    pick_pool: picks.length,
    resolved: recommendations.length,
  });

  if (recommendations.length < TARGET_RESOLVED) {
    regenUsed = true;
    logFinalize("REGEN_TRIGGERED", {
      reason: "resolved_lt_target",
      pass1_resolved: recommendations.length,
      target: TARGET_RESOLVED,
      pass1_au_ms: auResolvePass1Ms,
    });
    for (const p of picks) {
      const k = normalizeTitleKey(p.title);
      if (k) workingBanned.bannedSet.add(k);
    }
    const regenExtra =
      "Every pick must be streamable, rentable, or purchasable in Australia (real AU provider destinations). Prior batch had too few AU-available titles; output one fresh full pick list with different titles." +
      (crossLaneHint ? `\n\n${crossLaneHint}` : "");

    const tRegen = Date.now();
    const raw = await generateSingleTrackPicks(
      chosen,
      rejected,
      filters,
      track,
      mood,
      workingBanned,
      regenExtra,
      timingSessionId,
      variationBlock,
      creative.subtypePromptBlock
    );
    regenLlmMs = Date.now() - tRegen;
    logFinalize("regen_llm_ms", {
      ms: regenLlmMs,
      picks_raw: raw.picks?.length ?? 0,
    });
    picks = filterPicksAgainstBanned(raw.picks || [], workingBanned.bannedSet);
    trackCopy = raw;

    const tAu2 = Date.now();
    recommendations = await resolvePicksToRecommendations(
      picks,
      chosen,
      track,
      mood,
      workingBanned,
      {
        otherLaneTmdbIds: otherLaneTmdbIds,
        logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
      }
    );
    auResolvePass2Ms = Date.now() - tAu2;
    logFinalize("au_resolve_pass2_ms", {
      ms: auResolvePass2Ms,
      pick_pool: picks.length,
      resolved: recommendations.length,
    });

    if (recommendations.length < TARGET_RESOLVED) {
      console.warn(
        `[recs-finalize] ${shortSid ?? "?"} ${track} HARD_FAILURE insufficient_resolved after_single_regen ` +
          `resolved=${recommendations.length} target=${TARGET_RESOLVED} ` +
          `(regen_llm_ms=${regenLlmMs} au_pass2_ms=${auResolvePass2Ms})`
      );
    }
  }

  const totalFinalizeMs = Date.now() - finalizeStart;
  if (sid) {
    console.log(
      `[recs-finalize] ${shortSid} ${track} SUMMARY ` +
        `total_finalize_ms=${totalFinalizeMs} ` +
        `ban_refill_llm_ms=${banRefillLlmMs} ` +
        `au_resolve_pass1_ms=${auResolvePass1Ms} ` +
        `regen_used=${regenUsed} ` +
        `regen_llm_ms=${regenLlmMs} ` +
        `au_resolve_pass2_ms=${auResolvePass2Ms} ` +
        `final_resolved_count=${recommendations.length}`
    );
  }

  const mainstream = track === "mainstream" ? recommendations : [];
  const indie = track === "indie" ? recommendations : [];

  const patternFromTrack =
    track === "mainstream"
      ? [trackCopy?.line_what_they_want, trackCopy?.line_what_they_avoid].filter(Boolean).join(" ")
      : [trackCopy?.line_cinema_suggested, trackCopy?.line_trap_avoided].filter(Boolean).join(" ");

  return {
    recommendations,
    mainstreamRecommendations: mainstream,
    indieRecommendations: indie,
    preferenceProfile: {
      topGenres: taste.topGenres || [],
      themes: taste.themes || [],
      preferredEras: taste.preferredEras || [],
      headline: taste.headline,
      patternSummary: patternFromTrack.trim() || taste.patternSummary,
      tagline: "",
    },
  };
}

function kickWarmOtherLane(
  sessionId: string,
  pickedTrack: RecommendationTrack,
  anonFp: string,
  clientAnonMemory: AnonymousRecMemoryEntry[]
): void {
  const other: RecommendationTrack = pickedTrack === "mainstream" ? "indie" : "mainstream";
  if (sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp))?.[other]) return;
  void ensureLaneReady(sessionId, other, clientAnonMemory).catch((err) =>
    console.error("[warm-other-lane]", err)
  );
}

async function ensureLaneReady(
  sessionId: string,
  track: RecommendationTrack,
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<RecommendationsResponse> {
  const totalStart = Date.now();
  await ensureRecsLoaded();
  const anonFp = anonFingerprint(clientAnonMemory);

  const cached = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp))?.[track];
  if (cached) {
    logRecsTiming(sessionId, `lane_${track}_cache_hit`, Date.now() - totalStart);
    return cached;
  }

  const lk = laneInflightKey(sessionId, track, anonFp);
  const inflight = laneInflight.get(lk);
  if (inflight) {
    const r = await inflight;
    logRecsTiming(sessionId, `lane_${track}_inflight_wait`, Date.now() - totalStart);
    return r;
  }

  const work = (async (): Promise<RecommendationsResponse> => {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    const rejected = gameSessionStorage.getRejectedMovies(sessionId);
    const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];

    if (chosen.length === 0) {
      const r = await fallbackSingleTrack(chosen, track);
      mergeLaneBundleIntoCache(sessionId, anonFp, track, r);
      logRecsTiming(sessionId, `lane_${track}_total`, Date.now() - totalStart);
      return r;
    }

    let p1 = prefetchPhase1BySession.get(sessionId);
    if (!p1) {
      p1 = buildPrefetchPhase1(sessionId, chosen, rejected, filters);
      prefetchPhase1BySession.set(sessionId, p1);
    }

    const cooldownId = recCooldownIdentity(sessionId, anonFp);
    const cdState = await storage.getRecCooldownState(cooldownId);
    const laneKey = lanePrefetchKey(sessionId, anonFp);

    let mood: SessionMoodProfile;
    let taste: TasteObservationResult;
    let raw: SingleTrackLLMResult | null = null;
    let bannedMerged: MergedBannedContext;

    try {
      const prefetchWait = Date.now();
      const phase1 = await p1;
      logRecsTiming(sessionId, "prefetch_phase1_wait", Date.now() - prefetchWait);
      mood = phase1.mood;
      taste = phase1.taste;
      patchSessionTasteMeta(sessionId, { mood, taste });
      await startLaneLlmPrefetchIfNeeded(sessionId, clientAnonMemory, phase1, cdState);
      bannedMerged = mergeHardCooldownIntoMerged(
        mergeAnonymousIntoBanned(phase1.banned, clientAnonMemory),
        cdState
      );

      const lanes = laneLlmBySessionIdentity.get(laneKey);
      if (!lanes) {
        throw new Error("lane_llm_not_started");
      }

      const laneWait = Date.now();
      raw = await (track === "mainstream" ? lanes.mainstream : lanes.indie).catch((e) => {
        console.error(`[prefetch] ${track} track failed`, e);
        return { picks: [] as AIRecommendationResult[] };
      });
      logRecsTiming(sessionId, `llm_raw_wait_${track}`, Date.now() - laneWait);

      const filtered = filterPicksAgainstBanned(raw.picks || [], bannedMerged.bannedSet);
      raw = { ...raw, picks: filtered };
    } catch (e) {
      console.error("[prefetch] entry failed", e);
      const moodT0 = Date.now();
      mood = await extractSessionMood(chosen, rejected, filters);
      logRecsTiming(sessionId, "taste_extraction_cold", Date.now() - moodT0);
      taste = moodToTasteObservation(mood, chosen);
      const cdCold = await storage.getRecCooldownState(cooldownId);
      bannedMerged = mergeHardCooldownIntoMerged(
        mergeAnonymousIntoBanned(buildBannedContext(chosen, rejected), clientAnonMemory),
        cdCold
      );
      patchSessionTasteMeta(sessionId, { mood, taste });
      const snap = cooldownHardSnapshot(cdCold);
      const injectedSubtype = pickSessionSubtype(mood, snap.bannedInjectionSubtypes, sessionId);
      const subtypePromptBlock = buildLockedSubtypePromptBlock(injectedSubtype, snap);
      sessionCreativeByLaneKey.set(laneKey, { injectedSubtype, subtypePromptBlock });
      const coldLlm = Date.now();
      raw = await generateSingleTrackPicks(
        chosen,
        rejected,
        filters,
        track,
        mood,
        bannedMerged,
        "",
        sessionId,
        getOrCreateSessionVariation(sessionId).block,
        subtypePromptBlock
      );
      logRecsTiming(sessionId, `llm_${track}_cold_total`, Date.now() - coldLlm);
    }

    const finalizeT0 = Date.now();
    const res = await finalizeSingleTrackToResponse(
      track,
      chosen,
      rejected,
      filters,
      mood,
      bannedMerged,
      taste,
      raw,
      sessionId,
      sessionId,
      anonFp,
      laneKey
    );
    logRecsTiming(sessionId, `finalize_${track}`, Date.now() - finalizeT0);

    mergeLaneBundleIntoCache(sessionId, anonFp, track, res);
    await persistCooldownAfterServe(cooldownId, laneKey, res.recommendations);
    recordRecommendedRow(res.recommendations);

    const cur = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp));
    if (cur?.mainstream && cur?.indie) {
      prefetchPhase1BySession.delete(sessionId);
      clearLanePrefetchForSession(sessionId);
    }

    logRecsTiming(sessionId, `lane_${track}_total`, Date.now() - totalStart);
    return res;
  })();

  laneInflight.set(lk, work);
  try {
    return await work;
  } finally {
    laneInflight.delete(lk);
  }
}

export async function finalizeRecommendationsForTrack(
  sessionId: string,
  track: RecommendationTrack,
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<RecommendationsResponse> {
  const routeStart = Date.now();
  await ensureRecsLoaded();
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  if (chosen.length === 0) {
    return fallbackSingleTrack(chosen, track);
  }

  const anonFp = anonFingerprint(clientAnonMemory);
  const active = await ensureLaneReady(sessionId, track, clientAnonMemory);
  kickWarmOtherLane(sessionId, track, anonFp, clientAnonMemory);

  const bundle = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp)) ?? {};
  const m = bundle.mainstream;
  const i = bundle.indie;

  logRecsTiming(sessionId, "response_total", Date.now() - routeStart);

  return {
    recommendations: active.recommendations,
    mainstreamRecommendations:
      m?.recommendations ?? (track === "mainstream" ? active.recommendations : []),
    indieRecommendations: i?.recommendations ?? (track === "indie" ? active.recommendations : []),
    preferenceProfile: active.preferenceProfile,
    preferenceProfileByTrack:
      m && i
        ? { mainstream: m.preferenceProfile, indie: i.preferenceProfile }
        : undefined,
    hasPersonalisation: false,
    genreProfileSize: 0,
  };
}

async function fallbackSingleTrack(chosenMovies: Movie[], track: RecommendationTrack): Promise<RecommendationsResponse> {
  const taste = fallbackTaste(chosenMovies);
  const allMovies = getAllMovies();
  const pool = shuffleArray(
    allMovies.filter(
      (m) =>
        !chosenMovies.some((c) => c.tmdbId === m.tmdbId) &&
        m.posterPath?.trim() &&
        m.year &&
        m.year >= 1990 &&
        m.rating &&
        m.rating >= 7.0
    )
  ).slice(0, 80);

  const recs: Recommendation[] = [];
  for (const m of pool) {
    if (recs.length >= TARGET_RESOLVED) break;
    const trailerUrls = await getMovieTrailers(m.tmdbId);
    if (trailerUrls.length === 0) continue;
    const watch = await getWatchProviders(m.tmdbId, m.title, m.year);
    if (watch.providers.length === 0) continue;
    recs.push({
      movie: { ...m, listSource: "ai-recommendation" },
      trailerUrl: trailerUrls[0] || null,
      trailerUrls,
      reason: "Sits in the same ballpark as the pattern your picks sketched.",
      pickedAs: track,
      auWatchAvailable: true,
    });
  }

  return {
    recommendations: recs,
    mainstreamRecommendations: track === "mainstream" ? recs : [],
    indieRecommendations: track === "indie" ? recs : [],
    preferenceProfile: {
      topGenres: taste.topGenres,
      themes: [],
      preferredEras: [],
      headline: taste.headline,
      patternSummary: taste.patternSummary,
      tagline: "",
    },
  };
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
    for (const genre of movie.genres) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  }
  return Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
}

function replacementRules(track: RecommendationTrack): string {
  if (track === "indie") {
    return `Less obvious: one strong, less predictable pick — not a default list title; fits funnel; Australia.`;
  }
  return `Mainstream: one accessible pick — avoid generic default blockbusters; fits funnel; Australia.`;
}

export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = [],
  track: RecommendationTrack = "mainstream",
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<Recommendation | null> {
  const picks = chosenMovies.map((m, i) => `R${i + 1}: "${m.title}" (${m.year}) — ${m.director || "?"}`).join("\n");
  const rejHints = rejectedMovies.length > 0
    ? `\nPASSED ON: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}"`).join(", ")}`
    : "";
  const memoryHint =
    clientAnonMemory.length > 0
      ? `\nBrowser memory — do NOT repeat these titles: ${clientAnonMemory
          .slice(-20)
          .map((e) => e.title.trim())
          .join("; ")}.`
      : "";

  const baseUser = `One replacement for the ${track} list. Infer taste from the whole funnel — do not mirror one funnel title to one pick.

${picks}${rejHints}${memoryHint}

Exclude ${excludeTmdbIds.length} titles already shown.

${replacementRules(track)}

The film must be streamable, rentable, or purchasable in Australia (real AU provider options).

Reason: 1–2 sentences, max 35 words. Tie to overall funnel pattern. Do NOT name any funnel film.

JSON only: {"title":"","year":2000,"reason":""}`;

  const triedTitles: string[] = [];

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const banLine =
        triedTitles.length > 0
          ? `\nDo not suggest these (already tried or unavailable in AU): ${triedTitles.join("; ")}.`
          : "";
      const prompt = baseUser + banLine;

      const resp = await openai.chat.completions.create({
        model: RECOMMENDATIONS_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 280,
        temperature: 0.85,
      });
      const result: AIRecommendationResult = JSON.parse(resp.choices[0]?.message?.content || "{}");
      if (!result.title?.trim()) continue;

      const search = await searchMovieByTitle(result.title, result.year);
      if (!search || excludeTmdbIds.includes(search.id)) {
        triedTitles.push(result.title);
        continue;
      }

      const [details, trailers, watch] = await Promise.all([
        getMovieDetails(search.id),
        getMovieTrailers(search.id),
        getWatchProviders(search.id, result.title, result.year ?? null),
      ]);
      if (!details || !details.posterPath?.trim() || trailers.length === 0) {
        triedTitles.push(result.title);
        continue;
      }
      if (watch.providers.length === 0) {
        triedTitles.push(result.title);
        continue;
      }

      details.listSource = "replacement";
      return {
        movie: details,
        trailerUrl: trailers[0],
        trailerUrls: trailers,
        reason: result.reason,
        pickedAs: track,
        auWatchAvailable: true,
      };
    }
  } catch {
    /* fall through */
  }
  return catalogueFallbackReplacement(excludeTmdbIds, track);
}

async function catalogueFallbackReplacement(
  excludeTmdbIds: number[],
  track: RecommendationTrack
): Promise<Recommendation | null> {
  const eligible = shuffleArray(
    getAllMovies().filter((m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0)
  );
  for (const movie of eligible.slice(0, 40)) {
    if (!movie.posterPath?.trim()) continue;
    const trailerUrls = await getMovieTrailers(movie.tmdbId);
    if (trailerUrls.length === 0) continue;
    const watch = await getWatchProviders(movie.tmdbId, movie.title, movie.year);
    if (watch.providers.length === 0) continue;
    return {
      movie: { ...movie, listSource: "replacement" },
      trailerUrl: trailerUrls[0],
      trailerUrls,
      reason: "Fits the mood your rounds pointed toward.",
      pickedAs: track,
      auWatchAvailable: true,
    };
  }
  return null;
}
