import { watchlist, sharedRecommendations, type WatchlistItem, type InsertWatchlistItem, type SharedRecommendation } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getWatchlist(): Promise<WatchlistItem[]>;
  addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: number): Promise<void>;
  toggleWatched(id: number, watched: boolean): Promise<WatchlistItem | undefined>;
  getWatchlistByTmdbId(tmdbId: number): Promise<WatchlistItem | undefined>;
  saveSharedRecommendations(shareId: string, recommendations: string, preferenceProfile: string): Promise<SharedRecommendation>;
  getSharedRecommendations(shareId: string): Promise<SharedRecommendation | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getWatchlist(): Promise<WatchlistItem[]> {
    return await db.select().from(watchlist).orderBy(watchlist.createdAt);
  }

  async addToWatchlist(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [result] = await db.insert(watchlist).values(item).returning();
    return result;
  }

  async removeFromWatchlist(id: number): Promise<void> {
    await db.delete(watchlist).where(eq(watchlist.id, id));
  }

  async toggleWatched(id: number, watched: boolean): Promise<WatchlistItem | undefined> {
    const [result] = await db
      .update(watchlist)
      .set({ watched })
      .where(eq(watchlist.id, id))
      .returning();
    return result;
  }

  async getWatchlistByTmdbId(tmdbId: number): Promise<WatchlistItem | undefined> {
    const [result] = await db.select().from(watchlist).where(eq(watchlist.tmdbId, tmdbId));
    return result;
  }

  async saveSharedRecommendations(shareId: string, recommendations: string, preferenceProfile: string): Promise<SharedRecommendation> {
    const [result] = await db.insert(sharedRecommendations).values({
      shareId,
      recommendations,
      preferenceProfile,
    }).returning();
    return result;
  }

  async getSharedRecommendations(shareId: string): Promise<SharedRecommendation | undefined> {
    const [result] = await db.select().from(sharedRecommendations).where(eq(sharedRecommendations.shareId, shareId));
    return result;
  }
}

export const storage = new DatabaseStorage();
