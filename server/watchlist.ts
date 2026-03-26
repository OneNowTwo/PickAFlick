import type { Express, Request, Response } from "express";
import { db } from "./db";
import { userWatchlist } from "@shared/schema";
import { eq, and } from "drizzle-orm";

function requireAuth(req: Request, res: Response): boolean {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}

export function setupWatchlistRoutes(app: Express) {
  // GET /api/watchlist — all items for the logged-in user
  app.get("/api/watchlist", async (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    try {
      const items = await db
        .select()
        .from(userWatchlist)
        .where(eq(userWatchlist.userId, req.user!.id))
        .orderBy(userWatchlist.addedAt);
      res.json(items);
    } catch (err) {
      console.error("[watchlist] GET error:", err);
      res.status(500).json({ error: "Failed to fetch watchlist" });
    }
  });

  // POST /api/watchlist — add a movie (ignore duplicate)
  app.post("/api/watchlist", async (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    try {
      const { tmdbId, title, posterPath, releaseYear, genres } = req.body;
      if (!tmdbId || !title) {
        res.status(400).json({ error: "tmdbId and title are required" });
        return;
      }

      // Idempotent — return existing row if already saved
      const [existing] = await db
        .select()
        .from(userWatchlist)
        .where(and(eq(userWatchlist.userId, req.user!.id), eq(userWatchlist.tmdbId, Number(tmdbId))))
        .limit(1);

      if (existing) {
        res.json(existing);
        return;
      }

      const [item] = await db
        .insert(userWatchlist)
        .values({
          userId: req.user!.id,
          tmdbId: Number(tmdbId),
          title: String(title),
          posterPath: posterPath ?? null,
          releaseYear: releaseYear ? Number(releaseYear) : null,
          genres: Array.isArray(genres) ? genres : [],
        })
        .returning();

      res.status(201).json(item);
    } catch (err) {
      console.error("[watchlist] POST error:", err);
      res.status(500).json({ error: "Failed to add to watchlist" });
    }
  });

  // DELETE /api/watchlist/:tmdb_id — remove a movie
  app.delete("/api/watchlist/:tmdb_id", async (req: Request, res: Response) => {
    if (!requireAuth(req, res)) return;
    try {
      const tmdbId = Number(req.params.tmdb_id);
      if (isNaN(tmdbId)) {
        res.status(400).json({ error: "Invalid tmdb_id" });
        return;
      }
      await db
        .delete(userWatchlist)
        .where(and(eq(userWatchlist.userId, req.user!.id), eq(userWatchlist.tmdbId, tmdbId)));
      res.json({ success: true });
    } catch (err) {
      console.error("[watchlist] DELETE error:", err);
      res.status(500).json({ error: "Failed to remove from watchlist" });
    }
  });
}
