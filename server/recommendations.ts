/**
 * Personalised recommendation engine.
 *
 * Reads a logged-in user's full vote history from user_votes and produces a
 * genre preference profile, then re-ranks an AI-generated recommendation set
 * using a 70/30 split:
 *   • 70 % — best genre-match picks
 *   • 30 % — high-rated films outside their top-3 genres (wildcard picks)
 *
 * Logged-out users are not affected — the caller should skip this module and
 * return AI results as-is.
 */

import { db } from "./db";
import { userVotes } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Recommendation, RecommendationLane } from "@shared/schema";

// ─── Genre profile ───────────────────────────────────────────────────────────

export interface GenreWeight {
  genre: string;
  score: number; // higher = stronger preference
}

/**
 * Build a sorted genre preference profile for a user by tallying their full
 * vote history.  Chosen genres score +2, rejected genres score -1.
 */
export async function buildGenreProfile(userId: number): Promise<GenreWeight[]> {
  const votes = await db
    .select()
    .from(userVotes)
    .where(eq(userVotes.userId, userId));

  if (votes.length === 0) return [];

  const tally = new Map<string, { chosen: number; rejected: number }>();

  for (const vote of votes) {
    for (const genre of vote.chosenGenres) {
      const curr = tally.get(genre) ?? { chosen: 0, rejected: 0 };
      curr.chosen++;
      tally.set(genre, curr);
    }
    for (const genre of vote.rejectedGenres) {
      const curr = tally.get(genre) ?? { chosen: 0, rejected: 0 };
      curr.rejected++;
      tally.set(genre, curr);
    }
  }

  return Array.from(tally.entries())
    .map(([genre, { chosen, rejected }]) => ({
      genre,
      // Chosen weighted 2x — a positive choice is a stronger signal than a rejection
      score: chosen * 2 - rejected,
    }))
    .filter(({ score }) => score > 0) // only genres with net-positive signal
    .sort((a, b) => b.score - a.score);
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

/** Normalised genre-match score for a single recommendation (0–1 range). */
function matchScore(genres: string[], profile: GenreWeight[]): number {
  if (profile.length === 0 || genres.length === 0) return 0;
  const maxPossible = profile.slice(0, 3).reduce((s, p) => s + p.score, 0) || 1;
  return genres.reduce((total, genre) => {
    const entry = profile.find((p) => p.genre === genre);
    return total + (entry ? entry.score : 0);
  }, 0) / maxPossible;
}

export interface RankedRecommendation extends Recommendation {
  wildcardBadge?: string;
}

/**
 * Re-rank a list of AI recommendations using the user's genre profile.
 *
 * - Top portion (by genre match score) are returned first — split ratio depends on lane.
 * - Bottom portion are returned after, labelled as wildcards if they are both
 *   high-rated (≥ 7.5) AND outside the user's top-3 genres.
 *
 * The original AI ordering is used as a tiebreaker so relative quality
 * ordering is preserved within each bucket.
 */
function matchSplitRatio(lane: RecommendationLane | undefined): number {
  switch (lane) {
    case "movie_buff":
      return 0.78;
    case "left_field":
      return 0.52;
    case "mainstream":
    default:
      return 0.7;
  }
}

export function rankRecommendations(
  recommendations: Recommendation[],
  profile: GenreWeight[],
  lane?: RecommendationLane
): RankedRecommendation[] {
  if (profile.length === 0 || recommendations.length === 0) {
    return recommendations as RankedRecommendation[];
  }

  const top3 = new Set(profile.slice(0, 3).map((p) => p.genre));
  const splitAt = Math.ceil(recommendations.length * matchSplitRatio(lane));

  const scored = recommendations.map((rec, originalIndex) => ({
    rec,
    originalIndex,
    score: matchScore(rec.movie.genres, profile),
    isOutsideTop3: !rec.movie.genres.some((g) => top3.has(g)),
    isHighRated: (rec.movie.rating ?? 0) >= 7.5,
  }));

  // Sort by match score descending; preserve original order as tiebreaker
  scored.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

  const matched = scored.slice(0, splitAt);
  const wild = scored.slice(splitAt);

  const result: RankedRecommendation[] = [
    ...matched.map(({ rec }) => rec as RankedRecommendation),
    ...wild.map(({ rec, isOutsideTop3, isHighRated }) => ({
      ...(rec as RankedRecommendation),
      wildcardBadge:
        isOutsideTop3 && isHighRated
          ? "Outside your usual taste — but highly rated"
          : undefined,
    })),
  ];

  return result;
}
