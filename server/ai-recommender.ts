import OpenAI from "openai";
import type {
  Movie,
  Recommendation,
  RecommendationsResponse,
  RecommendationTrack,
} from "@shared/schema";
import { searchMovieByTitle, getMovieTrailers, getMovieDetails } from "./tmdb";
import { getAllMovies } from "./catalogue";
import { storage } from "./storage";
import { sessionStorage as gameSessionStorage } from "./session-storage";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  maxRetries: 1,
});

const RECOMMENDATIONS_MODEL = process.env.OPENAI_RECOMMENDATIONS_MODEL ?? "gpt-4o";

const recentlyRecommendedTitles: string[] = [];
const MAX_RECENT_TRACKED = 400;
const RECENT_EXCLUSIONS_PROMPT_COUNT = 64;
const TARGET_RESOLVED = 6;
const LLM_PICK_COUNT = 8;
const MAX_PRE_1970 = 1;
const MIN_PICKS_YEAR_LEQ_2010 = 2;

let recsLoaded = false;

async function ensureRecsLoaded(): Promise<void> {
  if (recsLoaded) return;
  recsLoaded = true;
  try {
    const saved = await storage.getRecentRecommendations();
    const merged = Array.from(new Set(saved.map(normalizeTitleKey)));
    recentlyRecommendedTitles.push(...merged);
    console.log(`[recent-recs] Loaded ${merged.length} previously recommended titles from DB`);
  } catch { /* non-fatal */ }
}

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

export interface TasteObservationResult {
  headline: string;
  patternSummary: string;
  topGenres: string[];
  themes: string[];
  preferredEras: string[];
}

/** Structured mood from A/B session — source of truth for recommendation prompts. */
export interface SessionMoodProfile {
  preferred_tone: string;
  rejected_tone: string;
  pacing: string;
  darkness_level: string;
  realism_vs_stylised: string;
  complexity: string;
  emotional_texture: string;
  what_they_want: string[];
  what_they_avoid: string[];
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

interface PrefetchEntry {
  taste: Promise<TasteObservationResult>;
  mood: SessionMoodProfile;
  banned: { bannedSet: Set<string>; bannedTitlesPrompt: string };
  mainstream: Promise<SingleTrackLLMResult>;
  indie: Promise<SingleTrackLLMResult>;
}

const prefetchBySession = new Map<string, Promise<PrefetchEntry>>();

/** Per-session cache: each lane stores a full response; lane switch must be cache-only. */
interface SessionLaneCacheEntry {
  taste?: TasteObservationResult;
  mood?: SessionMoodProfile;
  mainstream?: RecommendationsResponse;
  indie?: RecommendationsResponse;
}

const sessionLaneCache = new Map<string, SessionLaneCacheEntry>();
const laneInflight = new Map<string, Promise<RecommendationsResponse>>();

function laneInflightKey(sessionId: string, track: RecommendationTrack): string {
  return `${sessionId}:${track}`;
}

function logRecsTiming(sessionId: string, phase: string, ms: number): void {
  const id = sessionId.length > 16 ? `${sessionId.slice(0, 8)}…` : sessionId;
  console.log(`[recs-timing] ${id} ${phase}=${ms}ms`);
}

function patchSessionLaneMeta(sessionId: string, partial: Partial<SessionLaneCacheEntry>): void {
  const cur = sessionLaneCache.get(sessionId) ?? {};
  sessionLaneCache.set(sessionId, { ...cur, ...partial });
}

function mergeLaneIntoCache(
  sessionId: string,
  track: RecommendationTrack,
  res: RecommendationsResponse
): void {
  const cur = sessionLaneCache.get(sessionId) ?? {};
  cur[track] = res;
  sessionLaneCache.set(sessionId, cur);
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
  for (const k of recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT)) {
    if (!bannedSet.has(k)) {
      bannedSet.add(k);
      labels.push(k);
    }
  }

  const bannedTitlesPrompt = labels.slice(0, 100).join("; ");
  return { bannedSet, bannedTitlesPrompt };
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

const REC_TRACK_IMPL_NOTES = `Implementation (obey):
- Mood JSON was extracted in a prior step; it is taste_profile.
- banned_titles includes funnel films, rejected films, a static overused list, and recent-session recommendations — never output them.
- No duplicate directors across picks; diversify era, country, and style.
- Exactly ${LLM_PICK_COUNT} objects in "picks" (buffer for lookup; product shows 6).`;

function buildMainstreamTrackPrompt(tasteProfileJson: string, bannedTitles: string): string {
  return `You are a film-obsessed recommender.

You are generating MAINSTREAM picks for THIS specific session only.

Inputs:
- taste_profile (JSON, source of truth):
${tasteProfileJson}

- banned_titles:
${bannedTitles}

Definition of MAINSTREAM:
- accessible, highly watchable tonight, broadly satisfying, easy-entry films
- still tailored to taste_profile

Critical rules:
- Do NOT default to overused prestige titles
- Avoid banned_titles completely (including close variants)
- taste_profile is authoritative — reflect BOTH what_they_want AND what_they_avoid
- No repeated directors
- Do not cluster all picks into the same vibe
- At least 3 picks should feel less overexposed than typical "top 100" movies
- Favour films realistically available to stream in Australia
- Decades: at least ${MIN_PICKS_YEAR_LEQ_2010} picks with year ≤ 2010; at most ${MAX_PRE_1970} with year < 1970

${REC_TRACK_IMPL_NOTES}

Output JSON only:
{
  "line_what_they_want": "one short sentence: mood they want tonight",
  "line_what_they_avoid": "one short sentence: what they are avoiding",
  "picks": [{"title":"","year":2020,"reason":"short, tied to taste_profile"}]
}`;
}

function buildIndieTrackPrompt(tasteProfileJson: string, bannedTitles: string): string {
  return `You are a serious movie buff creating a LEFT-FIELD recommendation row for THIS session only.

Inputs:
- taste_profile (JSON, source of truth):
${tasteProfileJson}

- banned_titles:
${bannedTitles}

Definition of INDIE / LEFT-FIELD:
- less obvious, under-seen or under-recommended
- festival / auteur / cult / arthouse / singular films
- NOT just foreign (English-language indie is fine)

Critical rules:
- Do NOT default to prestige-canon films
- Avoid banned_titles completely
- taste_profile is authoritative
- At least 4 of ${LLM_PICK_COUNT} picks must be meaningfully less mainstream than typical blockbusters
- No more than 2 widely obvious / household-name films
- No repeated directors
- Prioritise originality over safety; picks must still be enjoyable, not obscure for its own sake
- Each pick includes "tag" (e.g. "bleak crime", "festival sci-fi", "surreal drama")
- Decades: at least ${MIN_PICKS_YEAR_LEQ_2010} picks with year ≤ 2010; at most ${MAX_PRE_1970} with year < 1970

${REC_TRACK_IMPL_NOTES}

Output JSON only:
{
  "line_cinema_suggested": "one short sentence: what kind of cinema this session suggests",
  "line_trap_avoided": "one short sentence: obvious recommendation trap you avoided",
  "picks": [{"title":"","year":2020,"reason":"short, tied to taste_profile","tag":""}]
}`;
}

function parseMainstreamTrackResponse(raw: Record<string, unknown>): SingleTrackLLMResult {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const picks: AIRecommendationResult[] = picksIn
    .map((p: unknown) => {
      const o = p as Record<string, unknown>;
      return {
        title: String(o.title || "").trim(),
        year: parseYearField(o.year),
        reason: String(o.reason || "").trim(),
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
    return "PickAFlick MAINSTREAM. JSON only. Accessible picks; obey taste_profile and banned_titles; no director repeats.";
  }
  return "PickAFlick INDIE / left-field. JSON only. Under-seen and distinctive; obey taste_profile and banned_titles; include tags on picks.";
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
    max_tokens: 1800,
    temperature: track === "indie" ? 0.95 : 0.84,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, `llm_${track}`, Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  return track === "mainstream" ? parseMainstreamTrackResponse(raw) : parseIndieTrackResponse(raw);
}

export async function generateSingleTrackPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  track: RecommendationTrack,
  mood: SessionMoodProfile,
  bannedCtx: { bannedSet: Set<string>; bannedTitlesPrompt: string },
  promptExtra = "",
  timingSessionId?: string
): Promise<SingleTrackLLMResult> {
  await ensureRecsLoaded();
  const tasteProfileJson = JSON.stringify(mood);
  const basePrompt =
    track === "mainstream"
      ? buildMainstreamTrackPrompt(tasteProfileJson, bannedCtx.bannedTitlesPrompt)
      : buildIndieTrackPrompt(tasteProfileJson, bannedCtx.bannedTitlesPrompt);
  const genreLine =
    initialGenreFilters.length > 0
      ? `\n\nOptional genre hints: ${initialGenreFilters.join(", ")}.`
      : "";
  const extra = promptExtra.trim() ? `\n\n${promptExtra.trim()}` : "";
  const prompt = basePrompt + genreLine + extra;

  const applyBanned = (r: SingleTrackLLMResult): SingleTrackLLMResult => ({
    ...r,
    picks: filterPicksAgainstBanned(r.picks || [], bannedCtx.bannedSet),
  });

  let result = applyBanned(await callSingleTrackLLM(prompt, track, timingSessionId));
  let picks = result.picks;

  if (picks.length < 6) {
    if (timingSessionId) {
      logRecsTiming(timingSessionId, `regen_${track}_insufficient_picks`, 0);
    }
    result = applyBanned(
      await callSingleTrackLLM(
        `${prompt}\n\nRegenerate: complete JSON with ${LLM_PICK_COUNT} picks; all required fields.`,
        track,
        timingSessionId
      )
    );
    picks = result.picks;
  }

  return result;
}

async function resolveOneRecommendation(
  rec: AIRecommendationResult,
  chosenTmdbIds: Set<number>,
  pickedAs: RecommendationTrack
): Promise<Recommendation | null> {
  try {
    const searchResult = await searchMovieByTitle(rec.title, rec.year);
    if (!searchResult || chosenTmdbIds.has(searchResult.id)) return null;

    const [movieDetails, tmdbTrailers] = await Promise.all([
      getMovieDetails(searchResult.id),
      getMovieTrailers(searchResult.id).catch(() => [] as string[]),
    ]);

    if (!movieDetails) return null;
    if (!movieDetails.posterPath?.trim()) return null;

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
    };
  } catch {
    return null;
  }
}

async function resolvePicksToRecommendations(
  picks: AIRecommendationResult[],
  chosenMovies: Movie[],
  track: RecommendationTrack
): Promise<Recommendation[]> {
  const chosenTmdbIds = new Set(chosenMovies.map((m) => m.tmdbId));
  const seenTitles = new Set<string>();
  const seenDirectors = new Set<string>();
  const settled = await Promise.all(
    picks.slice(0, LLM_PICK_COUNT).map((r) => resolveOneRecommendation(r, chosenTmdbIds, track))
  );
  const out: Recommendation[] = [];
  for (const r of settled) {
    if (!r || out.length >= TARGET_RESOLVED) continue;
    const k = normalizeTitleKey(r.movie.title);
    if (seenTitles.has(k)) continue;
    const dk = directorKeyForMovie(r.movie);
    if (seenDirectors.has(dk)) continue;
    seenTitles.add(k);
    seenDirectors.add(dk);
    out.push(r);
  }
  return out;
}

/** Mood extraction first, then both track LLM calls in parallel (no TMDB until a lane is finalized). */
async function buildPrefetchEntry(
  sessionId: string,
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  filters: string[]
): Promise<PrefetchEntry> {
  const tMood = Date.now();
  const mood = await extractSessionMood(chosenMovies, rejectedMovies, filters);
  logRecsTiming(sessionId, "taste_extraction", Date.now() - tMood);
  const taste = moodToTasteObservation(mood, chosenMovies);
  const banned = buildBannedContext(chosenMovies, rejectedMovies);
  return {
    taste: Promise.resolve(taste),
    mood,
    banned,
    mainstream: generateSingleTrackPicks(
      chosenMovies,
      rejectedMovies,
      filters,
      "mainstream",
      mood,
      banned,
      "",
      sessionId
    ),
    indie: generateSingleTrackPicks(
      chosenMovies,
      rejectedMovies,
      filters,
      "indie",
      mood,
      banned,
      "",
      sessionId
    ),
  };
}

/** Fire when the last A/B choice is recorded — starts taste + parallel lane LLM prefetch only (no blocking TMDB bundle). */
export function beginRecommendationPrefetch(sessionId: string): void {
  const session = gameSessionStorage.getSession(sessionId);
  if (!session?.isComplete) return;
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) return;

  if (!prefetchBySession.has(sessionId)) {
    console.log(`[prefetch] Starting taste + mainstream + indie LLM for ${sessionId}`);
    prefetchBySession.set(sessionId, buildPrefetchEntry(sessionId, chosen, rejected, filters));
  }
}

export async function getTastePreviewForSession(sessionId: string): Promise<TasteObservationResult> {
  const cachedTaste = sessionLaneCache.get(sessionId)?.taste;
  if (cachedTaste) return cachedTaste;

  let entryPromise = prefetchBySession.get(sessionId);
  if (!entryPromise) {
    const session = gameSessionStorage.getSession(sessionId);
    if (!session?.isComplete) return fallbackTaste([]);
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    const rejected = gameSessionStorage.getRejectedMovies(sessionId);
    const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
    if (chosen.length === 0) return fallbackTaste([]);
    entryPromise = buildPrefetchEntry(sessionId, chosen, rejected, filters);
    prefetchBySession.set(sessionId, entryPromise);
  }
  try {
    const entry = await entryPromise;
    const t = await entry.taste;
    patchSessionLaneMeta(sessionId, { mood: entry.mood, taste: t });
    return t;
  } catch {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    return fallbackTaste(chosen);
  }
}

/** TMDB resolve + at most one extra LLM pass when picks or resolve count are critically low. */
async function finalizeSingleTrackToResponse(
  track: RecommendationTrack,
  chosen: Movie[],
  rejected: Movie[],
  filters: string[],
  mood: SessionMoodProfile,
  banned: { bannedSet: Set<string>; bannedTitlesPrompt: string },
  taste: TasteObservationResult,
  rawFromPrefetch: SingleTrackLLMResult | null,
  timingSessionId?: string
): Promise<RecommendationsResponse> {
  let picks = rawFromPrefetch?.picks || [];
  let trackCopy: SingleTrackLLMResult | null = rawFromPrefetch;

  if (picks.length < 6) {
    const raw = await generateSingleTrackPicks(
      chosen,
      rejected,
      filters,
      track,
      mood,
      banned,
      "",
      timingSessionId
    );
    picks = raw.picks || [];
    trackCopy = raw;
  }

  const tmdb1 = Date.now();
  let recommendations = await resolvePicksToRecommendations(picks, chosen, track);
  if (timingSessionId) {
    logRecsTiming(timingSessionId, `tmdb_enrichment_${track}_pass1`, Date.now() - tmdb1);
  }

  if (recommendations.length < TARGET_RESOLVED) {
    if (timingSessionId) {
      logRecsTiming(timingSessionId, `regen_${track}_unresolved_tmdb`, 0);
    }
    const raw = await generateSingleTrackPicks(
      chosen,
      rejected,
      filters,
      track,
      mood,
      banned,
      "",
      timingSessionId
    );
    const tmdb2 = Date.now();
    recommendations = await resolvePicksToRecommendations(raw.picks, chosen, track);
    if (timingSessionId) {
      logRecsTiming(timingSessionId, `tmdb_enrichment_${track}_pass2`, Date.now() - tmdb2);
    }
    trackCopy = raw;
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

function kickWarmOtherLane(sessionId: string, pickedTrack: RecommendationTrack): void {
  const other: RecommendationTrack = pickedTrack === "mainstream" ? "indie" : "mainstream";
  if (sessionLaneCache.get(sessionId)?.[other]) return;
  void ensureLaneReady(sessionId, other).catch((err) =>
    console.error("[warm-other-lane]", err)
  );
}

async function ensureLaneReady(sessionId: string, track: RecommendationTrack): Promise<RecommendationsResponse> {
  const totalStart = Date.now();
  await ensureRecsLoaded();

  const cached = sessionLaneCache.get(sessionId)?.[track];
  if (cached) {
    logRecsTiming(sessionId, `lane_${track}_cache_hit`, Date.now() - totalStart);
    return cached;
  }

  const lk = laneInflightKey(sessionId, track);
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
      mergeLaneIntoCache(sessionId, track, r);
      logRecsTiming(sessionId, `lane_${track}_total`, Date.now() - totalStart);
      return r;
    }

    let entryPromise = prefetchBySession.get(sessionId);
    if (!entryPromise) {
      entryPromise = buildPrefetchEntry(sessionId, chosen, rejected, filters);
      prefetchBySession.set(sessionId, entryPromise);
    }

    let mood: SessionMoodProfile;
    let banned: { bannedSet: Set<string>; bannedTitlesPrompt: string };
    let taste: TasteObservationResult;
    let raw: SingleTrackLLMResult | null = null;

    try {
      const prefetchWait = Date.now();
      const entry = await entryPromise;
      logRecsTiming(sessionId, "prefetch_entry_wait", Date.now() - prefetchWait);
      mood = entry.mood;
      banned = entry.banned;
      taste = await entry.taste.catch(() => moodToTasteObservation(mood, chosen));
      patchSessionLaneMeta(sessionId, { mood, taste });

      const laneWait = Date.now();
      raw = await (track === "mainstream" ? entry.mainstream : entry.indie).catch((e) => {
        console.error(`[prefetch] ${track} track failed`, e);
        return { picks: [] as AIRecommendationResult[] };
      });
      logRecsTiming(sessionId, `llm_raw_wait_${track}`, Date.now() - laneWait);
    } catch (e) {
      console.error("[prefetch] entry failed", e);
      const moodT0 = Date.now();
      mood = await extractSessionMood(chosen, rejected, filters);
      logRecsTiming(sessionId, "taste_extraction_cold", Date.now() - moodT0);
      taste = moodToTasteObservation(mood, chosen);
      banned = buildBannedContext(chosen, rejected);
      patchSessionLaneMeta(sessionId, { mood, taste });
      const coldLlm = Date.now();
      raw = await generateSingleTrackPicks(
        chosen,
        rejected,
        filters,
        track,
        mood,
        banned,
        "",
        sessionId
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
      banned,
      taste,
      raw,
      sessionId
    );
    logRecsTiming(sessionId, `finalize_${track}`, Date.now() - finalizeT0);

    mergeLaneIntoCache(sessionId, track, res);
    recordRecommendedTitles(res.recommendations.map((r) => r.movie.title));

    const cur = sessionLaneCache.get(sessionId);
    if (cur?.mainstream && cur?.indie) {
      prefetchBySession.delete(sessionId);
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
  track: RecommendationTrack
): Promise<RecommendationsResponse> {
  const routeStart = Date.now();
  await ensureRecsLoaded();
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  if (chosen.length === 0) {
    return fallbackSingleTrack(chosen, track);
  }

  const active = await ensureLaneReady(sessionId, track);
  kickWarmOtherLane(sessionId, track);

  const bundle = sessionLaneCache.get(sessionId) ?? {};
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
  ).slice(0, TARGET_RESOLVED);

  const recs: Recommendation[] = await Promise.all(
    pool.map(async (m) => {
      const trailerUrls = await getMovieTrailers(m.tmdbId);
      return {
        movie: { ...m, listSource: "ai-recommendation" },
        trailerUrl: trailerUrls[0] || null,
        trailerUrls,
        reason: "Sits in the same ballpark as the pattern your picks sketched.",
        pickedAs: track,
      };
    })
  );

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
  track: RecommendationTrack = "mainstream"
): Promise<Recommendation | null> {
  const picks = chosenMovies.map((m, i) => `R${i + 1}: "${m.title}" (${m.year}) — ${m.director || "?"}`).join("\n");
  const rejHints = rejectedMovies.length > 0
    ? `\nPASSED ON: ${rejectedMovies.slice(0, 3).map(m => `"${m.title}"`).join(", ")}`
    : "";

  const prompt = `One replacement for the ${track} list. Infer taste from the whole funnel — do not mirror one funnel title to one pick.

${picks}${rejHints}

Exclude ${excludeTmdbIds.length} titles already shown.

${replacementRules(track)}

Reason: 1–2 sentences, max 35 words. Tie to overall funnel pattern. Do NOT name any funnel film.

JSON only: {"title":"","year":2000,"reason":""}`;

  try {
    const resp = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 240,
      temperature: 0.85,
    });
    const result: AIRecommendationResult = JSON.parse(resp.choices[0]?.message?.content || "{}");
    const search = await searchMovieByTitle(result.title, result.year);
    if (!search || excludeTmdbIds.includes(search.id)) return await catalogueFallbackReplacement(excludeTmdbIds, track);

    const [details, trailers] = await Promise.all([getMovieDetails(search.id), getMovieTrailers(search.id)]);
    if (!details || !details.posterPath?.trim() || trailers.length === 0) {
      return catalogueFallbackReplacement(excludeTmdbIds, track);
    }

    details.listSource = "replacement";
    return {
      movie: details,
      trailerUrl: trailers[0],
      trailerUrls: trailers,
      reason: result.reason,
      pickedAs: track,
    };
  } catch {
    return catalogueFallbackReplacement(excludeTmdbIds, track);
  }
}

async function catalogueFallbackReplacement(
  excludeTmdbIds: number[],
  track: RecommendationTrack
): Promise<Recommendation | null> {
  const eligible = shuffleArray(
    getAllMovies().filter((m) => !excludeTmdbIds.includes(m.tmdbId) && m.rating && m.rating >= 7.0)
  );
  for (const movie of eligible.slice(0, 12)) {
    if (!movie.posterPath?.trim()) continue;
    const trailerUrls = await getMovieTrailers(movie.tmdbId);
    if (trailerUrls.length === 0) continue;
    return {
      movie: { ...movie, listSource: "replacement" },
      trailerUrl: trailerUrls[0],
      trailerUrls,
      reason: "Fits the mood your rounds pointed toward.",
      pickedAs: track,
    };
  }
  return null;
}
