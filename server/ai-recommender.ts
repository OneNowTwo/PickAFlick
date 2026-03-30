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
const TARGET_RESOLVED = 5;
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

interface SingleTrackLLMResult {
  picks: AIRecommendationResult[];
  line_what_they_want?: string;
  line_what_they_avoid?: string;
  line_cinema_suggested?: string;
  line_trap_avoided?: string;
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
const singleRowLlmBySessionIdentity = new Map<string, Promise<SingleTrackLLMResult>>();

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
  const extra: string[] = [];
  const slice = recentlyRecommendedTitles.slice(-RECENT_TITLE_BAN_WINDOW);
  slice.forEach((k) => {
    if (k && !bannedSet.has(k)) {
      bannedSet.add(k);
      extra.push(k);
    }
  });
  const line =
    extra.length > 0
      ? `Recently served on this product — do NOT output these titles (or close variants): ${extra.join("; ")}.`
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
    generateSingleRowPicks(
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

const SINGLE_ROW_SYSTEM = `You are a sharp film curator. The user finished an A/B movie voting funnel — you see their mood JSON (tone, pacing, what they want / avoid).

Return exactly ONE row of 5 films that:
- Strongly match that mood (every title must clearly fit the emotional signal — do not drift).
- Feel curated and varied, not algorithmic: five different *expressions* of the same core mood (e.g. different sub-genres, pacing, geography, budget level, era mix).
- Mix accessible and less obvious naturally: at least 2 picks should feel like discovery (less obvious), at least 1 clearly accessible/well-known enough to recommend with confidence; the others balance between.
- Do NOT optimise for popularity, safety, or “pleasing” with famous defaults. Interesting, high-quality, mood-true beats fame.
- Avoid obvious over-recommended / default-canon titles unless they are clearly the best mood fit; if a pick feels predictable, replace it.
- No repeated directors across the 5 unless unavoidable.
- Do not output five interchangeable films (same pacing, same “type”, same shelf).
- If the set could have been drawn from the same 20 famous films, it is wrong — internally revise before answering.

Ban list and “recently shown” titles in the user message are hard exclusions.

Each film must be plausibly streamable, rentable, or purchasable in Australia.

Output JSON ONLY. No per-film prose or reasons — only title and year per pick.`;

function buildFivePickUserMessage(
  tasteProfileJson: string,
  bannedTitlesPrompt: string,
  genreLine: string,
  promptExtra: string
): string {
  return `taste_profile (JSON — source of truth for tonight's mood):
${tasteProfileJson}

${genreLine}

Titles you must NOT output (or close variants):
${bannedTitlesPrompt}

Fill these 5 slots — each a different EXPRESSION of the same mood (not five of the same kind of film):

1. Grounded / procedural / crime or espionage-leaning (if mood allows; otherwise closest grounded thriller/drama fit)
2. Psychological pressure or interior tension
3. Slower or more atmospheric — still same mood, different pacing
4. International or less obvious (non-English welcome if it fits)
5. Wildcard — bold or surprising but still emotionally on-mood

Output JSON only, this exact shape:
{
  "line_summary": "one short curatorial line for the row (not per-film)",
  "picks": [
    {"slot": 1, "title": "", "year": 2020},
    {"slot": 2, "title": "", "year": null},
    {"slot": 3, "title": "", "year": null},
    {"slot": 4, "title": "", "year": null},
    {"slot": 5, "title": "", "year": null}
  ]
}

Rules: exactly 5 picks, slots 1–5, one director per film, real released films only. Pick fields are title and year only — no reasons.
${promptExtra.trim() ? `\n\nAdditional instruction:\n${promptExtra.trim()}` : ""}`;
}

function parseFivePickResponse(raw: Record<string, unknown>): SingleTrackLLMResult {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const picks: AIRecommendationResult[] = picksIn
    .map((p: unknown) => {
      const o = p as Record<string, unknown>;
      const slot = typeof o.slot === "number" ? o.slot : parseInt(String(o.slot || ""), 10);
      const title = String(o.title || "").trim();
      const idx = Number.isFinite(slot) && slot >= 1 && slot <= TARGET_RESOLVED ? slot - 1 : -1;
      return {
        title,
        year: parseYearField(o.year),
        reason: "",
        tag: idx >= 0 ? `Slot ${slot}` : undefined,
      };
    })
    .filter((p) => p.title);

  picks.sort((a, b) => {
    const sa = parseInt(String(a.tag?.replace(/\D/g, "") || "99"), 10);
    const sb = parseInt(String(b.tag?.replace(/\D/g, "") || "99"), 10);
    return sa - sb;
  });

  const summary = String(raw.line_summary || "").trim();
  return {
    picks,
    line_what_they_want: summary,
    line_what_they_avoid: "",
  };
}

async function generateSingleRowPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  promptExtra: string,
  timingSessionId?: string
): Promise<SingleTrackLLMResult> {
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
      { role: "system", content: SINGLE_ROW_SYSTEM },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1400,
    temperature: 0.88,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, "llm_single_row", Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  const parsed = parseFivePickResponse(raw);
  return {
    ...parsed,
    picks: filterPicksAgainstBanned(parsed.picks || [], bannedCtx.bannedSet).slice(0, TARGET_RESOLVED),
  };
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

  const bannedTitlesPrompt = labels.slice(0, 120).join("; ");
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

function filterPicksAgainstBanned(
  picks: AIRecommendationResult[],
  bannedSet: Set<string>
): AIRecommendationResult[] {
  return picks.filter((p) => p.title && !bannedSet.has(normalizeTitleKey(p.title)));
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

  const ordered = picks.slice(0, TARGET_RESOLVED);
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
    if (out.length >= TARGET_RESOLVED) break;
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

async function finalizeRecommendationsToResponse(
  chosen: Movie[],
  rejected: Movie[],
  filters: string[],
  mood: SessionMoodProfile,
  banned: MergedBannedContext,
  taste: TasteObservationResult,
  rawFromPrefetch: SingleTrackLLMResult | null,
  timingSessionId: string | undefined
): Promise<RecommendationsResponse> {
  const finalizeStart = Date.now();
  const sid = timingSessionId;
  const shortSid = sid && sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;

  const logFinalize = (msg: string, detail?: Record<string, number | string | boolean>) => {
    if (!sid) return;
    const tail = detail ? ` ${JSON.stringify(detail)}` : "";
    console.log(`[recs-finalize] ${shortSid} row ${msg}${tail}`);
  };

  let auResolvePass1Ms = 0;
  let regenLlmMs = 0;
  let auResolvePass2Ms = 0;
  let regenUsed = false;

  const workingBanned = cloneMergedBanned(banned);
  let picks = filterPicksAgainstBanned(rawFromPrefetch?.picks || [], workingBanned.bannedSet);
  let rowCopy: SingleTrackLLMResult | null = rawFromPrefetch;

  const tAu1 = Date.now();
  let recommendations = await resolvePicksToRecommendations(picks, chosen, workingBanned, {
    logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
  });
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
    });
    for (const p of picks) {
      const k = normalizeTitleKey(p.title);
      if (k) workingBanned.bannedSet.add(k);
    }
    const regenExtra =
      "Prior output had too few titles that resolve with Australian streaming/rental/purchase options. Regenerate a full fresh set of 5 mood-varied picks (same slot rules). " +
      "Every title must be AU-available.";

    const tRegen = Date.now();
    const raw = await generateSingleRowPicks(chosen, rejected, filters, mood, workingBanned, regenExtra, timingSessionId);
    regenLlmMs = Date.now() - tRegen;
    picks = filterPicksAgainstBanned(raw.picks || [], workingBanned.bannedSet);
    rowCopy = raw;

    const tAu2 = Date.now();
    recommendations = await resolvePicksToRecommendations(picks, chosen, workingBanned, {
      logCluster: timingSessionId ? { sessionId: timingSessionId } : undefined,
    });
    auResolvePass2Ms = Date.now() - tAu2;
    logFinalize("au_resolve_pass2_ms", {
      ms: auResolvePass2Ms,
      pick_pool: picks.length,
      resolved: recommendations.length,
    });

    if (recommendations.length < TARGET_RESOLVED) {
      console.warn(
        `[recs-finalize] ${shortSid ?? "?"} HARD_FAILURE insufficient_resolved after_single_regen ` +
          `resolved=${recommendations.length} target=${TARGET_RESOLVED}`
      );
    }
  }

  const totalFinalizeMs = Date.now() - finalizeStart;
  if (sid) {
    console.log(
      `[recs-finalize] ${shortSid} SUMMARY ` +
        `total_finalize_ms=${totalFinalizeMs} ` +
        `au_resolve_pass1_ms=${auResolvePass1Ms} ` +
        `regen_used=${regenUsed} ` +
        `regen_llm_ms=${regenLlmMs} ` +
        `au_resolve_pass2_ms=${auResolvePass2Ms} ` +
        `final_resolved_count=${recommendations.length}`
    );
  }

  const patternLine = [rowCopy?.line_what_they_want, rowCopy?.line_what_they_avoid].filter(Boolean).join(" ");

  return {
    recommendations,
    preferenceProfile: {
      topGenres: taste.topGenres || [],
      themes: taste.themes || [],
      preferredEras: taste.preferredEras || [],
      headline: taste.headline,
      patternSummary: patternLine.trim() || taste.patternSummary,
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
    let raw: SingleTrackLLMResult | null = null;
    let bannedMerged: MergedBannedContext;

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
        console.error("[prefetch] single row LLM failed", e);
        return { picks: [] as AIRecommendationResult[] };
      });
      logRecsTiming(sessionId, "llm_raw_wait_row", Date.now() - rowWait);

      raw = {
        ...raw,
        picks: filterPicksAgainstBanned(raw.picks || [], bannedMerged.bannedSet),
      };
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
      raw = await generateSingleRowPicks(chosen, rejected, filters, mood, bannedMerged, "", sessionId);
      logRecsTiming(sessionId, "llm_row_cold_total", Date.now() - coldLlm);
    }

    const finalizeT0 = Date.now();
    const res = await finalizeRecommendationsToResponse(
      chosen,
      rejected,
      filters,
      mood,
      bannedMerged,
      taste,
      raw,
      sessionId
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
    if (recs.length >= TARGET_RESOLVED) break;
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
