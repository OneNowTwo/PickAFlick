import type { Movie } from "@shared/schema";

/** Map free-text genres + TMDB keywords into a coarse “flavour” bucket (subgenre texture). */
export function flavourCluster(movie: Movie): string {
  const blob = `${movie.genres.join(" ")} ${(movie.keywords || []).join(" ")}`.toLowerCase();

  const rules: [RegExp, string][] = [
    [/psychological|mental|paranoi|obsess/i, "psychological"],
    [/serial killer|manhunt|detective|police procedural|investigation|fbi|cop\b|noir/i, "crime_procedural"],
    [/heist|robbery|gangster|mob|cartel|underworld/i, "crime_underworld"],
    [/survival|wilderness|stranded|desert island|snowstorm|trapped/i, "survival"],
    [/sci-fi|science fiction|space|android|alien|dystopi|future/i, "sci_fi"],
    [/horror|supernatural|ghost|demon|occult|exorcist|haunt/i, "horror"],
    [/war|military|soldier|battle|wwii|vietnam/i, "war"],
    [/comedy|satire|parody/i, "comedy"],
    [/romance|love story|affair/i, "romance"],
    [/court|trial|lawyer|legal|lawsuit/i, "legal"],
    [/sport|boxing|racing|olympic/i, "sports"],
    [/music|band|concert|singer|jazz/i, "music"],
    [/western|cowboy|frontier/i, "western"],
    [/biograph|true story|based on real/i, "biopic"],
    [/revenge|vigilante|payback/i, "revenge"],
    [/family drama|domestic|marriage|divorce|grief|mourning/i, "moral_emotional"],
    [/surreal|dreamlike|absurd|kafka/i, "surreal"],
    [/action|chase|explosion|martial|assassin|spy\b/i, "action_driven"],
  ];

  for (const [re, key] of rules) {
    if (re.test(blob)) return key;
  }
  const g0 = movie.genres[0]?.toLowerCase().replace(/\s+/g, "_") || "unknown";
  return `genre_${g0}`;
}

export function decadeCluster(year: number | null): string {
  if (!year || year < 1900) return "unknown";
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

export function regionCluster(movie: Movie): string {
  const lang = (movie.original_language || "en").toLowerCase();
  if (lang && lang !== "en") return "non_english";
  return "english_primary";
}

/** Tone / storytelling mode from keywords. */
export function toneCluster(movie: Movie): string {
  const blob = `${(movie.keywords || []).join(" ")} ${movie.overview || ""}`.toLowerCase();

  if (/police|detective|investigation|procedural|forensic|case file/i.test(blob)) return "procedural";
  if (/surreal|dream|nightmare|hallucin|uncanny|liminal/i.test(blob)) return "surreal";
  if (/revenge|violence|chase|explosion|battle|war|assassin|gunfight|martial arts/i.test(blob))
    return "action_driven";
  if (/love|marriage|grief|loss|family|relationship|affair|loneliness|heartbreak/i.test(blob))
    return "emotional";
  return "general";
}

/**
 * Heuristic: very high TMDB rating + recent English-language fiction often = “top list” obviousness.
 * Used only for indie / left-field (cap 2 per row).
 */
export function isLikelyTopListObvious(movie: Movie): boolean {
  if ((movie.rating ?? 0) < 8.2) return false;
  if (regionCluster(movie) !== "english_primary") return false;
  const y = movie.year ?? 0;
  if (y < 1990 || y > new Date().getFullYear() + 1) return false;
  const g = movie.genres.join(" ").toLowerCase();
  if (/documentary|animation|short/i.test(g)) return false;
  return true;
}

