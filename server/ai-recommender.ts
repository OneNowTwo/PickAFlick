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
/** Hard-ban these many last-served title keys in the LLM prompt + filter. */
const RECENT_TITLE_BAN_WINDOW = 24;
/** Final row size (single list of picks). */
const TARGET_TOTAL_RESOLVE = 5;
const ANON_PRIMARY_GENRE_OVERUSE = 4;

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
    console.log(`[recent-recs] Loaded ${recentlyRecommendedTitles.length} prior picks from DB`);
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
    recentlyRecommendedFingerprints.push("");
    recentlyRecommendedDirectors.push(
      (m.director || "").toLowerCase().trim() || `__dir_${m.tmdbId}`
    );
    recentlyRecommendedDisplayTitles.push(m.title.trim() || tk);
    recentlyRecommendedFlavours.push("");
    recentlyRecommendedTones.push("");
    recentlyRecommendedPrestige.push("");
    recentlyRecommendedFeelKeys.push("");
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

interface RowLLMResult {
  profile_line: string;
  picks: AIRecommendationResult[];
}

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
  chosen: Movie[];
  rejected: Movie[];
  filters: string[];
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
  const banned = buildBannedContext(chosenMovies, rejectedMovies);
  return { mood, taste, banned, chosen: chosenMovies, rejected: rejectedMovies, filters };
}

function mergeRecentTitlesIntoBanned(merged: MergedBannedContext): MergedBannedContext {
  const bannedSet = new Set(merged.bannedSet);
  const extraDisplay: string[] = [];
  const len = recentlyRecommendedTitles.length;
  const sliceKeys = recentlyRecommendedTitles.slice(-RECENT_TITLE_BAN_WINDOW);
  const startIdx = len - sliceKeys.length;
  sliceKeys.forEach((k, j) => {
    if (!k || bannedSet.has(k)) return;
    bannedSet.add(k);
    const disp = (recentlyRecommendedDisplayTitles[startIdx + j] || k).trim();
    if (disp) extraDisplay.push(disp);
  });
  const line =
    extraDisplay.length > 0
      ? `Recently served on this product — do NOT output these titles (or close variants): ${extraDisplay.join("; ")}.`
      : "";
  const bannedTitlesPrompt = [merged.bannedTitlesPrompt, line].filter(Boolean).join(" ");
  return {
    bannedSet,
    bannedTitlesPrompt,
    anonDirectorKeys: new Set(merged.anonDirectorKeys),
    anonPrimaryGenreCounts: new Map(merged.anonPrimaryGenreCounts),
  };
}

async function startSingleRowLlmPrefetchIfNeeded(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[],
  phase1: PrefetchPhase1
): Promise<void> {
  const anonFp = anonFingerprint(clientAnonMemory);
  const key = rowPrefetchKey(sessionId, anonFp);
  if (singleRowLlmBySessionIdentity.has(key)) return;

  const merged = mergeRecentTitlesIntoBanned(mergeAnonymousIntoBanned(phase1.banned, clientAnonMemory));

  singleRowLlmBySessionIdentity.set(
    key,
    generateRowPicks(
      phase1.chosen,
      phase1.rejected,
      phase1.filters,
      phase1.mood,
      merged,
      "",
      sessionId
    )
  );
}

const FIVE_PICK_SYSTEM = `You are a sharp film curator. The user finished an A/B movie voting funnel — you see their mood JSON (tone, pacing, what they want / avoid).

Return exactly **5 films** as one row — same core mood for all 5, with **broad expression** across the row.

**Mix (no separate buckets in output):** Include both **accessible / well-known** picks (likely higher TMDb vote counts) and **less obvious / discovery** picks (likely lower vote counts but still strong quality ~7.0+). Roughly balance so the row is not all blockbusters and not all obscure — e.g. about 2–3 more familiar and 2–3 more surprising, still mood-true.

**Variation within the row:**
- Do not return 5 interchangeable films.
- Force different sub-types / expressions on-mood, e.g.: grounded thriller; psychological pressure; moral ambiguity; survival or physical tension; atmospheric slow-burn; political or institutional tension; sci-fi or speculative edge when it fits.
- If two picks feel too similar in tone, pacing, or sub-type, replace one.
- Do not let all five cluster as the same prestige-crime/thriller OR the same arthouse/slow-burn — spread the shelf.
- Do not drift away from the A/B funnel mood.

**Hard rules for the 5:**
- Span at least 2 different decades.
- No two films from the same director.
- No two films of the same narrow sub-genre.
- Do NOT output any title from the banned list (or close variants).

Output JSON ONLY. Title and year per film only — no per-film prose.`;

const REFILL_ROW_SYSTEM = `You are filling ONLY missing slots in a 5-film recommendation row. Output JSON only — title and year per film. Same mood as taste_profile. Output exactly the number of films requested — no more, no fewer. Do not repeat banned or already-shown titles. Each pick must differ in expression from the others. Stay on-mood from the funnel.`;

function buildFivePickUserMessage(
  tasteProfileJson: string,
  bannedBlock: string,
  genreLine: string,
  promptExtra: string
): string {
  return `taste_profile (JSON — source of truth for tonight's mood):
${tasteProfileJson}

${genreLine}

DO NOT OUTPUT ANY OF THESE TITLES OR CLOSE VARIANTS:
${bannedBlock}

Return exactly **5** films as specified in the system message.

Output JSON only, this exact shape:
{
  "profile_line": "max 8 words, like a friend texting — not marketing, not 'based on your taste'",
  "picks": [
    {"title": "", "year": 2020},
    {"title": "", "year": 2000},
    {"title": "", "year": 0},
    {"title": "", "year": 0},
    {"title": "", "year": 0}
  ]
}

Rules: exactly 5 entries in picks; real released films only; title and year fields only.
${promptExtra.trim() ? `\n\nAdditional instruction:\n${promptExtra.trim()}` : ""}`;
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

function parseRowResponse(raw: Record<string, unknown>): RowLLMResult {
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
  initialGenreFilters: string[],
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  promptExtra: string,
  timingSessionId?: string
): Promise<RowLLMResult> {
  await ensureRecsLoaded();
  const tasteProfileJson = JSON.stringify(mood);
  const genreLine =
    initialGenreFilters.length > 0
      ? `Optional genre hints from the session: ${initialGenreFilters.join(", ")}.`
      : "";
  const user = buildFivePickUserMessage(tasteProfileJson, bannedCtx.bannedTitlesPrompt, genreLine, promptExtra);

  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: FIVE_PICK_SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 900,
    temperature: 0.88,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, "llm_five_pick_row", Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  return parseRowResponse(raw);
}

function parseRefillRowResponse(raw: Record<string, unknown>, need: number): AIRecommendationResult[] {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const out: AIRecommendationResult[] = [];
  for (let i = 0; i < picksIn.length && out.length < need; i++) {
    const p = parseTitleYearRow(picksIn[i] as Record<string, unknown>);
    if (p) out.push(p);
  }
  return out;
}

async function generateRefillRowPicks(
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  initialGenreFilters: string[],
  needCount: number,
  alreadyShownTitles: string[],
  timingSessionId?: string
): Promise<AIRecommendationResult[]> {
  if (needCount <= 0) return [];
  await ensureRecsLoaded();
  const tasteProfileJson = JSON.stringify(mood);
  const genreLine =
    initialGenreFilters.length > 0
      ? `Optional genre hints from the session: ${initialGenreFilters.join(", ")}.`
      : "";
  const shownLine =
    alreadyShownTitles.length > 0
      ? `Already placed in the row (do NOT repeat): ${alreadyShownTitles.slice(0, 40).join("; ")}.`
      : "";
  const user = `taste_profile (JSON):
${tasteProfileJson}

${genreLine}

DO NOT OUTPUT ANY OF THESE TITLES OR CLOSE VARIANTS:
${bannedCtx.bannedTitlesPrompt}

${shownLine}

Output exactly ${needCount} new film(s) for the same 5-film row. Mix accessible and less-known titles like the main curator; vary expression; stay on-mood.

JSON only:
{
  "picks": [{"title":"","year":2020}]
}
The picks array must have exactly ${needCount} entries.`;

  const t0 = Date.now();
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: REFILL_ROW_SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
    temperature: 0.9,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, "llm_row_refill", Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  return parseRefillRowResponse(raw, needCount);
}

function appendTitlesFromRecommendationsToBanned(mb: MergedBannedContext, recs: Recommendation[]): void {
  for (const r of recs) {
    const raw = r.movie.title?.trim();
    if (!raw) continue;
    const k = normalizeTitleKey(raw);
    if (!k || mb.bannedSet.has(k)) continue;
    mb.bannedSet.add(k);
    mb.bannedTitlesPrompt = mb.bannedTitlesPrompt
      ? `${mb.bannedTitlesPrompt}; ${raw}`
      : raw;
  }
}

function mergeRefillResolvedIntoRow(base: Recommendation[], refillResolved: Recommendation[]): Recommendation[] {
  const out = [...base];
  const seenT = new Set(out.map((r) => normalizeTitleKey(r.movie.title)));
  const seenD = new Set(out.map((r) => directorKeyForMovie(r.movie)));
  for (const r of refillResolved) {
    if (out.length >= TARGET_TOTAL_RESOLVE) break;
    const tk = normalizeTitleKey(r.movie.title);
    const dk = directorKeyForMovie(r.movie);
    if (seenT.has(tk) || seenD.has(dk)) continue;
    out.push(r);
    seenT.add(tk);
    seenD.add(dk);
  }
  return out;
}

function orderRecommendationRow(recs: Recommendation[]): Recommendation[] {
  return recs.slice(0, TARGET_TOTAL_RESOLVE);
}

async function padRowFromCatalogue(
  chosen: Movie[],
  _mergedBanned: MergedBannedContext | null,
  recs: Recommendation[]
): Promise<Recommendation[]> {
  let out = orderRecommendationRow(recs);
  if (out.length >= TARGET_TOTAL_RESOLVE) {
    return out;
  }

  const excludeTmdb = new Set(chosen.map((c) => c.tmdbId));
  const seenTitle = new Set<string>();
  const seenDir = new Set<string>();
  for (const r of out) {
    excludeTmdb.add(r.movie.tmdbId);
    seenTitle.add(normalizeTitleKey(r.movie.title));
    seenDir.add(directorKeyForMovie(r.movie));
  }

  const pool = shuffleArray(
    getAllMovies().filter(
      (m) =>
        !excludeTmdb.has(m.tmdbId) &&
        m.posterPath?.trim() &&
        m.year &&
        m.rating &&
        m.rating >= 6.5
    )
  );

  for (const m of pool) {
    if (out.length >= TARGET_TOTAL_RESOLVE) break;
    const tk = normalizeTitleKey(m.title);
    const dk = directorKeyForMovie(m);
    if (seenTitle.has(tk) || seenDir.has(dk)) continue;

    try {
      const [details, trailerUrls, watchResult] = await Promise.all([
        getMovieDetails(m.tmdbId),
        getMovieTrailers(m.tmdbId).catch(() => [] as string[]),
        getWatchProviders(m.tmdbId, m.title, m.year ?? null),
      ]);
      if (!details?.posterPath?.trim() || watchResult.providers.length === 0) continue;

      details.listSource = "catalogue-pad";
      const urls = Array.isArray(trailerUrls) ? trailerUrls : [];
      out.push({
        movie: details,
        trailerUrl: urls[0] ?? null,
        trailerUrls: urls,
        reason: "",
        auWatchAvailable: true,
      });
      excludeTmdb.add(m.tmdbId);
      seenTitle.add(tk);
      seenDir.add(dk);
    } catch {
      /* skip */
    }
  }

  return orderRecommendationRow(out);
}

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

  const bannedTitlesPrompt = labels.join("; ");
  return { bannedSet, bannedTitlesPrompt };
}

interface MergedBannedContext {
  bannedSet: Set<string>;
  bannedTitlesPrompt: string;
  anonDirectorKeys: Set<string>;
  anonPrimaryGenreCounts: Map<string, number>;
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
      `Browser memory — do not use these directors: ${Array.from(anonDirectorKeys).slice(0, 25).join("; ")}.`,
  ].filter(Boolean) as string[];

  const bannedTitlesPrompt = [base.bannedTitlesPrompt, ...memoryLines].filter(Boolean).join(" ");

  return { bannedSet, bannedTitlesPrompt, anonDirectorKeys, anonPrimaryGenreCounts };
}

function cloneMergedBanned(m: MergedBannedContext): MergedBannedContext {
  return {
    bannedSet: new Set(m.bannedSet),
    bannedTitlesPrompt: m.bannedTitlesPrompt,
    anonDirectorKeys: new Set(m.anonDirectorKeys),
    anonPrimaryGenreCounts: new Map(m.anonPrimaryGenreCounts),
  };
}

function movieFailsAnonDiversity(movie: Movie, mb: MergedBannedContext): boolean {
  const d = (movie.director || "").toLowerCase().trim();
  if (d && mb.anonDirectorKeys.has(d)) return true;
  const p = (movie.genres[0] || "").trim().toLowerCase();
  if (p && (mb.anonPrimaryGenreCounts.get(p) ?? 0) >= ANON_PRIMARY_GENRE_OVERUSE) return true;
  return false;
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
  excludeTmdbIds: Set<number>,
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

    if (mergedBanned && movieFailsAnonDiversity(movieDetails, mergedBanned)) return null;

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

async function resolvePicksToRecommendations(
  picks: AIRecommendationResult[],
  chosenMovies: Movie[],
  mergedBanned: MergedBannedContext | null,
  opts: { logCluster?: { sessionId: string } } = {}
): Promise<Recommendation[]> {
  const excludeTmdb = new Set(chosenMovies.map((m) => m.tmdbId));

  const ordered = picks.slice(0, TARGET_TOTAL_RESOLVE);
  const tResolve = Date.now();
  const settled = await Promise.all(
    ordered.map((r) => resolveOneRecommendation(r, excludeTmdb, mergedBanned))
  );
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
  banned: MergedBannedContext,
  taste: TasteObservationResult,
  rawFromPrefetch: RowLLMResult | null,
  timingSessionId: string | undefined,
  mood: SessionMoodProfile,
  filters: string[]
): Promise<RecommendationsResponse> {
  const finalizeStart = Date.now();
  const sid = timingSessionId;
  const shortSid = sid && sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;

  const logFinalize = (msg: string, detail?: Record<string, number | string | boolean>) => {
    if (!sid) return;
    const tail = detail ? ` ${JSON.stringify(detail)}` : "";
    console.log(`[recs-finalize] ${shortSid} row ${msg}${tail}`);
  };

  const workingBanned = cloneMergedBanned(banned);
  const picks = rowPicksFromRaw(rawFromPrefetch);
  const rowCopy = rawFromPrefetch;

  const tAu1 = Date.now();
  let recommendations = await resolvePicksToRecommendations(picks, chosen, workingBanned, {
    logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
  });
  let auResolveMs = Date.now() - tAu1;
  logFinalize("au_resolve_pass1_ms", {
    ms: auResolveMs,
    pick_pool: picks.length,
    resolved: recommendations.length,
  });

  appendTitlesFromRecommendationsToBanned(workingBanned, recommendations);

  const need = Math.max(0, TARGET_TOTAL_RESOLVE - recommendations.length);

  if (need > 0) {
    const shownTitles = recommendations.map((r) => r.movie.title.trim()).filter(Boolean);
    const tRefill = Date.now();
    const refillPicks = await generateRefillRowPicks(
      mood,
      workingBanned,
      filters,
      need,
      shownTitles,
      timingSessionId
    );
    logFinalize("refill_llm_ms", { ms: Date.now() - tRefill, need, refill_pool: refillPicks.length });

    const tAuRefill = Date.now();
    const refillResolved = await resolvePicksToRecommendations(refillPicks, chosen, workingBanned, {
      logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
    });
    auResolveMs += Date.now() - tAuRefill;
    recommendations = mergeRefillResolvedIntoRow(recommendations, refillResolved);
    appendTitlesFromRecommendationsToBanned(workingBanned, recommendations);
    logFinalize("after_refill_merge", {
      resolved: recommendations.length,
      refill_resolved: refillResolved.length,
    });
  }

  const tPad = Date.now();
  recommendations = await padRowFromCatalogue(chosen, workingBanned, recommendations);
  logFinalize("catalogue_pad_ms", {
    ms: Date.now() - tPad,
    total: recommendations.length,
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
    let bannedMerged: MergedBannedContext;

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
      bannedMerged = mergeRecentTitlesIntoBanned(mergeAnonymousIntoBanned(phase1.banned, clientAnonMemory));

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
      bannedMerged = mergeRecentTitlesIntoBanned(
        mergeAnonymousIntoBanned(buildBannedContext(chosen, rejected), clientAnonMemory)
      );
      patchSessionTasteMeta(sessionId, { mood, taste });
      const coldLlm = Date.now();
      raw = await generateRowPicks(chosen, rejected, filters, mood, bannedMerged, "", sessionId);
      logRecsTiming(sessionId, "llm_row_cold_total", Date.now() - coldLlm);
    }

    const finalizeT0 = Date.now();
    const res = await finalizeRecommendationsToResponse(
      chosen,
      bannedMerged,
      taste,
      raw,
      sessionId,
      mood,
      filters
    );
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
  clientAnonMemory: AnonymousRecMemoryEntry[] = []
): Promise<Recommendation | null> {
  const picks = chosenMovies.map((m, i) => `R${i + 1}: "${m.title}" (${m.year}) — ${m.director || "?"}`).join("\n");
  const rejHints =
    rejectedMovies.length > 0
      ? `\nPASSED ON: ${rejectedMovies.slice(0, 3).map((m) => `"${m.title}"`).join(", ")}`
      : "";
  const memoryHint =
    clientAnonMemory.length > 0
      ? `\nBrowser memory — do NOT repeat these titles: ${clientAnonMemory
          .slice(-20)
          .map((e) => e.title.trim())
          .join("; ")}.`
      : "";

  const baseUser = `One replacement pick for this user's row. Infer taste from the whole A/B funnel — do not mirror one funnel title to one pick.

${picks}${rejHints}${memoryHint}

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
        model: RECOMMENDATIONS_MODEL,
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
