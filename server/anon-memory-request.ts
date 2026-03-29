import { createHash } from "node:crypto";
import type { Request } from "express";
import {
  anonymousRecMemoryPayloadSchema,
  type AnonymousRecMemoryEntry,
} from "@shared/anonymous-rec-memory";

export function parseAnonymousRecMemoryFromRequest(req: Request): AnonymousRecMemoryEntry[] {
  const raw =
    req.headers["x-pickaflick-anon-memory"] ??
    req.headers["X-PickAFlick-Anon-Memory"];
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || typeof s !== "string") return [];
  try {
    const json = Buffer.from(s, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    const r = anonymousRecMemoryPayloadSchema.safeParse(parsed);
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

/** Stable per-browser memory fingerprint so lane cache matches request exclusions. */
export function anonFingerprint(entries: AnonymousRecMemoryEntry[]): string {
  if (entries.length === 0) return "none";
  const parts = entries
    .map((e) => `${e.tmdbId ?? ""}:${e.title.toLowerCase().trim()}`)
    .sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 24);
}
