import { createHash } from "node:crypto";
import type { SessionMoodProfile } from "./session-mood-profile";
import type { CooldownHardSnapshot } from "./rec-cooldown";

/** Locked creative channels for high-tension / intense moods. */
export const INTENSITY_SUBTYPES = [
  "paranoid thriller",
  "procedural tension",
  "moral pressure",
  "survival dread",
  "psychological collapse",
  "surreal dread",
  "revenge pressure-cooker",
  "political tension",
] as const;

const WARM_SUBTYPES = [
  "gentle humanist warmth",
  "low-stakes comfort rhythm",
  "found-family / belonging",
  "quiet joy and small victories",
  "nostalgic tenderness",
] as const;

const COMEDY_SUBTYPES = [
  "wit and verbal spar",
  "cringe or awkward truth",
  "absurdist left-turn",
  "romantic comedy friction",
  "dark comedy moral mess",
] as const;

const ROMANCE_SUBTYPES = [
  "slow-burn longing",
  "sparky meet-chemistry",
  "love after loss",
  "forbidden or impossible pull",
  "mature partnership realism",
] as const;

const DEFAULT_SUBTYPES = [
  "character-led moral choice",
  "genre twist on familiar mood",
  "unusual setting as story engine",
  "ensemble friction",
  "time or structure experiment",
  "underdog momentum",
] as const;

function moodBlob(m: SessionMoodProfile): string {
  return [
    m.preferred_tone,
    m.rejected_tone,
    m.darkness_level,
    m.emotional_texture,
    m.pacing,
    ...(m.what_they_want || []),
    ...(m.what_they_avoid || []),
  ]
    .join(" ")
    .toLowerCase();
}

export function detectMoodSubtypeCategory(mood: SessionMoodProfile): "intense" | "warm" | "comedy" | "romance" | "default" {
  const b = moodBlob(mood);
  if (
    /\b(intense|tension|thrill|dark|dread|fear|violent|grit|anxious|paranoi|pressure|suspense|horror|survival)\b/i.test(
      b
    )
  ) {
    return "intense";
  }
  if (/\b(warm|cozy|comfort|heart|uplift|hope|gentle|light|feel-good)\b/i.test(b)) return "warm";
  if (/\b(comedy|funny|humor|laugh|wit|satir)\b/i.test(b)) return "comedy";
  if (/\b(romance|love|relationship|couple)\b/i.test(b)) return "romance";
  return "default";
}

function poolForCategory(cat: ReturnType<typeof detectMoodSubtypeCategory>): readonly string[] {
  switch (cat) {
    case "intense":
      return INTENSITY_SUBTYPES;
    case "warm":
      return WARM_SUBTYPES;
    case "comedy":
      return COMEDY_SUBTYPES;
    case "romance":
      return ROMANCE_SUBTYPES;
    default:
      return DEFAULT_SUBTYPES;
  }
}

function stablePickIndex(seed: string, modulo: number): number {
  const h = createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0) % modulo;
}

/**
 * One locked subtype per session generation, deterministic, rotating away from last rows' subtypes.
 */
export function pickSessionSubtype(
  mood: SessionMoodProfile,
  bannedInjectionSubtypes: string[],
  sessionId: string
): string {
  const cat = detectMoodSubtypeCategory(mood);
  const pool = poolForCategory(cat);
  const banned = new Set(bannedInjectionSubtypes.map((s) => s.trim().toLowerCase()).filter(Boolean));
  let candidates = pool.filter((s) => !banned.has(s.toLowerCase()));
  if (candidates.length === 0) candidates = [...pool];

  const seed = `${sessionId}|${mood.preferred_tone}|${bannedInjectionSubtypes.join(",")}|${cat}`;
  const idx = stablePickIndex(seed, candidates.length);
  return candidates[idx] ?? candidates[0] ?? "mixed expressions";
}

export function buildLockedSubtypePromptBlock(
  chosenSubtype: string,
  snapshot: CooldownHardSnapshot
): string {
  const recent = snapshot.bannedInjectionSubtypes.filter(Boolean);
  const recentLine =
    recent.length > 0
      ? `These creative shelves were already used for the user's last rows — do NOT make the pool feel like a rerun of them (different angles, different films): ${recent.join("; ")}.`
      : "";

  return (
    `## LOCKED CREATIVE DIRECTION (HARD — obey before everything except banned_titles)\n\n` +
    `The mood in taste_profile must be expressed **primarily through this single channel**: **${chosenSubtype}**.\n` +
    `- Every pick's "tag" must name this same channel (or a clear facet of it), and "reason" must tie the film to **${chosenSubtype}** — not a generic "intense" or "great thriller" shelf.\n` +
    `- Do not drift back to the default prestige-crime / critic-canon mental shelf; stay inside **${chosenSubtype}** while varying films, eras, countries, and directors.\n` +
    (recentLine ? `${recentLine}\n` : "") +
    `\nIf you ignore the locked channel and output a generic prestige cluster, the response is invalid.`
  );
}
