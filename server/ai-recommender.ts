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
const recentlyRecommendedFingerprints: string[] = [];
const recentlyRecommendedDirectors: string[] = [];
const MAX_RECENT_TRACKED = 400;
const RECENT_EXCLUSIONS_PROMPT_COUNT = 64;
const TARGET_RESOLVED = 6;
/** Single LLM pass per lane; local selector trims to final row. */
const LLM_PICK_COUNT = 22;
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
    recentlyRecommendedTitles.push(tk);
    recentlyRecommendedFingerprints.push(metadataFingerprint(r.movie));
    recentlyRecommendedDirectors.push(
      (r.movie.director || "").toLowerCase().trim() || `__dir_${r.movie.tmdbId}`
    );
    while (recentlyRecommendedTitles.length > MAX_RECENT_TRACKED) {
      recentlyRecommendedTitles.shift();
      recentlyRecommendedFingerprints.shift();
      recentlyRecommendedDirectors.shift();
    }
  }
  storage
    .saveRecentRecommendationBundles({
      titles: [...recentlyRecommendedTitles],
      fingerprints: [...recentlyRecommendedFingerprints],
      directors: [...recentlyRecommendedDirectors],
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
      `Browser memory — avoid leaning on these directors again tonight (prefer fresh voices): ${Array.from(anonDirectorKeys).slice(0, 25).join("; ")}.`,
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
- No duplicate directors across picks.
- Cluster diversity: spread picks across DISTINCT subgenre textures (crime vs psychological vs sci-fi vs survival vs moral drama vs horror unease, etc.), eras, and English vs non-English voices — never six films that feel like the same "type" while still matching the mood.
- session_variation nudges which angles to explore; it must not override taste_profile.
- Exactly ${LLM_PICK_COUNT} objects in "picks" (buffer for lookup; product shows 6).`;

function buildMainstreamTrackPrompt(
  tasteProfileJson: string,
  bannedTitles: string,
  variationBlock: string
): string {
  const v = variationBlock.trim() || "Vary subgenres and eras within the mood; avoid a monochrome row.";
  return `You are a film-obsessed recommender.

You are generating MAINSTREAM picks for THIS specific session only.

Inputs:
- taste_profile (JSON, source of truth):
${tasteProfileJson}

- banned_titles:
${bannedTitles}

- session_variation (explore the mood through different textures — still obey taste_profile):
${v}

Definition of MAINSTREAM:
- accessible, highly watchable tonight, broadly satisfying, easy-entry films
- still tailored to taste_profile

Critical rules:
- Do NOT default to overused prestige titles
- Avoid banned_titles completely (including close variants)
- taste_profile is authoritative — reflect BOTH what_they_want AND what_they_avoid
- No repeated directors
- Do not cluster all picks into the same subgenre or tone (e.g. not six gritty crime dramas)
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

function buildIndieTrackPrompt(
  tasteProfileJson: string,
  bannedTitles: string,
  variationBlock: string
): string {
  const v = variationBlock.trim() || "Vary textures; favour under-seen and non-obvious voices.";
  return `You are a serious movie buff creating a LEFT-FIELD recommendation row for THIS session only.

Inputs:
- taste_profile (JSON, source of truth):
${tasteProfileJson}

- banned_titles:
${bannedTitles}

- session_variation (same mood, braver angles — obey taste_profile):
${v}

Definition of INDIE / LEFT-FIELD:
- NOT "slightly less obvious mainstream" — this row must feel categorically different from a mainstream line-up for the same mood
- less obvious, under-seen or under-recommended; festival / auteur / cult / arthouse / singular films
- NOT just foreign (English-language indie is fine)

Hard separation rules:
- At most 2 films that could plausibly appear on generic "greatest / top 100" lists; the rest must feel discoverable
- Strongly prefer: less household-name directors, non-US or non-English-primary productions, festival prizewinners, A24-adjacent or cult reputations, niche but strong word-of-mouth
- Avoid picks that would sit comfortably on the same shelf as typical blockbuster-adjacent recommendations

Critical rules:
- Do NOT default to prestige-canon films
- Avoid banned_titles completely
- taste_profile is authoritative
- At least 4 of ${LLM_PICK_COUNT} picks must be meaningfully less mainstream than typical blockbusters
- No repeated directors
- Prioritise originality over safety; picks must still be enjoyable, not obscure for its own sake
- Each pick includes "tag" naming its texture (e.g. "bleak crime", "festival sci-fi", "slow-burn horror", "moral drama")
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
    return "PickAFlick MAINSTREAM. JSON only. Accessible picks; obey taste_profile, banned_titles, session_variation; varied subgenres/eras; no director repeats.";
  }
  return "PickAFlick LEFT-FIELD. JSON only. Distinct from mainstream — festival/auteur/cult energy; max 2 top-list-obvious films; obey taste_profile, banned_titles, session_variation; tags on picks.";
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
  timingSessionId?: string,
  variationBlock = ""
): Promise<SingleTrackLLMResult> {
  await ensureRecsLoaded();
  const tasteProfileJson = JSON.stringify(mood);
  const basePrompt =
    track === "mainstream"
      ? buildMainstreamTrackPrompt(tasteProfileJson, bannedCtx.bannedTitlesPrompt, variationBlock)
      : buildIndieTrackPrompt(tasteProfileJson, bannedCtx.bannedTitlesPrompt, variationBlock);
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

    if (mergedBanned && movieFailsAnonDiversity(movieDetails, mergedBanned)) return null;

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
    recentlyRecommendedFingerprints.filter(Boolean).slice(-100)
  );
  const recentDirectorKeys = new Set(recentlyRecommendedDirectors.filter(Boolean).slice(-100));

  const ctx: LocalSelectorContext = {
    track,
    chosenMovies,
    moodBlob,
    recentTitleKeys,
    recentFingerprints,
    recentDirectorKeys,
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
  const { block: variationBlock } = getOrCreateSessionVariation(sessionId);
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
      sessionId,
      variationBlock
    ),
    indie: generateSingleTrackPicks(
      chosenMovies,
      rejectedMovies,
      filters,
      "indie",
      mood,
      banned,
      "",
      sessionId,
      variationBlock
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
  const cachedTaste = sessionTasteMeta.get(sessionId)?.taste;
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
    patchSessionTasteMeta(sessionId, { mood: entry.mood, taste: t });
    return t;
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
  anonFp: string
): Promise<RecommendationsResponse> {
  const finalizeStart = Date.now();
  const sid = timingSessionId;
  const shortSid = sid && sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;

  const logFinalize = (msg: string, detail?: Record<string, number | string | boolean>) => {
    if (!sid) return;
    const tail = detail ? ` ${JSON.stringify(detail)}` : "";
    console.log(`[recs-finalize] ${shortSid} ${track} ${msg}${tail}`);
  };

  let supplementLlmMs = 0;
  let auResolvePass1Ms = 0;
  let regenLlmMs = 0;
  let auResolvePass2Ms = 0;
  let regenUsed = false;

  const variationBlock = getOrCreateSessionVariation(laneSessionId).block;
  const otherLaneTmdbIds = getOtherLaneTmdbIds(laneSessionId, anonFp, track);
  const crossLaneHint = buildCrossLaneHint(laneSessionId, anonFp, track);

  const workingBanned = cloneMergedBanned(banned);
  let picks = filterPicksAgainstBanned(rawFromPrefetch?.picks || [], workingBanned.bannedSet);
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
      variationBlock
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
        `supplement_llm_ms=${supplementLlmMs} ` +
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

    let entryPromise = prefetchBySession.get(sessionId);
    if (!entryPromise) {
      entryPromise = buildPrefetchEntry(sessionId, chosen, rejected, filters);
      prefetchBySession.set(sessionId, entryPromise);
    }

    let mood: SessionMoodProfile;
    let taste: TasteObservationResult;
    let raw: SingleTrackLLMResult | null = null;
    let bannedMerged: MergedBannedContext;

    try {
      const prefetchWait = Date.now();
      const entry = await entryPromise;
      logRecsTiming(sessionId, "prefetch_entry_wait", Date.now() - prefetchWait);
      mood = entry.mood;
      bannedMerged = mergeAnonymousIntoBanned(entry.banned, clientAnonMemory);
      taste = await entry.taste.catch(() => moodToTasteObservation(mood, chosen));
      patchSessionTasteMeta(sessionId, { mood, taste });

      const laneWait = Date.now();
      raw = await (track === "mainstream" ? entry.mainstream : entry.indie).catch((e) => {
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
      bannedMerged = mergeAnonymousIntoBanned(buildBannedContext(chosen, rejected), clientAnonMemory);
      patchSessionTasteMeta(sessionId, { mood, taste });
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
        getOrCreateSessionVariation(sessionId).block
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
      anonFp
    );
    logRecsTiming(sessionId, `finalize_${track}`, Date.now() - finalizeT0);

    mergeLaneBundleIntoCache(sessionId, anonFp, track, res);
    recordRecommendedRow(res.recommendations);

    const cur = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp));
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
