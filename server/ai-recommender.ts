import Anthropic from "@anthropic-ai/sdk";
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/** Mood extraction only — capable model. */
const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";
/** 5-pick row — Claude Sonnet (recommendation pass only). */
const CLAUDE_REC_MODEL = process.env.ANTHROPIC_REC_MODEL ?? "claude-sonnet-4-20250514";
/** Replacement pick LLM (OpenAI). */
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
const MAX_TITLES_PER_MOOD_FP = 40;
const MAX_MOOD_FINGERPRINTS = 30;

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
  chosen: Movie[];
  rejected: Movie[];
  filters: string[];
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
  const before = [...(recentlyRecommendedTitles.get(fp) ?? [])];
  const added = displayTitles.map((t) => t.trim()).filter(Boolean);
  ensureMoodFingerprintRegistered(fp);
  const prev = recentlyRecommendedTitles.get(fp) ?? [];
  const merged = [...prev];
  for (const t of added) merged.push(t);
  const next = merged.slice(-MAX_TITLES_PER_MOOD_FP);
  recentlyRecommendedTitles.set(fp, next);
  console.log(
    `[recent-titles-store] after_finalize fingerprint=${JSON.stringify(fp)} before=${JSON.stringify(before)} added=${JSON.stringify(added)} after=${JSON.stringify(next)}`
  );
}

function moodRecentTitlesList(mood: SessionMoodProfile): string[] {
  return recentlyRecommendedTitles.get(moodFingerprint(mood)) ?? [];
}

function formatChosenTitlesForRecPrompt(chosen: Movie[]): string {
  if (chosen.length === 0) return "(none)";
  return chosen.map((m) => `- ${m.title}, ${m.year ?? "?"}`).join("\n");
}

function formatRejectedTitlesForRecPrompt(rejected: Movie[]): string {
  if (rejected.length === 0) return "(none)";
  return rejected.map((m) => `- ${m.title}, ${m.year ?? "?"}`).join("\n");
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
  return { mood, taste, chosen: chosenMovies, rejected: rejectedMovies, filters };
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
    generateRowPicks(phase1.chosen, phase1.rejected, phase1.mood, "", sessionId)
  );
}

const TEN_PICK_SYSTEM = `You are a world-class film curator with deep knowledge of cinema across all eras, countries, budgets and movements. You think like a knowledgeable friend — specific, confident, never defaulting to the obvious. When you see a pattern in someone's choices you follow it laterally into unexpected territory. You never recommend the first film that comes to mind for a mood. You go one level deeper.`;

function buildTenPickUserMessage(
  chosen: Movie[],
  rejected: Movie[],
  mood: SessionMoodProfile,
  promptExtra: string
): string {
  const recentList = moodRecentTitlesList(mood);
  const recentSuffix =
    recentList.length > 0 ?
      `\n\nThese titles were recently recommended — avoid repeating them: ${recentList.join(", ")}`
    : "";

  return `A user just completed a 7-round A/B movie voting session. Here is exactly what they chose and what they rejected:

CHOSEN:
${formatChosenTitlesForRecPrompt(chosen)}

REJECTED:
${formatRejectedTitlesForRecPrompt(rejected)}

Read the contrast between chosen and rejected holistically. The rejections are as important as the choices — they define what this person is actively NOT in the mood for tonight.

Recommend exactly 5 films that match what this pattern reveals. 

Think broadly across all of cinema — every decade, every country, every budget level. Do not default to the most famous films for this mood. Ask yourself: what are the less obvious but equally powerful films that match this exact emotional register?

Rules:
- No two films from the same director
- Span at least 3 different decades across the 5
- No more than 1 film from before 1980 across the 5 picks
- At least 1 non-English language film
- No sequels or franchise entries unless the franchise itself directly matches the mood
- Every pick must genuinely match the emotional pattern revealed by the chosen vs rejected contrast

Return JSON only:
{
  "profile_line": "max 8 words, sounds like a knowledgeable friend describing tonight's mood, not a genre label",
  "picks": [
    {"title": "", "year": 0},
    {"title": "", "year": 0},
    {"title": "", "year": 0},
    {"title": "", "year": 0},
    {"title": "", "year": 0}
  ]
}${promptExtra.trim() ? `\n\nAdditional instruction:\n${promptExtra.trim()}` : ""}${recentSuffix}`;
}

function parseTitleYearRow(o: Record<string, unknown>): AIRecommendationResult | null {
  const title = String(o.title || "").trim();
  if (!title) return null;
  return {
    title,
    year: parseYearField(o.year),
    reason: "",
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

/**
 * Extract assistant text from Claude Messages API response.
 * Primary path: response.content[0].text when the first block is type "text"
 * (same data as OpenAI's choices[0].message.content, different shape).
 */
function textFromClaudeMessage(msg: Anthropic.Messages.Message): string {
  const blocks = msg.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const first = blocks[0];
  if (first.type === "text" && "text" in first) {
    return String((first as Anthropic.Messages.TextBlock).text).trim();
  }
  return blocks
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Strip optional ```json fences; parse JSON object. */
function parseJsonObjectFromLlmText(text: string, logLabel: string): Record<string, unknown> {
  let s = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)```\s*$/m.exec(s);
  if (m) s = m[1].trim();
  try {
    return JSON.parse(s || "{}") as Record<string, unknown>;
  } catch (e) {
    console.error(`[${logLabel}] JSON.parse failed:`, e, "snippet:", s.slice(0, 600));
    return {};
  }
}

async function generateRowPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  mood: SessionMoodProfile,
  promptExtra: string,
  timingSessionId?: string
): Promise<RowLLMResult> {
  console.log(`[claude-row] ANTHROPIC_API_KEY present=${Boolean(process.env.ANTHROPIC_API_KEY?.trim())}`);

  const fpKey = moodFingerprint(mood);
  const storeBeforeLlm = [...(recentlyRecommendedTitles.get(fpKey) ?? [])];
  console.log(
    `[recent-titles-store] before_row_llm fingerprint=${JSON.stringify(fpKey)} titles_in_store=${JSON.stringify(storeBeforeLlm)}`
  );

  const user = buildTenPickUserMessage(chosenMovies, rejectedMovies, mood, promptExtra);

  try {
    const t0 = Date.now();
    const response = await anthropic.messages.create({
      model: CLAUDE_REC_MODEL,
      max_tokens: 1200,
      temperature: 0.9,
      system: TEN_PICK_SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    if (timingSessionId) {
      logRecsTiming(timingSessionId, "llm_claude_row", Date.now() - t0);
    }

    const text = textFromClaudeMessage(response);
    if (!text) {
      console.warn(
        "[claude-row] No assistant text extracted; content block types:",
        response.content?.map((c) => c.type)
      );
      return { profile_line: "", picks: [] };
    }

    const raw = parseJsonObjectFromLlmText(text, "claude-row");
    const parsed = parsePicksRowResponse(raw);
    if (!parsed.picks.length) {
      console.warn(
        "[claude-row] Parsed JSON has no picks; object keys:",
        Object.keys(raw),
        "text_preview:",
        text.slice(0, 500)
      );
    }
    return parsed;
  } catch (err) {
    console.error("[claude-row] Claude request or handling failed:", err);
    return { profile_line: "", picks: [] };
  }
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

function mergeRecommendationsDeduped(a: Recommendation[], b: Recommendation[]): Recommendation[] {
  const seenT = new Set<string>();
  const seenD = new Set<string>();
  const out: Recommendation[] = [];
  for (const rec of [...a, ...b]) {
    const tk = normalizeTitleKey(rec.movie.title);
    const dk = directorKeyForMovie(rec.movie);
    if (seenT.has(tk) || seenD.has(dk)) continue;
    seenT.add(tk);
    seenD.add(dk);
    out.push(rec);
  }
  return out;
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

/** Catalogue movie already has tmdbId — re-verify AU providers + trailers like resolveOneRecommendation. */
async function resolveMovieFromCatalogueCandidate(movie: Movie): Promise<Recommendation | null> {
  try {
    const [movieDetails, tmdbTrailers, watchResult] = await Promise.all([
      getMovieDetails(movie.tmdbId),
      getMovieTrailers(movie.tmdbId).catch(() => [] as string[]),
      getWatchProviders(movie.tmdbId, movie.title, movie.year ?? null),
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
      reason: "",
      auWatchAvailable: true,
    };
  } catch {
    return null;
  }
}

async function padRecommendationsFromHighRatedGenre(
  need: number,
  topGenre: string | undefined,
  chosen: Movie[],
  existing: Recommendation[],
  shortSid: string | undefined
): Promise<Recommendation[]> {
  if (need <= 0) return [];
  const excludeTmdb = new Set<number>([
    ...chosen.map((m) => m.tmdbId),
    ...existing.map((r) => r.movie.tmdbId),
  ]);
  const seenTitle = new Set(existing.map((r) => normalizeTitleKey(r.movie.title)));
  const seenDir = new Set(existing.map((r) => directorKeyForMovie(r.movie)));
  const out: Recommendation[] = [];
  const genreNorm = topGenre?.toLowerCase().trim() || "";
  const minRatings = [7.0, 6.5, 6.0];

  for (const minR of minRatings) {
    if (out.length >= need) break;
    const all = getAllMovies();
    let pool = all.filter(
      (m) =>
        !excludeTmdb.has(m.tmdbId) &&
        (m.rating ?? 0) >= minR &&
        m.posterPath?.trim() &&
        (!genreNorm || m.genres.some((g) => g.toLowerCase() === genreNorm))
    );
    if (pool.length < need * 2 && genreNorm) {
      pool = all.filter(
        (m) => !excludeTmdb.has(m.tmdbId) && (m.rating ?? 0) >= minR && m.posterPath?.trim()
      );
    }
    pool.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

    const PAD_BATCH = 10;
    let pi = 0;
    while (pi < pool.length && out.length < need) {
      const chunk: Movie[] = [];
      while (chunk.length < PAD_BATCH && pi < pool.length) {
        const m = pool[pi++];
        const tk = normalizeTitleKey(m.title);
        const dk = directorKeyForMovie(m);
        if (seenTitle.has(tk) || seenDir.has(dk)) continue;
        chunk.push(m);
      }
      if (chunk.length === 0) continue;
      const settled = await Promise.all(chunk.map((m) => resolveMovieFromCatalogueCandidate(m)));
      for (let i = 0; i < chunk.length && out.length < need; i++) {
        const rec = settled[i];
        if (!rec) continue;
        const m = chunk[i];
        const tk = normalizeTitleKey(m.title);
        const dk = directorKeyForMovie(m);
        if (seenTitle.has(tk) || seenDir.has(dk)) continue;
        seenTitle.add(tk);
        seenDir.add(dk);
        excludeTmdb.add(m.tmdbId);
        out.push(rec);
      }
    }
  }

  if (shortSid) {
    console.log(`[recs-finalize] ${shortSid} catalog_pad need=${need} added=${out.length}`);
  }
  return out;
}

async function resolvePicksToRecommendations(
  picks: AIRecommendationResult[],
  chosenMovies: Movie[],
  opts: { logCluster?: { sessionId: string }; extraExcludeTmdbIds?: Set<number> } = {}
): Promise<Recommendation[]> {
  const excludeTmdb = new Set(chosenMovies.map((m) => m.tmdbId));
  if (opts.extraExcludeTmdbIds) {
    for (const id of opts.extraExcludeTmdbIds) excludeTmdb.add(id);
  }

  const ordered = picks.slice(0, TARGET_TOTAL_RESOLVE);
  const tResolve = Date.now();
  // All picks resolve concurrently (each pick: title search + parallel detail/trailer/watch)
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
      `[recs-resolve] ${short} row parallel_picks=${ordered.length} tmdb_au_ms=${resolveMs} ` +
        `resolved=${out.length}`
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
    console.log(
      `[prefetch] Starting taste extraction session=${sessionId} choices=${chosen.length} session_complete=true (mood_then_row_llm)`
    );
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
  rejected: Movie[],
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

  let picks = rowPicksFromRaw(rawFromPrefetch);
  let claudeProfileLine = String(rawFromPrefetch?.profile_line || "").trim();

  const tAu1 = Date.now();
  let recommendations = await resolvePicksToRecommendations(picks, chosen, {
    logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
  });

  if (recommendations.length < TARGET_TOTAL_RESOLVE) {
    const avoidList =
      picks.length > 0
        ? picks.map((p) => `"${p.title}" (${p.year ?? "?"})`).join(", ")
        : "";
    const retryExtra =
      picks.length > 0
        ? `CRITICAL — Second attempt: Fewer than 5 of your previous picks could be verified for streaming in Australia (wrong match, no AU watch links, missing poster, or duplicate director). Recommend exactly 5 DIFFERENT feature films with correct release years. Do not suggest any of these titles again: ${avoidList}. Each pick must be a distinct, well-known film.`
        : "CRITICAL — Second attempt: Return exactly 5 distinct film recommendations with a release year for each. The previous response did not yield enough verified picks.";
    logFinalize("claude_retry_underfilled", {
      resolved_first: recommendations.length,
      first_pick_count: picks.length,
    });
    const tRetry = Date.now();
    const rawRetry = await generateRowPicks(chosen, rejected, mood, retryExtra, timingSessionId);
    if (timingSessionId) {
      logRecsTiming(timingSessionId, "llm_claude_row_retry", Date.now() - tRetry);
    }
    if (!claudeProfileLine && String(rawRetry.profile_line || "").trim()) {
      claudeProfileLine = String(rawRetry.profile_line || "").trim();
    }
    const picks2 = rowPicksFromRaw(rawRetry);
    const extraIds = new Set(recommendations.map((r) => r.movie.tmdbId));
    const more = await resolvePicksToRecommendations(picks2, chosen, {
      logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
      extraExcludeTmdbIds: extraIds,
    });
    recommendations = mergeRecommendationsDeduped(recommendations, more);
  }

  if (recommendations.length < TARGET_TOTAL_RESOLVE) {
    const need = TARGET_TOTAL_RESOLVE - recommendations.length;
    const topGenre = taste.topGenres?.[0]?.trim() || extractTopGenres(chosen)[0];
    logFinalize("catalog_pad_start", { need, topGenre: topGenre ?? "" });
    const padded = await padRecommendationsFromHighRatedGenre(
      need,
      topGenre,
      chosen,
      recommendations,
      shortSid
    );
    recommendations = mergeRecommendationsDeduped(recommendations, padded);
  }

  if (recommendations.length < TARGET_TOTAL_RESOLVE) {
    logFinalize("fallback_row_fill", { have: recommendations.length });
    const fb = await fallbackRecommendations(chosen);
    recommendations = mergeRecommendationsDeduped(recommendations, fb.recommendations);
  }

  recommendations = recommendations.slice(0, TARGET_TOTAL_RESOLVE);

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

  return {
    recommendations,
    preferenceProfile: {
      topGenres: taste.topGenres || [],
      themes: taste.themes || [],
      preferredEras: taste.preferredEras || [],
      headline: taste.headline,
      profileLine: claudeProfileLine || undefined,
      patternSummary: taste.patternSummary || "",
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
      raw = await generateRowPicks(chosen, rejected, mood, "", sessionId);
      logRecsTiming(sessionId, "llm_row_cold_total", Date.now() - coldLlm);
    }

    const finalizeT0 = Date.now();
    const res = await finalizeRecommendationsToResponse(chosen, rejected, taste, raw, sessionId, mood);
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

async function tryFallbackMovieSlot(m: Movie): Promise<Recommendation | null> {
  try {
    const [trailerUrls, watch] = await Promise.all([
      getMovieTrailers(m.tmdbId),
      getWatchProviders(m.tmdbId, m.title, m.year),
    ]);
    if (trailerUrls.length === 0 || watch.providers.length === 0) return null;
    return {
      movie: { ...m, listSource: "ai-recommendation" },
      trailerUrl: trailerUrls[0] || null,
      trailerUrls,
      reason: "",
      auWatchAvailable: true,
    };
  } catch {
    return null;
  }
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

  const FALLBACK_BATCH = 12;
  const recs: Recommendation[] = [];
  for (let i = 0; i < pool.length && recs.length < TARGET_TOTAL_RESOLVE; i += FALLBACK_BATCH) {
    const chunk = pool.slice(i, i + FALLBACK_BATCH);
    const settled = await Promise.all(chunk.map((m) => tryFallbackMovieSlot(m)));
    for (const r of settled) {
      if (r && recs.length < TARGET_TOTAL_RESOLVE) recs.push(r);
    }
  }

  return {
    recommendations: recs.slice(0, TARGET_TOTAL_RESOLVE),
    preferenceProfile: {
      topGenres: taste.topGenres,
      themes: [],
      preferredEras: [],
      headline: taste.headline,
      patternSummary: taste.patternSummary || "",
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
