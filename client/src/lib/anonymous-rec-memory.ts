import type { Recommendation, RecommendationTrack } from "@shared/schema";
import type { AnonymousRecMemoryEntry } from "@shared/anonymous-rec-memory";

const STORAGE_KEY = "pickaflick_anon_rec_shown";
const MAX_ENTRIES = 50;
const SESSION_REQ_PREFIX = "pickaflick_anon_mem_req_";

function readRaw(): AnonymousRecMemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return [];
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is AnonymousRecMemoryEntry =>
        e &&
        typeof e === "object" &&
        typeof (e as AnonymousRecMemoryEntry).title === "string" &&
        typeof (e as AnonymousRecMemoryEntry).ts === "number" &&
        ((e as AnonymousRecMemoryEntry).lane === "mainstream" ||
          (e as AnonymousRecMemoryEntry).lane === "indie")
    );
  } catch {
    return [];
  }
}

function writeRaw(entries: AnonymousRecMemoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota / private mode */
  }
}

function fingerprintFromEntries(entries: AnonymousRecMemoryEntry[]): string {
  if (entries.length === 0) return "none";
  const parts = entries
    .map((e) => `${e.tmdbId ?? ""}:${e.title.toLowerCase().trim()}`)
    .sort();
  let h = 0;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h = (Math.imul(31, h) + p.charCodeAt(i)) | 0;
    }
  }
  return `fp_${(entries.length % 97).toString(36)}_${(h >>> 0).toString(36)}`;
}

/**
 * Frozen payload for this game session's API calls so we don't refetch when we append
 * the current row to localStorage after results load.
 */
export function getAnonMemoryPayloadForSession(sessionId: string): AnonymousRecMemoryEntry[] {
  if (typeof window === "undefined") return [];
  const key = `${SESSION_REQ_PREFIX}${sessionId}`;
  const existing = sessionStorage.getItem(key);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (Array.isArray(parsed)) return parsed as AnonymousRecMemoryEntry[];
    } catch {
      /* fall through */
    }
  }
  const fresh = readRaw().slice(-MAX_ENTRIES);
  sessionStorage.setItem(key, JSON.stringify(fresh));
  return fresh;
}

export function clearAnonMemoryRequestSnapshot(sessionId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${SESSION_REQ_PREFIX}${sessionId}`);
}

export function fingerprintAnonPayload(entries: AnonymousRecMemoryEntry[]): string {
  return fingerprintFromEntries(entries);
}

export function buildAnonMemoryHeaders(payload: AnonymousRecMemoryEntry[]): HeadersInit {
  if (payload.length === 0) return {};
  try {
    const json = JSON.stringify(payload);
    const b64 =
      typeof btoa !== "undefined"
        ? btoa(unescape(encodeURIComponent(json)))
        : json;
    return { "X-PickAFlick-Anon-Memory": b64 };
  } catch {
    return {};
  }
}

/** Payload sent to the API (rolling window, newest last) — unfrozen; prefer getAnonMemoryPayloadForSession during a game. */
export function getAnonymousRecMemoryForRequest(): AnonymousRecMemoryEntry[] {
  return readRaw().slice(-MAX_ENTRIES);
}

/** After results are shown, append so the next session excludes these titles/directors. */
export function appendShownRecommendations(
  recs: Recommendation[],
  lane: RecommendationTrack
): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const prev = readRaw();
  const seenKeys = new Set(
    prev.map((e) => `${e.tmdbId ?? ""}:${e.title.toLowerCase().trim()}`)
  );
  const added: AnonymousRecMemoryEntry[] = [];
  for (const r of recs) {
    const key = `${r.movie.tmdbId}:${r.movie.title.toLowerCase().trim()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    added.push({
      title: r.movie.title,
      tmdbId: r.movie.tmdbId,
      director: r.movie.director ?? undefined,
      genres: r.movie.genres?.length ? [...r.movie.genres] : undefined,
      ts: now,
      lane,
    });
  }
  if (added.length === 0) return;
  const merged = [...prev, ...added].slice(-MAX_ENTRIES);
  writeRaw(merged);
}
