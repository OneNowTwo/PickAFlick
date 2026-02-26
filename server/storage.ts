import { watchlist, sharedRecommendations, movieCatalogueCache, type WatchlistItem, type InsertWatchlistItem, type SharedRecommendation, type MovieCatalogueCache } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

/** Bump when adding new IMDb/editorial lists - invalidates old cache so catalogue rebuilds on deploy */
const CATALOGUE_CACHE_KEY = "catalogue_v2";

export interface IStorage {
  getWatchlist(sessionId: string): Promise<WatchlistItem[]>;
  addToWatchlist(item: InsertWatchlistItem & { sessionId: string }): Promise<WatchlistItem>;
  removeFromWatchlist(id: number, sessionId: string): Promise<void>;
  toggleWatched(id: number, watched: boolean, sessionId: string): Promise<WatchlistItem | undefined>;
  getWatchlistByTmdbId(tmdbId: number, sessionId: string): Promise<WatchlistItem | undefined>;
  saveSharedRecommendations(shareId: string, recommendations: string, preferenceProfile: string): Promise<SharedRecommendation>;
  getSharedRecommendations(shareId: string): Promise<SharedRecommendation | undefined>;
  getCatalogueCache(): Promise<MovieCatalogueCache | undefined>;
  saveCatalogueCache(movies: string, grouped: string): Promise<void>;
  clearCatalogueCache(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getWatchlist(sessionId: string): Promise<WatchlistItem[]> {
    return await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.sessionId, sessionId))
      .orderBy(watchlist.createdAt);
  }

  async addToWatchlist(item: InsertWatchlistItem & { sessionId: string }): Promise<WatchlistItem> {
    const [result] = await db.insert(watchlist).values(item).returning();
    return result;
  }

  async removeFromWatchlist(id: number, sessionId: string): Promise<void> {
    await db
      .delete(watchlist)
      .where(and(eq(watchlist.id, id), eq(watchlist.sessionId, sessionId)));
  }

  async toggleWatched(id: number, watched: boolean, sessionId: string): Promise<WatchlistItem | undefined> {
    const [result] = await db
      .update(watchlist)
      .set({ watched })
      .where(and(eq(watchlist.id, id), eq(watchlist.sessionId, sessionId)))
      .returning();
    return result;
  }

  async getWatchlistByTmdbId(tmdbId: number, sessionId: string): Promise<WatchlistItem | undefined> {
    const [result] = await db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.tmdbId, tmdbId), eq(watchlist.sessionId, sessionId)));
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

  async getCatalogueCache(): Promise<MovieCatalogueCache | undefined> {
    const [result] = await db.select().from(movieCatalogueCache).where(eq(movieCatalogueCache.cacheKey, CATALOGUE_CACHE_KEY));
    return result;
  }

  async saveCatalogueCache(movies: string, grouped: string): Promise<void> {
    const existing = await this.getCatalogueCache();
    if (existing) {
      await db.update(movieCatalogueCache)
        .set({ movies, grouped, updatedAt: new Date() })
        .where(eq(movieCatalogueCache.cacheKey, CATALOGUE_CACHE_KEY));
    } else {
      await db.insert(movieCatalogueCache).values({
        cacheKey: CATALOGUE_CACHE_KEY,
        movies,
        grouped,
      });
    }
  }

  async clearCatalogueCache(): Promise<void> {
    await db.delete(movieCatalogueCache).where(eq(movieCatalogueCache.cacheKey, CATALOGUE_CACHE_KEY));
  }
}

export const storage = new DatabaseStorage();
