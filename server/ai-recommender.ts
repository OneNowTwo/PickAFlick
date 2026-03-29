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

interface AIRecommendationResult { title: string; year?: number; reason: string; }

interface SingleTrackLLMResult {
  picks: AIRecommendationResult[];
}

interface PrefetchEntry {
  taste: Promise<TasteObservationResult>;
  mainstream: Promise<SingleTrackLLMResult>;
  indie: Promise<SingleTrackLLMResult>;
}

const prefetchBySession = new Map<string, Promise<PrefetchEntry>>();

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/^the\s+/i, "");
}

function countPre1970(recs: { year?: number }[]): number {
  return recs.filter((r) => typeof r.year === "number" && r.year < 1970).length;
}

function countYearLeq2010(recs: { year?: number }[]): number {
  return recs.filter((r) => typeof r.year === "number" && r.year <= 2010).length;
}

/** 1-based index into the LLM pick list for the per-session exploration slot. */
function explorationPickIndex(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return h % LLM_PICK_COUNT;
}

function directorKeyForMovie(movie: { tmdbId: number; director?: string | null }): string {
  const d = (movie.director || "").toLowerCase().trim();
  return d || `__anon_director_${movie.tmdbId}`;
}

function resolvedEraSpreadOk(recs: Recommendation[]): boolean {
  const le2010 = recs.filter(
    (r) => typeof r.movie.year === "number" && r.movie.year <= 2010
  ).length;
  return le2010 >= MIN_PICKS_YEAR_LEQ_2010;
}

function countRecentCollisions(recs: { title: string }[], recentSet: Set<string>): number {
  return recs.filter((r) => recentSet.has(normalizeTitleKey(r.title))).length;
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

// ── Taste headline + two-sentence pattern (picker + results top) ─────────────

export async function buildTasteObservation(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[] = []
): Promise<TasteObservationResult> {
  const choicesBlock = formatChoicesBlock(chosenMovies);
  const rejectsBlock = formatRejectsBlock(rejectedMovies, chosenMovies);
  const genreLine = initialGenreFilters.length > 0
    ? `Session genre hints (optional): ${initialGenreFilters.join(", ")}.`
    : "";

  const prompt = `Read this 7-round movie A/B funnel. Write copy for a friend — not marketing, not a robot.

CHOSEN:
${choicesBlock}

PASSED ON:
${rejectsBlock}
${genreLine}

Output JSON only:
{
  "headline": "string — ONE short line only. A human observation of their mood or appetite tonight. Examples of tone (do not copy verbatim): You're in a darker mood tonight. / You want something with a bit of weight. / You're chasing something gripping. / You're leaning playful but still want a story. / You kept tilting toward grounded, adult drama.",
  "patternSummary": "string — EXACTLY two sentences in one paragraph. First sentence: what the pattern of wins/losses suggests (start with You leaned… OR You favoured… OR You kept choosing… OR You mixed… — vary this). Second sentence: MUST start with So these picks and explains how the recommendation list will honour that pattern. Be specific to THIS funnel (tones, pacing, realism vs spectacle, moral complexity, humour level, era bias if clear). No genre soup.",
  "topGenres": ["","",""],
  "themes": ["",""],
  "preferredEras": ["",""]
}

Rules:
- No em dashes. No words: delve, tapestry, landscape, journey (as metaphor), unlock, resonate.
- Do not name or quote any film title from the funnel in headline or patternSummary.
- Sound like a sharp human who watched their choices — not a template.`;

  try {
    const response = await openai.chat.completions.create({
      model: RECOMMENDATIONS_MODEL,
      messages: [
        { role: "system", content: "You write short, natural taste copy. JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 450,
      temperature: 0.88,
    });
    const raw = JSON.parse(response.choices[0]?.message?.content || "{}") as TasteObservationResult;
    return {
      headline: (raw.headline || "").trim(),
      patternSummary: (raw.patternSummary || "").trim(),
      topGenres: raw.topGenres || [],
      themes: raw.themes || [],
      preferredEras: raw.preferredEras || [],
    };
  } catch (e) {
    console.error("[taste-observation]", e);
    return fallbackTaste(chosenMovies);
  }
}

// ── Single track: 8 LLM picks → resolve to 6 for display ─────────────────────

function laneRules(track: RecommendationTrack): string {
  if (track === "mainstream") {
    return `LANE — Mainstream / big night: crowd-pleasing films general audiences know or can find easily — studios, streaming A-titles, stars, clear hooks (action, comedy, thriller, drama). English or widely available dubs OK. This lane should feel like "we're going big and accessible" — NOT like a muted indie list with famous names. Still: do not output six near-identical Oscar-bait dramas; stretch across decades, tones, and countries (include accessible non-English hits when they fit).`;
  }
  return `LANE — Indie / lesser-known: deliberately under-exposed picks — the opposite profile from a mainstream blockbuster night. Prioritise films a casual viewer has probably not seen discussed everywhere. Lean hard on international cinema, festival breakouts, cult and mid-budget gems, strong second-tier directors, pre-2000 titles, and micro-budget standouts that still honour the funnel. If a pick could sit just as easily on a generic "best movies ever" Reddit thread, replace it with something more specific. This list must feel obviously different from what the mainstream lane would output for the same funnel — not a slightly edgier clone.`;
}

function catalogueBreadthBlock(track: RecommendationTrack): string {
  const antiCollapse =
    "CAST A WIDE NET: Language models collapse onto the same ~50–100 \"default\" recommendation titles. Fight that: vary country, decade, primary genre, budget tier, and director. Before finalising each pick, ask whether you are reaching past the first obvious answer.";

  if (track === "mainstream") {
    return `${antiCollapse}

MAINSTREAM-SPECIFIC BREADTH:
- Include at least one pre-2005 title and at least one pick that is primarily comedy, thriller, or action (if the funnel allows — if not, widen mood within drama).
- At least one pick should be a non-US film that still played widely (streaming or cinema) — not only US studio fare.
- No more than half the picks should be from the same 15-year window (e.g. not all 2015–2023).`;
  }

  return `${antiCollapse}

INDIE-SPECIFIC BREADTH (harder separation from mainstream):
- At least 4 picks must satisfy at least one of: non-English primary language, release year before 2000, or director without a recent Hollywood tentpole to their name.
- At least 2 picks should be from outside the US/UK if the funnel allows.
- Favour titles that are critically strong but not household names — dig past the usual prestige shortlist the model always repeats.`;
}

function buildSingleTrackPrompt(
  track: RecommendationTrack,
  choicesBlock: string,
  rejectsBlock: string,
  chosenTitles: string,
  recentExclusions: string[],
  genreFilterLine: string,
  tasteContext: TasteObservationResult | null,
  sessionId: string | undefined,
  promptExtra: string
): string {
  const exclusionsLine = recentExclusions.length > 0
    ? `Also avoid these (recent sessions): ${recentExclusions.join("; ")}.`
    : "";

  const tasteBlock = tasteContext
    ? `FUNNEL READ (every pick must fit this — not a generic good-film list):
- Headline: ${tasteContext.headline}
- Pattern: ${tasteContext.patternSummary}
- Genres: ${(tasteContext.topGenres || []).slice(0, 5).join(", ") || "—"}
- Themes: ${(tasteContext.themes || []).slice(0, 4).join(", ") || "—"}
- Era lean: ${(tasteContext.preferredEras || []).slice(0, 3).join(", ") || "—"}

`
    : "";

  const explorationSlot = sessionId
    ? `EXPLORATION SLOT: In your ordered "picks" array, position ${
        explorationPickIndex(sessionId) + 1
      } (1-based) must be the most off-the-beaten-path title that still matches the funnel — e.g. non-English, older gem, or strong but lesser-known director — not a film that appears on every generic list.\n\n`
    : "";

  const extra = promptExtra.trim() ? `${promptExtra.trim()}\n\n` : "";

  return `Recommend films for tonight from this A/B funnel. The signal is CHOSEN vs PASSED ON (rounds marked * count more).

${tasteBlock}CHOSEN:
${choicesBlock}

PASSED ON:
${rejectsBlock}
${genreFilterLine}

${laneRules(track)}

${catalogueBreadthBlock(track)}

${explorationSlot}Shared (tight):
- Exactly ${LLM_PICK_COUNT} films in "picks" (extras help after title lookup). We show 6 — make them feel distinct, not six of the same cluster.
- Decades (use each pick's "year" field): at least ${MIN_PICKS_YEAR_LEQ_2010} picks with year ≤ 2010; at most ${MAX_PRE_1970} with year < 1970; include a 2020+ if it fits the funnel.
- Primary genre: no more than 2 picks may share the same first-listed genre (spread subgenres and moods).
- Australia-available. No duplicate directors in the list (each director once).
- Obviousness: avoid over-recommended "internet default" films unless an extremely strong funnel match. Prioritise specificity and fit over raw popularity.
- Use the funnel pattern — do not substitute a generic good-film list.
- Not funnel picks: ${chosenTitles}
${exclusionsLine}

${extra}Reasons: short; tie to overall funnel pattern only; never name a funnel film.

JSON only: {"picks":[{"title":"","year":2020,"reason":""}, ... ${LLM_PICK_COUNT} entries]}`;
}

function systemPromptForTrack(track: RecommendationTrack): string {
  if (track === "mainstream") {
    return "PickAFlick MAINSTREAM lane. JSON only. Accessible, big-audience films — but maximise real catalogue breadth; resist the model's habit of repeating the same small set of famous titles. Obey user prompt constraints.";
  }
  return "PickAFlick INDIE / left-field lane. JSON only. Under-known and geographically diverse picks. If output resembles a mainstream list with slightly artsier names, you failed — go more specific, foreign, older, or festival-level. Obey user prompt constraints.";
}

async function callSingleTrackLLM(promptText: string, track: RecommendationTrack): Promise<SingleTrackLLMResult> {
  const response = await openai.chat.completions.create({
    model: RECOMMENDATIONS_MODEL,
    messages: [
      { role: "system", content: systemPromptForTrack(track) },
      { role: "user", content: promptText },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1500,
    temperature: track === "indie" ? 0.95 : 0.84,
  });
  return JSON.parse(response.choices[0]?.message?.content || "{}") as SingleTrackLLMResult;
}

export async function generateSingleTrackPicks(
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  initialGenreFilters: string[],
  track: RecommendationTrack,
  tasteContext: TasteObservationResult | null = null,
  sessionId?: string,
  promptExtra = ""
): Promise<SingleTrackLLMResult> {
  await ensureRecsLoaded();
  const choicesBlock = formatChoicesBlock(chosenMovies);
  const rejectsBlock = formatRejectsBlock(rejectedMovies, chosenMovies);
  const chosenTitles = chosenMovies.map((m) => `"${m.title}"`).join(", ");
  const recentExclusions = recentlyRecommendedTitles.slice(-RECENT_EXCLUSIONS_PROMPT_COUNT);
  const recentTitlesSet = new Set(recentlyRecommendedTitles.map(normalizeTitleKey));
  const genreFilterLine = initialGenreFilters.length > 0
    ? `Optional genre hints: ${initialGenreFilters.join(", ")}.`
    : "";

  const prompt = buildSingleTrackPrompt(
    track,
    choicesBlock,
    rejectsBlock,
    chosenTitles,
    recentExclusions,
    genreFilterLine,
    tasteContext,
    sessionId,
    promptExtra
  );

  let result = await callSingleTrackLLM(prompt, track);
  let picks = result.picks || [];
  if (picks.length < 6) {
    result = await callSingleTrackLLM(`${prompt}\n\nRegenerate: ${LLM_PICK_COUNT} picks; JSON only.`, track);
    picks = result.picks || [];
  }

  const pre1970 = countPre1970(picks);
  const recentHits = countRecentCollisions(picks, recentTitlesSet);
  const le2010 = countYearLeq2010(picks);
  if (pre1970 > MAX_PRE_1970 || recentHits >= 2 || le2010 < MIN_PICKS_YEAR_LEQ_2010) {
    result = await callSingleTrackLLM(
      `${prompt}\n\nRegenerate: max ${MAX_PRE_1970} pre-1970; at least ${MIN_PICKS_YEAR_LEQ_2010} picks with year ≤ 2010; avoid recent list; ${LLM_PICK_COUNT} picks; JSON only.`,
      track
    );
    picks = result.picks || [];
  }

  return { picks };
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
      getMovieTrailers(searchResult.id),
    ]);

    if (!movieDetails) return null;
    if (!movieDetails.posterPath?.trim()) return null;
    if (tmdbTrailers.length === 0) return null;

    movieDetails.listSource = "ai-recommendation";
    return {
      movie: movieDetails,
      trailerUrl: tmdbTrailers[0],
      trailerUrls: tmdbTrailers,
      reason: rec.reason,
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

/** Taste first, then both tracks (each pick prompt includes the taste read + session exploration slot). */
async function buildPrefetchEntry(
  sessionId: string,
  chosenMovies: Movie[],
  rejectedMovies: Movie[],
  filters: string[]
): Promise<PrefetchEntry> {
  const taste = await buildTasteObservation(chosenMovies, rejectedMovies, filters);
  return {
    taste: Promise.resolve(taste),
    mainstream: generateSingleTrackPicks(
      chosenMovies,
      rejectedMovies,
      filters,
      "mainstream",
      taste,
      sessionId
    ),
    indie: generateSingleTrackPicks(chosenMovies, rejectedMovies, filters, "indie", taste, sessionId),
  };
}

/** Fire when the last A/B choice is recorded — runs taste then both tracks. */
export function beginRecommendationPrefetch(sessionId: string): void {
  if (prefetchBySession.has(sessionId)) return;
  const session = gameSessionStorage.getSession(sessionId);
  if (!session?.isComplete) return;
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) return;

  console.log(`[prefetch] Starting taste + mainstream + indie for ${sessionId}`);
  prefetchBySession.set(sessionId, buildPrefetchEntry(sessionId, chosen, rejected, filters));
}

export async function getTastePreviewForSession(sessionId: string): Promise<TasteObservationResult> {
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
    return await entry.taste;
  } catch {
    const chosen = gameSessionStorage.getChosenMovies(sessionId);
    return fallbackTaste(chosen);
  }
}

export async function finalizeRecommendationsForTrack(
  sessionId: string,
  track: RecommendationTrack
): Promise<RecommendationsResponse> {
  await ensureRecsLoaded();
  const chosen = gameSessionStorage.getChosenMovies(sessionId);
  const rejected = gameSessionStorage.getRejectedMovies(sessionId);
  const filters = gameSessionStorage.getSessionFilters(sessionId)?.genres ?? [];
  if (chosen.length === 0) {
    return fallbackSingleTrack(chosen, track);
  }

  let taste: TasteObservationResult;
  let picks: AIRecommendationResult[] = [];

  const entryPromise = prefetchBySession.get(sessionId);
  if (entryPromise) {
    try {
      const entry = await entryPromise;
      taste = await entry.taste.catch(() => fallbackTaste(chosen));
      try {
        const raw = await (track === "mainstream" ? entry.mainstream : entry.indie);
        picks = raw.picks || [];
      } catch (e) {
        console.error("[finalize] track prefetch failed", e);
        picks = [];
      }
    } catch (e) {
      console.error("[finalize] prefetch failed", e);
      taste = await buildTasteObservation(chosen, rejected, filters);
      const raw = await generateSingleTrackPicks(chosen, rejected, filters, track, taste, sessionId);
      picks = raw.picks || [];
    }
    prefetchBySession.delete(sessionId);
  } else {
    taste = await buildTasteObservation(chosen, rejected, filters);
    const raw = await generateSingleTrackPicks(chosen, rejected, filters, track, taste, sessionId);
    picks = raw.picks || [];
  }

  if (picks.length < 6) {
    const raw = await generateSingleTrackPicks(chosen, rejected, filters, track, taste, sessionId);
    picks = raw.picks || [];
  }

  let recommendations = await resolvePicksToRecommendations(picks, chosen, track);
  if (recommendations.length < TARGET_RESOLVED) {
    const raw = await generateSingleTrackPicks(chosen, rejected, filters, track, taste, sessionId);
    recommendations = await resolvePicksToRecommendations(raw.picks, chosen, track);
  }

  if (recommendations.length >= TARGET_RESOLVED && !resolvedEraSpreadOk(recommendations)) {
    const raw = await generateSingleTrackPicks(
      chosen,
      rejected,
      filters,
      track,
      taste,
      sessionId,
      `At least ${MIN_PICKS_YEAR_LEQ_2010} picks must be films released in 2010 or earlier (use accurate release years in JSON — TMDB will match them).`
    );
    const alt = await resolvePicksToRecommendations(raw.picks, chosen, track);
    if (alt.length >= TARGET_RESOLVED && resolvedEraSpreadOk(alt)) {
      recommendations = alt;
    }
  }

  recordRecommendedTitles(recommendations.map((r) => r.movie.title));

  const mainstream = track === "mainstream" ? recommendations : [];
  const indie = track === "indie" ? recommendations : [];

  return {
    recommendations,
    mainstreamRecommendations: mainstream,
    indieRecommendations: indie,
    preferenceProfile: {
      topGenres: taste.topGenres || [],
      themes: taste.themes || [],
      preferredEras: taste.preferredEras || [],
      headline: taste.headline,
      patternSummary: taste.patternSummary,
      tagline: "",
    },
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
