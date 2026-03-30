import OpenAI from "openai";
import type { Movie, Recommendation, RecommendationsResponse } from "@shared/schema";
import { searchMovieByTitle, getMovieTrailers, getMovieDetails, getWatchProviders } from "./tmdb";
import type { AnonymousRecMemoryEntry } from "@shared/anonymous-rec-memory";
import { anonFingerprint } from "./anon-memory-request";
import { getAllMovies } from "./catalogue";
import { storage } from "./storage";
import { sessionStorage as gameSessionStorage } from "./session-storage";
import type { SessionMoodProfile } from "./session-mood-profile";
export type { SessionMoodProfile } from "./session-mood-profile";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  maxRetries: 1,
});

/** Mood extraction only — capable model. */
const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";
/** 5-pick single-row recommendation LLM. */
const REC_ROW_MODEL = process.env.OPENAI_REC_ROW_MODEL ?? "gpt-4o-mini";

/** DB bundle persistence (parallel arrays) — not the mood-fingerprint map below. */
const bundleTitleKeys: string[] = [];
const recentlyRecommendedFingerprints: string[] = [];
const recentlyRecommendedDirectors: string[] = [];
const recentlyRecommendedDisplayTitles: string[] = [];
const recentlyRecommendedFlavours: string[] = [];
const recentlyRecommendedTones: string[] = [];
const recentlyRecommendedPrestige: string[] = [];
const recentlyRecommendedFeelKeys: string[] = [];
const MAX_RECENT_TRACKED = 400;
const TARGET_TOTAL_RESOLVE = 5;

/** Cross-session titles already suggested for this mood fingerprint (preferred_tone + pacing). */
const recentlyRecommendedTitles = new Map<string, string[]>();
const moodFingerprintInsertOrder: string[] = [];
const MAX_TITLES_PER_MOOD_FP = 20;
const MAX_MOOD_FINGERPRINTS = 20;

let recsLoaded = false;

async function ensureRecsLoaded(): Promise<void> {
  if (recsLoaded) return;
  recsLoaded = true;
  try {
    const b = await storage.getRecentRecommendationBundles();
    for (let i = 0; i < b.titles.length; i++) {
      const tk = normalizeTitleKey(b.titles[i] || "");
      if (!tk) continue;
      bundleTitleKeys.push(tk);
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
    console.log(`[recent-recs] Loaded ${bundleTitleKeys.length} prior picks from DB`);
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
    if (!tk || bundleTitleKeys.includes(tk)) continue;
    const m = r.movie;
    bundleTitleKeys.push(tk);
    recentlyRecommendedFingerprints.push("");
    recentlyRecommendedDirectors.push(
      (m.director || "").toLowerCase().trim() || `__dir_${m.tmdbId}`
    );
    recentlyRecommendedDisplayTitles.push(m.title.trim() || tk);
    recentlyRecommendedFlavours.push("");
    recentlyRecommendedTones.push("");
    recentlyRecommendedPrestige.push("");
    recentlyRecommendedFeelKeys.push("");
    while (bundleTitleKeys.length > MAX_RECENT_TRACKED) {
      bundleTitleKeys.shift();
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
      titles: [...bundleTitleKeys],
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

interface RowLLMResult {
  profile_line: string;
  picks: AIRecommendationResult[];
}

interface PrefetchPhase1 {
  mood: SessionMoodProfile;
  taste: TasteObservationResult;
  /** Comma-separated A/B session titles for the rec prompt only. */
  abBanTitlesLine: string;
  chosen: Movie[];
  rejected: Movie[];
  filters: string[];
}

function formatAbBanListForPrompt(chosenMovies: Movie[], rejectedMovies: Movie[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const m of [...chosenMovies, ...rejectedMovies]) {
    const t = m.title?.trim();
    if (!t) continue;
    const k = t.toLowerCase().trim().replace(/^the\s+/i, "");
    if (!k || seen.has(k)) continue;
    seen.add(k);
    labels.push(t);
  }
  return labels.join(", ") || "(none)";
}

function moodFingerprint(mood: SessionMoodProfile): string {
  return `${String(mood.preferred_tone || "").trim()}|${String(mood.pacing || "").trim()}`;
}

function ensureMoodFingerprintRegistered(fp: string): void {
  if (recentlyRecommendedTitles.has(fp)) return;
  while (moodFingerprintInsertOrder.length >= MAX_MOOD_FINGERPRINTS) {
    const evict = moodFingerprintInsertOrder.shift()!;
    recentlyRecommendedTitles.delete(evict);
  }
  moodFingerprintInsertOrder.push(fp);
  recentlyRecommendedTitles.set(fp, []);
}

function rememberResolvedTitlesForMoodFingerprint(mood: SessionMoodProfile, displayTitles: string[]): void {
  const fp = moodFingerprint(mood);
  ensureMoodFingerprintRegistered(fp);
  const prev = recentlyRecommendedTitles.get(fp) ?? [];
  const merged = [...prev];
  for (const t of displayTitles) {
    const s = t.trim();
    if (s) merged.push(s);
  }
  recentlyRecommendedTitles.set(fp, merged.slice(-MAX_TITLES_PER_MOOD_FP));
}

function moodRecentTitlesList(mood: SessionMoodProfile): string[] {
  return recentlyRecommendedTitles.get(moodFingerprint(mood)) ?? [];
}

function formatChosenTitlesForRecPrompt(chosen: Movie[]): string {
  if (chosen.length === 0) return "(none)";
  return chosen.map((m) => `- "${m.title}" (${m.year ?? "?"})`).join("\n");
}

function formatRejectedTitlesForRecPrompt(rejected: Movie[]): string {
  if (rejected.length === 0) return "(none)";
  return rejected.map((m) => `- "${m.title}" (${m.year ?? "?"})`).join("\n");
}

const prefetchPhase1BySession = new Map<string, Promise<PrefetchPhase1>>();
const singleRowLlmBySessionIdentity = new Map<string, Promise<RowLLMResult>>();

function rowPrefetchKey(sessionId: string, anonFp: string): string {
  return `${sessionId}\t${anonFp}`;
}

function clearRowPrefetchForSession(sessionId: string): void {
  const prefix = `${sessionId}\t`;
  Array.from(singleRowLlmBySessionIdentity.keys()).forEach((k) => {
    if (k.startsWith(prefix)) singleRowLlmBySessionIdentity.delete(k);
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
  const abBanTitlesLine = formatAbBanListForPrompt(chosenMovies, rejectedMovies);
  return { mood, taste, abBanTitlesLine, chosen: chosenMovies, rejected: rejectedMovies, filters };
}

async function startSingleRowLlmPrefetchIfNeeded(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[],
  phase1: PrefetchPhase1
): Promise<void> {
  const anonFp = anonFingerprint(clientAnonMemory);
  const key = rowPrefetchKey(sessionId, anonFp);
  if (singleRowLlmBySessionIdentity.has(key)) return;

  singleRowLlmBySessionIdentity.set(
    key,
    generateRowPicks(phase1.chosen, phase1.rejected, phase1.mood, phase1.abBanTitlesLine, "", sessionId)
  );
}

const TEN_PICK_SYSTEM = `You are a world-class film curator — the kind of person who has seen everything, remembers all of it, and can read exactly what someone wants tonight from the pattern of their choices. You give confident, specific recommendations like a knowledgeable friend, not a recommendation algorithm. You never play it safe. You never default to the obvious. You think laterally across decades, countries, budgets, and movements to find the five films that are genuinely right for this person tonight.`;

function buildTenPickUserMessage(
  chosen: Movie[],
  rejected: Movie[],
  abBanTitlesLine: string,
  mood: SessionMoodProfile,
  promptExtra: string
): string {
  const recentList = moodRecentTitlesList(mood);
  const recentLine = recentList.length > 0 ? recentList.join(", ") : "(none)";
  const goDeeperBullet =
    recentList.length > 0 ?
      "\n- If recent titles exist: the obvious choices for this mood have already been used — go deeper and find less obvious but equally powerful matches"
    : "";

  return `A user just completed a 7-round A/B movie voting session. Here is what they chose and what they rejected:

CHOSEN (what they wanted):
${formatChosenTitlesForRecPrompt(chosen)}

REJECTED (what they didn't want tonight):
${formatRejectedTitlesForRecPrompt(rejected)}

Read the pattern holistically. The rejections are as important as the choices — they tell you what tone, energy, and type of film this person is actively avoiding right now.

From this pattern, infer:
- The emotional register they're after (tense, heavy, funny, warm, cerebral etc)
- The pacing they want (slow burn, propulsive, contemplative)
- The darkness level they can handle tonight
- What they are clearly NOT in the mood for based on rejections

Then recommend exactly 5 films that match what this pattern reveals.

Rules:
- No two films from the same director
- Span at least 3 different decades across the 5
- At least 1 non-English language film
- No sequels or franchise entries unless the franchise itself is a direct mood match
- Do not suggest any of these titles (user already voted on them): ${abBanTitlesLine}
- Do not suggest any of these recently recommended titles: ${recentLine}${goDeeperBullet}

Each film gets exactly one line of reason — written like a knowledgeable friend recommending it, not an algorithm. Specific, confident, no hedging. Example: "Slow-burn western that turns into something genuinely horrifying — shares the survival DNA of your horror picks." NOT "We chose this because you selected The Descent."

Return JSON only:
{
  "profile_line": "max 8 words, friend voice, describes tonight's mood — not a genre label",
  "picks": [
    {"title": "", "year": 0, "reason": "one line, friend voice, specific"},
    {"title": "", "year": 0, "reason": "one line, friend voice, specific"},
    {"title": "", "year": 0, "reason": "one line, friend voice, specific"},
    {"title": "", "year": 0, "reason": "one line, friend voice, specific"},
    {"title": "", "year": 0, "reason": "one line, friend voice, specific"}
  ]
}
${promptExtra.trim() ? `\n\nAdditional instruction:\n${promptExtra.trim()}` : ""}`;
}

function parseTitleYearRow(o: Record<string, unknown>): AIRecommendationResult | null {
  const title = String(o.title || "").trim();
  if (!title) return null;
  return {
    title,
    year: parseYearField(o.year),
    reason: String(o.reason || "").trim(),
  };
}

function parsePicksRowResponse(raw: Record<string, unknown>): RowLLMResult {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const picks: AIRecommendationResult[] = picksIn
    .map((p: unknown) => parseTitleYearRow(p as Record<string, unknown>))
    .filter((x): x is AIRecommendationResult => !!x)
    .slice(0, TARGET_TOTAL_RESOLVE);
  const profile_line = String(raw.profile_line || "").trim();
  return { profile_line, picks };
}

async function generateRowPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  mood: SessionMoodProfile,
  abBanTitlesLine: string,
  promptExtra: string,
  timingSessionId?: string
): Promise<RowLLMResult> {
  const user = buildTenPickUserMessage(chosenMovies, rejectedMovies, abBanTitlesLine, mood, promptExtra);

  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: REC_ROW_MODEL,
    messages: [
      { role: "system", content: TEN_PICK_SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1500,
    temperature: 0.9,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, "llm_five_pick_row", Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  return parsePicksRowResponse(raw);
}

export async function extractSessionMood(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[] = []
): Promise<SessionMoodProfile> {
  const winners = formatChoicesBlock(chosenMovies);
  const losers = formatRejectsBlock(rejectedMovies, chosenMovies);
  const genreLine =
    initialGenreFilters.length > 0
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

export async function buildTasteObservation(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[] = []
): Promise<TasteObservationResult> {
  const mood = await extractSessionMood(chosenMovies, rejectedMovies, initialGenreFilters);
  return moodToTasteObservation(mood, chosenMovies);
}

const sessionTasteMeta = new Map<string, { taste?: TasteObservationResult; mood?: SessionMoodProfile }>();
const sessionRecBundleCache = new Map<string, RecommendationsResponse>();
const recInflight = new Map<string, Promise<RecommendationsResponse>>();

function recBundleKey(sessionId: string, anonFp: string): string {
  return `${sessionId}::${anonFp}`;
}

function recInflightKey(sessionId: string, anonFp: string): string {
  return `${sessionId}::${anonFp}`;
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

function mergeRecBundleIntoCache(sessionId: string, anonFp: string, res: RecommendationsResponse): void {
  sessionRecBundleCache.set(recBundleKey(sessionId, anonFp), res);
}

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/^the\s+/i, "");
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
  return chosenMovies
    .map((m, i) => {
      const round = i + 1;
      const star = round >= 5 ? "*" : "";
      const kw = (m.keywords || []).slice(0, 5).join(", ") || "—";
      return `R${round}${star}: "${m.title}" (${m.year}) — ${m.genres[0] || "Unknown"}, dir. ${m.director || "Unknown"}, kw: ${kw}`;
    })
    .join("\n");
}

function formatRejectsBlock(rejectedMovies: Movie[], chosenMovies: Movie[]): string {
  if (rejectedMovies.length === 0) return "(none)";
  return rejectedMovies
    .map((m, i) => {
      const chosen = chosenMovies[i];
      return `R${i + 1}: passed on "${m.title}" (${m.year}) — picked "${chosen?.title ?? "—"}"`;
    })
    .join("\n");
}

function fallbackTaste(chosenMovies: Movie[]): TasteObservationResult {
  const g = extractTopGenres(chosenMovies);
  return {
    headline: "SOMETHING THAT FITS TONIGHT",
    patternSummary: "You're in the mood for a watch that matches how you've been choosing.",
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

function moodWantSentence(mood: SessionMoodProfile): string {
  const parts = (mood.what_they_want || []).filter(Boolean).slice(0, 5);
  if (parts.length === 0) return "";
  const joined =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `You're in the mood for ${joined}.`;
}

function moodToTasteObservation(mood: SessionMoodProfile, chosenMovies: Movie[]): TasteObservationResult {
  const tone = (mood.preferred_tone || "").trim();
  const headline = tone ? tone.toUpperCase() : fallbackTaste(chosenMovies).headline;
  const patternSummary =
    moodWantSentence(mood).trim() || fallbackTaste(chosenMovies).patternSummary;
  return {
    headline,
    patternSummary,
    topGenres: extractTopGenres(chosenMovies),
    themes: [mood.emotional_texture, mood.pacing, mood.complexity].filter(Boolean),
    preferredEras: [],
  };
}

async function resolveOneRecommendation(
  rec: AIRecommendationResult,
  excludeTmdbIds: Set<number>
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

    movieDetails.listSource = "ai-recommendation";
    const urls = Array.isArray(tmdbTrailers) ? tmdbTrailers : [];
    return {
      movie: movieDetails,
      trailerUrl: urls[0] ?? null,
      trailerUrls: urls,
      reason: rec.reason?.trim() ?? "",
      auWatchAvailable: true,
    };
  } catch {
    return null;
  }
}

async function resolvePicksToRecommendations(
  picks: AIRecommendationResult[],
  chosenMovies: Movie[],
  opts: { logCluster?: { sessionId: string } } = {}
): Promise<Recommendation[]> {
  const excludeTmdb = new Set(chosenMovies.map((m) => m.tmdbId));

  const ordered = picks.slice(0, TARGET_TOTAL_RESOLVE);
  const tResolve = Date.now();
  const settled = await Promise.all(ordered.map((r) => resolveOneRecommendation(r, excludeTmdb)));
  const resolveMs = Date.now() - tResolve;

  const out: Recommendation[] = [];
  const seenTitles = new Set<string>();
  const seenDirectors = new Set<string>();
  for (const rec of settled) {
    if (!rec) continue;
    const tk = normalizeTitleKey(rec.movie.title);
    const dk = directorKeyForMovie(rec.movie);
    if (seenTitles.has(tk) || seenDirectors.has(dk)) continue;
    seenTitles.add(tk);
    seenDirectors.add(dk);
    out.push(rec);
    if (out.length >= TARGET_TOTAL_RESOLVE) break;
  }

  if (opts.logCluster?.sessionId) {
    const sid = opts.logCluster.sessionId;
    const short = sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;
    console.log(
      `[recs-resolve] ${short} row tmdb_au_ms=${resolveMs} ` +
        `llm_picks=${ordered.length} resolved=${out.length}`
    );
  }

  return out;
}

export function beginRecommendationPrefetch(sessionId: string): void {
  const session = gameSessionStorage.getSession(sessionId);
  if (!session?.isComplete) return;
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) return;

  if (!prefetchPhase1BySession.has(sessionId)) {
    console.log(`[prefetch] Starting taste extraction for ${sessionId} (row LLM deferred until results)`);
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
    await startSingleRowLlmPrefetchIfNeeded(sessionId, clientAnonMemory, phase1);
    return phase1.taste;
  } catch {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    return fallbackTaste(chosen);
  }
}

function rowPicksFromRaw(raw: RowLLMResult | null): AIRecommendationResult[] {
  if (!raw?.picks?.length) return [];
  return raw.picks.slice(0, TARGET_TOTAL_RESOLVE);
}

async function finalizeRecommendationsToResponse(
  chosen: Movie[],
  taste: TasteObservationResult,
  rawFromPrefetch: RowLLMResult | null,
  timingSessionId: string | undefined,
  mood: SessionMoodProfile
): Promise<RecommendationsResponse> {
  const finalizeStart = Date.now();
  const sid = timingSessionId;
  const shortSid = sid && sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;

  const logFinalize = (msg: string, detail?: Record<string, number | string | boolean>) => {
    if (!sid) return;
    const tail = detail ? ` ${JSON.stringify(detail)}` : "";
    console.log(`[recs-finalize] ${shortSid} row ${msg}${tail}`);
  };

  const picks = rowPicksFromRaw(rawFromPrefetch);
  const rowCopy = rawFromPrefetch;

  const tAu1 = Date.now();
  const recommendations = await resolvePicksToRecommendations(picks, chosen, {
    logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
  });
  if (recommendations.length > 0) {
    rememberResolvedTitlesForMoodFingerprint(
      mood,
      recommendations.map((r) => r.movie.title.trim()).filter(Boolean)
    );
  }
  const auResolveMs = Date.now() - tAu1;
  logFinalize("au_resolve_ms", {
    ms: auResolveMs,
    pick_pool: picks.length,
    resolved: recommendations.length,
  });

  const totalFinalizeMs = Date.now() - finalizeStart;
  if (sid) {
    console.log(
      `[recs-finalize] ${shortSid} SUMMARY ` +
        `total_finalize_ms=${totalFinalizeMs} ` +
        `au_resolve_total_ms=${auResolveMs} ` +
        `final_resolved_count=${recommendations.length}`
    );
  }

  const profileLine = (rowCopy?.profile_line || "").trim();
  const headline = profileLine || taste.headline;

  return {
    recommendations,
    preferenceProfile: {
      topGenres: taste.topGenres || [],
      themes: taste.themes || [],
      preferredEras: taste.preferredEras || [],
      headline,
      patternSummary: "",
      tagline: "",
    },
  };
}

async function ensureRecommendationsReady(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<RecommendationsResponse> {
  const totalStart = Date.now();
  await ensureRecsLoaded();
  const anonFp = anonFingerprint(clientAnonMemory);

  const cached = sessionRecBundleCache.get(recBundleKey(sessionId, anonFp));
  if (cached) {
    logRecsTiming(sessionId, "rec_row_cache_hit", Date.now() - totalStart);
    return cached;
  }

  const lk = recInflightKey(sessionId, anonFp);
  const inflight = recInflight.get(lk);
  if (inflight) {
    const r = await inflight;
    logRecsTiming(sessionId, "rec_row_inflight_wait", Date.now() - totalStart);
    return r;
  }

  const work = (async (): Promise<RecommendationsResponse> => {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    const rejected = gameSessionStorage.getRejectedMovies(sessionId);
    const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];

    if (chosen.length === 0) {
      const r = await fallbackRecommendations(chosen);
      mergeRecBundleIntoCache(sessionId, anonFp, r);
      logRecsTiming(sessionId, "rec_row_total", Date.now() - totalStart);
      return r;
    }

    let p1 = prefetchPhase1BySession.get(sessionId);
    if (!p1) {
      p1 = buildPrefetchPhase1(sessionId, chosen, rejected, filters);
      prefetchPhase1BySession.set(sessionId, p1);
    }

    const rowKey = rowPrefetchKey(sessionId, anonFp);

    let mood: SessionMoodProfile;
    let taste: TasteObservationResult;
    let raw: RowLLMResult | null = null;

    const emptyRow = (): RowLLMResult => ({
      profile_line: "",
      picks: [],
    });

    try {
      const prefetchWait = Date.now();
      const phase1 = await p1;
      logRecsTiming(sessionId, "prefetch_phase1_wait", Date.now() - prefetchWait);
      mood = phase1.mood;
      taste = phase1.taste;
      patchSessionTasteMeta(sessionId, { mood, taste });
      await startSingleRowLlmPrefetchIfNeeded(sessionId, clientAnonMemory, phase1);

      const rowPromise = singleRowLlmBySessionIdentity.get(rowKey);
      if (!rowPromise) {
        throw new Error("row_llm_not_started");
      }

      const rowWait = Date.now();
      raw = await rowPromise.catch((e) => {
        console.error("[prefetch] five-pick row LLM failed", e);
        return emptyRow();
      });
      logRecsTiming(sessionId, "llm_raw_wait_row", Date.now() - rowWait);
    } catch (e) {
      console.error("[prefetch] entry failed", e);
      const moodT0 = Date.now();
      mood = await extractSessionMood(chosen, rejected, filters);
      logRecsTiming(sessionId, "taste_extraction_cold", Date.now() - moodT0);
      taste = moodToTasteObservation(mood, chosen);
      patchSessionTasteMeta(sessionId, { mood, taste });
      const coldLlm = Date.now();
      const abLine = formatAbBanListForPrompt(chosen, rejected);
      raw = await generateRowPicks(chosen, rejected, mood, abLine, "", sessionId);
      logRecsTiming(sessionId, "llm_row_cold_total", Date.now() - coldLlm);
    }

    const finalizeT0 = Date.now();
    const res = await finalizeRecommendationsToResponse(chosen, taste, raw, sessionId, mood);
    logRecsTiming(sessionId, "finalize_row", Date.now() - finalizeT0);

    mergeRecBundleIntoCache(sessionId, anonFp, res);
    recordRecommendedRow(res.recommendations);

    prefetchPhase1BySession.delete(sessionId);
    clearRowPrefetchForSession(sessionId);

    logRecsTiming(sessionId, "rec_row_total", Date.now() - totalStart);
    return res;
  })();

  recInflight.set(lk, work);
  try {
    return await work;
  } finally {
    recInflight.delete(lk);
  }
}

export async function finalizeRecommendationsForSession(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<RecommendationsResponse> {
  const routeStart = Date.now();
  await ensureRecsLoaded();
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  if (chosen.length === 0) {
    return fallbackRecommendations(chosen);
  }

  const active = await ensureRecommendationsReady(sessionId, clientAnonMemory);

  logRecsTiming(sessionId, "response_total", Date.now() - routeStart);

  return {
    ...active,
    hasPersonalisation: false,
    genreProfileSize: 0,
  };
}

async function fallbackRecommendations(chosenMovies: Movie[]): Promise<RecommendationsResponse> {
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
    if (recs.length >= TARGET_TOTAL_RESOLVE) break;
    const trailerUrls = await getMovieTrailers(m.tmdbId);
    if (trailerUrls.length === 0) continue;
    const watch = await getWatchProviders(m.tmdbId, m.title, m.year);
    if (watch.providers.length === 0) continue;
    recs.push({
      movie: { ...m, listSource: "ai-recommendation" },
      trailerUrl: trailerUrls[0] || null,
      trailerUrls,
      reason: "",
      auWatchAvailable: true,
    });
  }

  return {
    recommendations: recs,
    preferenceProfile: {
      topGenres: taste.topGenres,
      themes: [],
      preferredEras: [],
      headline: taste.headline,
      patternSummary: "",
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

export async function generateReplacementRecommendation(
  chosenMovies: Movie[],
  excludeTmdbIds: number[],
  rejectedMovies: Movie[] = [],
  _clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<Recommendation | null> {
  const picks = chosenMovies.map((m, i) => `R${i + 1}: "${m.title}" (${m.year}) — ${m.director || "?"}`).join("\n");
  const rejHints =
    rejectedMovies.length > 0
      ? `\nPASSED ON: ${rejectedMovies.slice(0, 3).map((m) => `"${m.title}"`).join(", ")}`
      : "";

  const baseUser = `One replacement pick for this user's row. Infer taste from the whole A/B funnel — do not mirror one funnel title to one pick.

${picks}${rejHints}

Exclude ${excludeTmdbIds.length} titles already shown.

Pick one film that fits the same mood as the funnel, feels less obvious than a default list title when possible, and is streamable/rentable/buyable in Australia.

JSON only: {"title":"","year":2000} — title and year only, no reason field.`;

  const triedTitles: string[] = [];

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const banLine =
        triedTitles.length > 0
          ? `\nDo not suggest these (already tried or unavailable in AU): ${triedTitles.join("; ")}.`
          : "";
      const prompt = baseUser + banLine;

      const resp = await openai.chat.completions.create({
        model: REC_ROW_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 280,
        temperature: 0.85,
      });
      const parsed = JSON.parse(resp.choices[0]?.message?.content || "{}") as Record<string, unknown>;
      const result: AIRecommendationResult = {
        title: String(parsed.title || "").trim(),
        year: parseYearField(parsed.year),
        reason: "",
      };
      if (!result.title) continue;

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
        reason: "",
        auWatchAvailable: true,
      };
    }
  } catch {
    /* fall through */
  }
  return catalogueFallbackReplacement(excludeTmdbIds);
}

async function catalogueFallbackReplacement(excludeTmdbIds: number[]): Promise<Recommendation | null> {
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
      reason: "",
      auWatchAvailable: true,
    };
  }
  return null;
}
