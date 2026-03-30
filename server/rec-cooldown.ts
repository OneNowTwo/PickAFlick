import { createHash } from "node:crypto";

/** Rolling hard-ban window: last N served titles (normalized keys). */
export const COOLDOWN_TITLE_MAX = 18;
/** Rolling hard-ban: last N distinct director keys from served rows. */
export const COOLDOWN_DIRECTOR_MAX = 8;
/** Remember injected creative subtype for last N served rows (ban repeating as next injection). */
export const COOLDOWN_ROW_SUBTYPE_MAX = 2;

export interface RecCooldownState {
  titleKeys: string[];
  directorKeys: string[];
  /** One entry per served row: the locked subtype used for that generation. */
  lastRowSubtypes: string[];
}

export function emptyRecCooldownState(): RecCooldownState {
  return { titleKeys: [], directorKeys: [], lastRowSubtypes: [] };
}

export function recCooldownIdentity(sessionId: string, anonFp: string): string {
  return anonFp !== "none" ? `a:${anonFp}` : `s:${sessionId}`;
}

export function recCooldownDbKey(identity: string): string {
  const h = createHash("sha256").update(identity).digest("hex").slice(0, 40);
  return `rec_cooldown_v1_${h}`;
}

export interface CooldownHardSnapshot {
  titleBan: Set<string>;
  directorBan: Set<string>;
  /** Subtypes used on the last rows — must not be chosen again as the locked direction (unless pool exhausted). */
  bannedInjectionSubtypes: string[];
}

export function cooldownHardSnapshot(state: RecCooldownState): CooldownHardSnapshot {
  return {
    titleBan: new Set(state.titleKeys),
    directorBan: new Set(state.directorKeys),
    bannedInjectionSubtypes: [...state.lastRowSubtypes],
  };
}

export function appendServedRow(
  state: RecCooldownState,
  row: { titleKeys: string[]; directorKeys: string[]; injectedSubtype: string }
): RecCooldownState {
  const titleKeys = [...state.titleKeys, ...row.titleKeys]
    .filter(Boolean)
    .slice(-COOLDOWN_TITLE_MAX);
  const directorKeys = [...state.directorKeys, ...row.directorKeys]
    .filter(Boolean)
    .slice(-COOLDOWN_DIRECTOR_MAX);
  const lastRowSubtypes = [...state.lastRowSubtypes, row.injectedSubtype.trim() || "—"]
    .filter(Boolean)
    .slice(-COOLDOWN_ROW_SUBTYPE_MAX);
  return { titleKeys, directorKeys, lastRowSubtypes };
}
