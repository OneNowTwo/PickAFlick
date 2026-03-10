import { useMemo } from "react";

const COOKIE_NAME = "wl_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

function generateId(): string {
  return "wl_" + crypto.randomUUID();
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

function setCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

export function useWatchlistSession(): string {
  return useMemo(() => {
    if (typeof window === "undefined") return "";

    // Try cookie first (survives private mode, page reloads, browser restarts)
    let id = getCookie(COOKIE_NAME);

    // Fall back to localStorage for users who already have a saved session there
    if (!id || id.length < 8) {
      const lsId = localStorage.getItem("watchlist_session_id");
      if (lsId && lsId.length >= 8) {
        id = lsId;
        // Migrate: promote the existing localStorage ID into a cookie so it persists
        setCookie(COOKIE_NAME, id, COOKIE_MAX_AGE);
      }
    }

    // No existing session anywhere — generate a fresh one
    if (!id || id.length < 8) {
      id = generateId();
      setCookie(COOKIE_NAME, id, COOKIE_MAX_AGE);
      // Also write to localStorage as a belt-and-braces backup
      try {
        localStorage.setItem("watchlist_session_id", id);
      } catch {
        // localStorage unavailable (private mode etc.) — cookie is enough
      }
    }

    return id;
  }, []);
}
