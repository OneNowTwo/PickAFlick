import { useMemo } from "react";

const STORAGE_KEY = "watchlist_session_id";

function generateId(): string {
  return "wl_" + crypto.randomUUID();
}

export function useWatchlistSession(): string {
  return useMemo(() => {
    if (typeof window === "undefined") return "";
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id || id.length < 8) {
      id = generateId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }, []);
}
