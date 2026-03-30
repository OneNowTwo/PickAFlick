import OpenAI from "openai";
import type {
  Movie,
  Recommendation,
  RecommendationsResponse,
  RecommendationTrack,
} from "@shared/schema";
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

/** gpt-5 Chat Completions: use `max_completion_tokens`, not `max_tokens`. */
function chatParamsForGpt5TitleGen(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">
): Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model"> {
  const p = { ...params } as Record<string, unknown>;
  const mt = p.max_tokens;
  const mc = p.max_completion_tokens;
  if (typeof mt === "number" && mc === undefined) {
    delete p.max_tokens;
    p.max_completion_tokens = mt;
  }
  return p as Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">;
}

/** Movie title generation (slots, refills, replacement): gpt-5 only. Mood uses RECOMMENDATIONS_MODEL. */
async function chatCompletionForRecTitles(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">
): Promise<OpenAI.Chat.ChatCompletion> {
  console.log("[recs] model=gpt-5");
  return await openai.chat.completions.create({
    ...chatParamsForGpt5TitleGen(params),
    model: "gpt-5",
  });
}

const recentlyRecommendedTitles: string[] = [];
const recentlyRecommendedFingerprints: string[] = [];
const recentlyRecommendedDirectors: string[] = [];
const recentlyRecommendedDisplayTitles: string[] = [];
const recentlyRecommendedFlavours: string[] = [];
const recentlyRecommendedTones: string[] = [];
const recentlyRecommendedPrestige: string[] = [];
const recentlyRecommendedFeelKeys: string[] = [];
const MAX_RECENT_TRACKED = 400;
/** Last N served titles — hard-ban in prompt + filter (stops anchor repeats across rows). */
const RECENT_TITLE_BAN_WINDOW = 18;
/** Last N served rows' directors — ban re-use across nearby rows (real names only). */
const RECENT_DIRECTOR_BAN_WINDOW = 18;
const TARGET_RESOLVED = 6;
/** Max targeted slot-refill LLM rounds after resolve (still one call per round, missing slots only). */
const MAX_SLOT_REFILL_ROUNDS = 4;
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
  /** Discovery slot 1–6 (stable through refills). */
  slot?: number;
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
  "Children of Men",
  "The Lighthouse",
  "Annihilation",
  "The Secret in Their Eyes",
  "Secret in Their Eyes",
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
const laneLlmBySessionIdentity = new Map<
  string,
  { mainstream: Promise<SingleTrackLLMResult>; indie: Promise<SingleTrackLLMResult> }
>();

function lanePrefetchKey(sessionId: string, anonFp: string): string {
  return `${sessionId}\t${anonFp}`;
}

function clearLanePrefetchForSession(sessionId: string): void {
  const prefix = `${sessionId}\t`;
  Array.from(laneLlmBySessionIdentity.keys()).forEach((k) => {
    if (k.startsWith(prefix)) laneLlmBySessionIdentity.delete(k);
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

function mergeRecentProductHistoryIntoBanned(merged: MergedBannedContext): MergedBannedContext {
  const bannedSet = new Set(merged.bannedSet);
  const extraTitles: string[] = [];
  const tStart = Math.max(0, recentlyRecommendedTitles.length - RECENT_TITLE_BAN_WINDOW);
  for (let i = tStart; i < recentlyRecommendedTitles.length; i++) {
    const k = recentlyRecommendedTitles[i];
    if (k && !bannedSet.has(k)) {
      bannedSet.add(k);
      extraTitles.push(k);
    }
  }

  const recentDirectorBanSet = new Set<string>();
  const extraDirectorLabels: string[] = [];
  const dStart = Math.max(0, recentlyRecommendedDirectors.length - RECENT_DIRECTOR_BAN_WINDOW);
  for (let i = dStart; i < recentlyRecommendedDirectors.length; i++) {
    const d = (recentlyRecommendedDirectors[i] || "").toLowerCase().trim();
    if (!d || d.startsWith("__dir_")) continue;
    recentDirectorBanSet.add(d);
    if (extraDirectorLabels.length < 40) {
      const label = recentlyRecommendedDirectors[i].trim();
      if (label && !extraDirectorLabels.some((x) => x.toLowerCase() === d)) {
        extraDirectorLabels.push(label);
      }
    }
  }

  const titleLine =
    extraTitles.length > 0
      ? `Recently served on this product — do NOT output these titles (or close variants): ${extraTitles.join("; ")}.`
      : "";
  const directorLine =
    extraDirectorLabels.length > 0
      ? `Recently served directors — do NOT use any of these directors again (pick different filmmakers): ${extraDirectorLabels.join("; ")}.`
      : "";
  const bannedTitlesPrompt = [merged.bannedTitlesPrompt, titleLine, directorLine].filter(Boolean).join(" ");

  return {
    bannedSet,
    bannedTitlesPrompt,
    anonDirectorKeys: new Set(merged.anonDirectorKeys),
    anonPrimaryGenreCounts: new Map(merged.anonPrimaryGenreCounts),
    recentDirectorBanSet,
  };
}

async function startLaneLlmPrefetchIfNeeded(
  sessionId: string,
  clientAnonMemory: AnonymousRecMemoryEntry[],
  phase1: PrefetchPhase1
): Promise<void> {
  const anonFp = anonFingerprint(clientAnonMemory);
  const key = lanePrefetchKey(sessionId, anonFp);
  if (laneLlmBySessionIdentity.has(key)) return;

  const merged = mergeRecentProductHistoryIntoBanned(mergeAnonymousIntoBanned(phase1.banned, clientAnonMemory));

  laneLlmBySessionIdentity.set(key, {
    mainstream: generateSlotBasedLanePicks(
      phase1.chosen,
      phase1.rejected,
      phase1.filters,
      "mainstream",
      phase1.mood,
      merged,
      "",
      sessionId
    ),
    indie: generateSlotBasedLanePicks(
      phase1.chosen,
      phase1.rejected,
      phase1.filters,
      "indie",
      phase1.mood,
      merged,
      "",
      sessionId
    ),
  });
}

const MAINSTREAM_SLOT_SYSTEM = `You are a film expert recommending for a MAINSTREAM row: accessible, engaging, high-confidence picks a general audience can enjoy tonight.

Bias toward: clear stories, strong momentum, satisfying payoffs, and broadly watchable craft — not slow festival pieces, not abstract/experimental cinema, not niche arthouse unless it still plays like a mainstream hit.

Based on the user's taste profile, generate 6 movie recommendations.

CRITICAL RULE:
Each recommendation MUST come from a DIFFERENT discovery type.
Do NOT give 6 films that feel like the same shelf.

Fill these EXACT slots:

1. Well-known, high-quality film (but NOT overplayed or obvious)
2. Non-English film that is still accessible and widely loved
3. Underrated but broadly appealing
4. Recent film (2018+) with strong reception
5. Tonal or pacing contrast from the others while still fitting the user's taste
6. Slight wildcard — surprising, but still watchable and satisfying

STRICT RULES:

* No repeated directors
* Avoid overly obscure, glacial, or "homework" films — mainstream means easy to recommend with confidence
* Avoid commonly repeated default recommendation titles
* Avoid "film bro canon" staples unless unusually justified
* If two picks feel too similar, replace one
* Prioritise engaging, watchable, high-confidence picks
* Each film must be plausibly streamable, rentable, or purchasable in Australia

Return ONLY valid JSON with exactly 6 picks in order (slot 1…6), each with title and year when known.`;

const INDIE_SLOT_SYSTEM = `You are a deep film obsessive focused on discovery, not popularity.

Based on the user's taste profile, generate 6 movie recommendations.

CRITICAL RULE:
Each recommendation MUST come from a DIFFERENT discovery type.
Do NOT give 6 films that feel like the same shelf.

Fill these EXACT slots:

1. Critically acclaimed but NOT mainstream or over-recommended
2. Non-English standout, preferably less widely surfaced
3. Cult / under-seen / low-popularity discovery
4. Recent (2018+) but under-the-radar
5. Strong stylistic or tonal outlier that still fits the taste profile
6. Wildcard — unusual, bold, or unexpected, but still aligned with taste

STRICT RULES:

* No repeated directors
* Avoid IMDb Top 250 / obvious canon / default "smart movie" picks
* Avoid safe or generic choices
* If a title feels commonly recommended, replace it
* Prioritise originality, distinctiveness, and discovery over familiarity
* Each film must be plausibly streamable, rentable, or purchasable in Australia

Return ONLY valid JSON with exactly 6 picks in order (slot 1…6), each with title and year when known.`;

const MAINSTREAM_SLOT_REASONS = [
  "Slot 1 — Well-known quality, not overplayed",
  "Slot 2 — Non-English, accessible",
  "Slot 3 — Underrated, broadly appealing",
  "Slot 4 — Recent (2018+), strong reception",
  "Slot 5 — Tonal/pacing contrast, still on-taste",
  "Slot 6 — Wildcard, surprising yet satisfying",
] as const;

const INDIE_SLOT_REASONS = [
  "Slot 1 — Acclaimed, not mainstream",
  "Slot 2 — Non-English standout",
  "Slot 3 — Cult / under-seen",
  "Slot 4 — Recent, under-the-radar",
  "Slot 5 — Stylistic outlier, on-taste",
  "Slot 6 — Wildcard, bold",
] as const;

/** Full slot lines for targeted refill prompts (must stay aligned with system prompts). */
const MAINSTREAM_SLOT_SPECS: readonly string[] = [
  "Slot 1: Well-known, high-quality film (but NOT overplayed or obvious)",
  "Slot 2: Non-English film that is still accessible and widely loved",
  "Slot 3: Underrated but broadly appealing",
  "Slot 4: Recent film (2018+) with strong reception",
  "Slot 5: Tonal or pacing contrast from the others while still fitting the user's taste",
  "Slot 6: Slight wildcard — surprising, but still watchable and satisfying",
];

const INDIE_SLOT_SPECS: readonly string[] = [
  "Slot 1: Critically acclaimed but NOT mainstream or over-recommended",
  "Slot 2: Non-English standout, preferably less widely surfaced",
  "Slot 3: Cult / under-seen / low-popularity discovery",
  "Slot 4: Recent (2018+) but under-the-radar",
  "Slot 5: Strong stylistic or tonal outlier that still fits the taste profile",
  "Slot 6: Wildcard — unusual, bold, or unexpected, but still aligned with taste",
];

function parseSlotFromTag(tag?: string): number | undefined {
  if (!tag) return undefined;
  const m = /\d+/.exec(tag);
  if (!m) return undefined;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 6 ? n : undefined;
}

function buildSlotUserMessage(
  track: RecommendationTrack,
  tasteProfileJson: string,
  bannedTitlesPrompt: string,
  genreLine: string,
  promptExtra: string
): string {
  return `taste_profile (JSON — source of truth for tonight's mood):
${tasteProfileJson}

${genreLine}

Titles and names you must NOT output (or obvious variants of):
${bannedTitlesPrompt}

Output JSON only, this exact shape:
{
  "line_summary": "one short sentence describing the row",
  "picks": [
    {"slot": 1, "title": "", "year": 2020},
    {"slot": 2, "title": "", "year": null},
    {"slot": 3, "title": "", "year": null},
    {"slot": 4, "title": "", "year": null},
    {"slot": 5, "title": "", "year": null},
    {"slot": 6, "title": "", "year": null}
  ]
}

Rules: exactly 6 picks, slots 1–6 in order, one director per film (no director twice). Real released films only.
${promptExtra.trim() ? `\n\nAdditional instruction:\n${promptExtra.trim()}` : ""}`;
}

function parseSlotTrackResponse(
  track: RecommendationTrack,
  raw: Record<string, unknown>
): SingleTrackLLMResult {
  const picksIn = Array.isArray(raw.picks) ? raw.picks : [];
  const labels = track === "mainstream" ? MAINSTREAM_SLOT_REASONS : INDIE_SLOT_REASONS;
  const picks: AIRecommendationResult[] = picksIn
    .map((p: unknown) => {
      const o = p as Record<string, unknown>;
      const slot = typeof o.slot === "number" ? o.slot : parseInt(String(o.slot || ""), 10);
      const title = String(o.title || "").trim();
      const idx = Number.isFinite(slot) && slot >= 1 && slot <= 6 ? slot - 1 : -1;
      const reason = idx >= 0 ? labels[idx] : "Discovery slot";
      return {
        title,
        year: parseYearField(o.year),
        reason,
        tag: idx >= 0 ? `Slot ${slot}` : undefined,
        slot: idx >= 0 ? slot : undefined,
      };
    })
    .filter((p) => p.title);

  picks.sort((a, b) => (a.slot ?? parseSlotFromTag(a.tag) ?? 99) - (b.slot ?? parseSlotFromTag(b.tag) ?? 99));

  const summary = String(raw.line_summary || "").trim();
  if (track === "mainstream") {
    return {
      picks,
      line_what_they_want: summary,
      line_what_they_avoid: "",
    };
  }
  return {
    picks,
    line_cinema_suggested: summary,
    line_trap_avoided: "",
  };
}

function picksToSixSlotRow(picks: AIRecommendationResult[]): (AIRecommendationResult | null)[] {
  const row: (AIRecommendationResult | null)[] = [null, null, null, null, null, null];
  for (const p of picks) {
    const s = p.slot ?? parseSlotFromTag(p.tag);
    if (s && s >= 1 && s <= 6 && !row[s - 1]) row[s - 1] = { ...p, slot: s };
  }
  return row;
}

async function refillSlotsOnly(
  track: RecommendationTrack,
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  slots: number[],
  promptExtra: string,
  timingSessionId?: string
): Promise<AIRecommendationResult[]> {
  const need = Array.from(new Set(slots.filter((s) => s >= 1 && s <= 6))).sort((a, b) => a - b);
  if (need.length === 0) return [];

  const tasteProfileJson = JSON.stringify(mood);
  const specs = track === "mainstream" ? MAINSTREAM_SLOT_SPECS : INDIE_SLOT_SPECS;
  const specBlock = need.map((s) => specs[s - 1]).join("\n");
  const user = `taste_profile (JSON — source of truth for tonight's mood):
${tasteProfileJson}

Titles and names you must NOT output (or obvious variants of):
${bannedCtx.bannedTitlesPrompt}

TASK: Fill ONLY these discovery slots: ${need.join(", ")}.
Use these definitions exactly (one film per slot, no director twice across your picks):

${specBlock}

Output JSON only:
{ "picks": [ {"slot": <n>, "title": "", "year": null}, ... ] }

Rules: exactly ${need.length} picks, one per listed slot number, slots ${need.join(", ")} only, real released films, plausibly available in Australia.${promptExtra.trim() ? `\n\nAdditional instruction:\n${promptExtra.trim()}` : ""}`;

  const system = track === "mainstream" ? MAINSTREAM_SLOT_SYSTEM : INDIE_SLOT_SYSTEM;
  const t0 = Date.now();
  const response = await chatCompletionForRecTitles({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1200,
    temperature: track === "indie" ? 0.9 : 0.8,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, `llm_${track}_slot_refill`, Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  const parsed = parseSlotTrackResponse(track, raw);
  return filterPicksAgainstBanned(parsed.picks || [], bannedCtx.bannedSet).filter((p) => {
    const s = p.slot ?? parseSlotFromTag(p.tag);
    return s !== undefined && need.includes(s);
  });
}

async function buildSixSlotPickArray(
  initial: AIRecommendationResult[],
  track: RecommendationTrack,
  mood: SessionMoodProfile,
  bannedCtx: MergedBannedContext,
  promptExtra: string,
  timingSessionId?: string
): Promise<(AIRecommendationResult | null)[]> {
  const arr: (AIRecommendationResult | null)[] = [null, null, null, null, null, null];
  function ingest(list: AIRecommendationResult[]) {
    for (const p of list) {
      const s = p.slot ?? parseSlotFromTag(p.tag);
      if (!s || s < 1 || s > 6 || !p.title) continue;
      if (bannedCtx.bannedSet.has(normalizeTitleKey(p.title))) continue;
      if (arr[s - 1]) continue;
      arr[s - 1] = { ...p, slot: s };
    }
  }
  ingest(initial);
  let rounds = 0;
  while (arr.some((x) => !x) && rounds < 3) {
    const missing = [1, 2, 3, 4, 5, 6].filter((s) => !arr[s - 1]);
    const refill = await refillSlotsOnly(
      track,
      mood,
      bannedCtx,
      missing,
      rounds === 0 ? promptExtra : `Only slots ${missing.join(", ")}. Every title must obey the ban list.`,
      timingSessionId
    );
    ingest(filterPicksAgainstBanned(refill, bannedCtx.bannedSet));
    rounds++;
  }
  return arr;
}

async function generateSlotBasedLanePicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  track: RecommendationTrack,
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
  const user = buildSlotUserMessage(track, tasteProfileJson, bannedCtx.bannedTitlesPrompt, genreLine, promptExtra);
  const system = track === "mainstream" ? MAINSTREAM_SLOT_SYSTEM : INDIE_SLOT_SYSTEM;

  const t0 = Date.now();
  const response = await chatCompletionForRecTitles({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1600,
    temperature: track === "indie" ? 0.92 : 0.82,
  });
  if (timingSessionId) {
    logRecsTiming(timingSessionId, `llm_${track}_slots`, Date.now() - t0);
  }
  const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as Record<string, unknown>;
  const parsed = parseSlotTrackResponse(track, raw);
  const filtered = filterPicksAgainstBanned(parsed.picks || [], bannedCtx.bannedSet);
  const row = await buildSixSlotPickArray(filtered, track, mood, bannedCtx, promptExtra, timingSessionId);
  const picks = row.filter((p): p is AIRecommendationResult => p !== null);
  return { ...parsed, picks };
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
  /** Lowercase director names from recent product history (not TMDB placeholders). */
  recentDirectorBanSet: Set<string>;
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

  return {
    bannedSet,
    bannedTitlesPrompt,
    anonDirectorKeys,
    anonPrimaryGenreCounts,
    recentDirectorBanSet: new Set<string>(),
  };
}

function cloneMergedBanned(m: MergedBannedContext): MergedBannedContext {
  return {
    bannedSet: new Set(m.bannedSet),
    bannedTitlesPrompt: m.bannedTitlesPrompt,
    anonDirectorKeys: new Set(m.anonDirectorKeys),
    anonPrimaryGenreCounts: new Map(m.anonPrimaryGenreCounts),
    recentDirectorBanSet: new Set(m.recentDirectorBanSet),
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
type LaneBundle = Partial<Record<RecommendationTrack, RecommendationsResponse>>;
const sessionLaneBundleCache = new Map<string, LaneBundle>();
const laneInflight = new Map<string, Promise<RecommendationsResponse>>();

function laneBundleKey(sessionId: string, anonFp: string): string {
  return `${sessionId}::${anonFp}`;
}

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

function getOtherLaneTmdbIds(sessionId: string, anonFp: string, track: RecommendationTrack): Set<number> {
  const other: RecommendationTrack = track === "mainstream" ? "indie" : "mainstream";
  const bundle = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp));
  const list = bundle?.[other]?.recommendations ?? [];
  return new Set(list.map((r) => r.movie.tmdbId));
}

function buildCrossLaneHint(sessionId: string, anonFp: string, track: RecommendationTrack): string {
  const bundle = sessionLaneBundleCache.get(laneBundleKey(sessionId, anonFp));
  if (track === "indie") {
    const m = bundle?.mainstream?.recommendations ?? [];
    if (!m.length) return "";
    return `Mainstream row for this session already: ${m.map((r) => `"${r.movie.title}"`).join("; ")}. Left-field must be different titles — not overlapping or safer parallels.`;
  }
  const i = bundle?.indie?.recommendations ?? [];
  if (!i.length) return "";
  return `Left-field row for this session already: ${i.map((r) => `"${r.movie.title}"`).join("; ")}. Mainstream must not repeat those titles.`;
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

    const dirNorm = (movieDetails.director || "").toLowerCase().trim();
    if (mergedBanned && dirNorm && mergedBanned.recentDirectorBanSet.has(dirNorm)) return null;

    if (mergedBanned && movieFailsAnonDiversity(movieDetails, mergedBanned)) return null;

    movieDetails.listSource = "ai-recommendation";
    const reason =
      rec.tag && rec.reason ? `${rec.reason} · ${rec.tag}` : rec.reason || rec.tag || "";
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

  const ordered = picks.slice(0, TARGET_RESOLVED);
  const tResolve = Date.now();
  const settled = await Promise.all(
    ordered.map((r) => resolveOneRecommendation(r, excludeTmdb, track, mergedBanned))
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
      `[recs-resolve] ${short} ${track} tmdb_au_ms=${resolveMs} ` +
        `llm_picks=${ordered.length} resolved=${out.length}`
    );
  }

  return out;
}

async function resolveSixSlotsWithRefills(
  initialRow: (AIRecommendationResult | null)[],
  chosen: Movie[],
  track: RecommendationTrack,
  workingBanned: MergedBannedContext,
  otherLaneTmdbIds: Set<number>,
  mood: SessionMoodProfile,
  crossLaneHint: string,
  timingSessionId: string | undefined,
  logCluster?: { sessionId: string }
): Promise<{ recommendations: Recommendation[]; refillLlmMs: number; refillRounds: number; resolveMsTotal: number }> {
  const picksRowMut: (AIRecommendationResult | null)[] = [...initialRow];
  const fixed: (Recommendation | null)[] = [null, null, null, null, null, null];
  let refillLlmMs = 0;
  let resolveMsTotal = 0;
  let refillRounds = 0;
  let resolvePass = 0;

  while (true) {
    const excludeTmdb = new Set(chosen.map((m) => m.tmdbId));
    otherLaneTmdbIds.forEach((id) => excludeTmdb.add(id));
    for (let i = 0; i < 6; i++) {
      const f = fixed[i];
      if (f) excludeTmdb.add(f.movie.tmdbId);
    }

    const seenTitles = new Set<string>();
    const seenDirectors = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const f = fixed[i];
      if (f) {
        seenTitles.add(normalizeTitleKey(f.movie.title));
        seenDirectors.add(directorKeyForMovie(f.movie));
      }
    }

    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      if (fixed[i]) continue;
      const pick = picksRowMut[i];
      if (!pick) continue;
      const rec = await resolveOneRecommendation(pick, excludeTmdb, track, workingBanned);
      if (!rec) continue;
      const tk = normalizeTitleKey(rec.movie.title);
      const dk = directorKeyForMovie(rec.movie);
      if (seenTitles.has(tk) || seenDirectors.has(dk)) continue;
      seenTitles.add(tk);
      seenDirectors.add(dk);
      excludeTmdb.add(rec.movie.tmdbId);
      fixed[i] = rec;
    }
    resolveMsTotal += Date.now() - t0;

    if (logCluster) {
      const sid = logCluster.sessionId;
      const short = sid.length > 16 ? `${sid.slice(0, 8)}…` : sid;
      console.log(
        `[recs-resolve] ${short} ${track} pass=${resolvePass} filled=${fixed.filter(Boolean).length}`
      );
    }
    resolvePass++;

    if (fixed.every(Boolean)) {
      return {
        recommendations: fixed as Recommendation[],
        refillLlmMs,
        refillRounds,
        resolveMsTotal,
      };
    }

    if (refillRounds >= MAX_SLOT_REFILL_ROUNDS) {
      break;
    }

    for (let i = 0; i < 6; i++) {
      const f = fixed[i];
      if (f) {
        const k = normalizeTitleKey(f.movie.title);
        if (k) workingBanned.bannedSet.add(k);
      }
    }

    const missingSlots = [1, 2, 3, 4, 5, 6].filter((s) => !fixed[s - 1]);
    for (const s of missingSlots) {
      const old = picksRowMut[s - 1];
      if (old) {
        const k = normalizeTitleKey(old.title);
        if (k) workingBanned.bannedSet.add(k);
      }
      picksRowMut[s - 1] = null;
    }

    const tRef = Date.now();
    const refill = await refillSlotsOnly(
      track,
      mood,
      workingBanned,
      missingSlots,
      [
        "These slots failed Australian streaming/rental/purchase, poster, in-row duplicate rules, or recent-director bans. Suggest different titles that will pass.",
        crossLaneHint,
      ]
        .filter(Boolean)
        .join(" "),
      timingSessionId
    );
    refillLlmMs += Date.now() - tRef;
    refillRounds++;

    for (const p of filterPicksAgainstBanned(refill, workingBanned.bannedSet)) {
      const s = p.slot ?? parseSlotFromTag(p.tag);
      if (!s || s < 1 || s > 6) continue;
      if (!picksRowMut[s - 1]) picksRowMut[s - 1] = { ...p, slot: s };
    }
  }

  return {
    recommendations: fixed.filter((r): r is Recommendation => r !== null),
    refillLlmMs,
    refillRounds,
    resolveMsTotal,
  };
}

export function beginRecommendationPrefetch(sessionId: string): void {
  const session = gameSessionStorage.getSession(sessionId);
  if (!session?.isComplete) return;
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) return;

  if (!prefetchPhase1BySession.has(sessionId)) {
    console.log(`[prefetch] Starting taste extraction for ${sessionId} (slot LLMs deferred until results)`);
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
    await startLaneLlmPrefetchIfNeeded(sessionId, clientAnonMemory, phase1);
    return phase1.taste;
  } catch {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    return fallbackTaste(chosen);
  }
}

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

  const otherLaneTmdbIds = getOtherLaneTmdbIds(laneSessionId, anonFp, track);
  const crossLaneHint = buildCrossLaneHint(laneSessionId, anonFp, track);

  const workingBanned = cloneMergedBanned(banned);
  let picksRow = picksToSixSlotRow(filterPicksAgainstBanned(rawFromPrefetch?.picks || [], workingBanned.bannedSet));
  if (picksRow.some((x) => !x)) {
    const filled = await buildSixSlotPickArray(
      picksRow.filter((x): x is AIRecommendationResult => x !== null),
      track,
      mood,
      workingBanned,
      crossLaneHint,
      timingSessionId
    );
    for (let i = 0; i < 6; i++) {
      if (!picksRow[i]) picksRow[i] = filled[i];
    }
  }

  let trackCopy: SingleTrackLLMResult | null = rawFromPrefetch;

  const tResolveAll = Date.now();
  const { recommendations, refillLlmMs, refillRounds, resolveMsTotal } = await resolveSixSlotsWithRefills(
    picksRow,
    chosen,
    track,
    workingBanned,
    otherLaneTmdbIds,
    mood,
    crossLaneHint,
    timingSessionId,
    timingSessionId ? { sessionId: timingSessionId } : undefined
  );
  const resolveWallMs = Date.now() - tResolveAll;

  logFinalize("slot_resolve_summary", {
    resolve_ms: resolveMsTotal,
    resolve_wall_ms: resolveWallMs,
    refill_rounds: refillRounds,
    refill_llm_ms: refillLlmMs,
    final_resolved_count: recommendations.length,
  });

  if (recommendations.length < TARGET_RESOLVED) {
    console.warn(
      `[recs-finalize] ${shortSid ?? "?"} ${track} HARD_FAILURE insufficient_resolved_after_slot_refills ` +
        `resolved=${recommendations.length} target=${TARGET_RESOLVED} refill_rounds=${refillRounds}`
    );
  }

  const totalFinalizeMs = Date.now() - finalizeStart;
  if (sid) {
    console.log(
      `[recs-finalize] ${shortSid} ${track} SUMMARY ` +
        `total_finalize_ms=${totalFinalizeMs} ` +
        `resolve_core_ms=${resolveMsTotal} ` +
        `resolve_wall_ms=${resolveWallMs} ` +
        `slot_refill_rounds=${refillRounds} ` +
        `slot_refill_llm_ms=${refillLlmMs} ` +
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
      await startLaneLlmPrefetchIfNeeded(sessionId, clientAnonMemory, phase1);
      bannedMerged = mergeRecentProductHistoryIntoBanned(mergeAnonymousIntoBanned(phase1.banned, clientAnonMemory));

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
      bannedMerged = mergeRecentProductHistoryIntoBanned(
        mergeAnonymousIntoBanned(buildBannedContext(chosen, rejected), clientAnonMemory)
      );
      patchSessionTasteMeta(sessionId, { mood, taste });
      const coldLlm = Date.now();
      raw = await generateSlotBasedLanePicks(
        chosen,
        rejected,
        filters,
        track,
        mood,
        bannedMerged,
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
      m && i ? { mainstream: m.preferenceProfile, indie: i.preferenceProfile } : undefined,
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

      const resp = await chatCompletionForRecTitles({
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
