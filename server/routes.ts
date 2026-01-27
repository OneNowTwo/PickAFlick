import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { getCatalogue, getRecommendations, getHealth, initCatalogue, isCatalogueReady, getCatalogueStatus, getRandomMoviePair, getRandomMoviePairFiltered } from "./catalogue";
import { getMovieTrailer, getWatchProviders } from "./tmdb";
import { sessionStorage } from "./session-storage";
import { generateRecommendations, generateReplacementRecommendation } from "./ai-recommender";
import { storage } from "./storage";
import type { RoundPairResponse, ChoiceResponse } from "@shared/schema";
import { insertWatchlistSchema } from "@shared/schema";
import { z } from "zod";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

// Store movie pairs per session to ensure consistency
const sessionPairs = new Map<string, { round: number; leftMovie: any; rightMovie: any }>();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  initCatalogue().catch((error) => {
    console.error("Failed to initialize catalogue:", error);
  });

  // ===== NEW SESSION-BASED GAME ENDPOINTS =====

  // Start a new game session
  app.post("/api/session/start", async (req: Request, res: Response) => {
    try {
      const catalogueStatus = getCatalogueStatus();
      
      if (catalogueStatus.loading) {
        res.status(503).json({ error: "Movies are still loading. Please wait a moment and try again." });
        return;
      }
      
      if (catalogueStatus.error || !catalogueStatus.ready) {
        res.status(503).json({ 
          error: catalogueStatus.error || "Failed to load movies. Please try refreshing the page.",
          canRetry: true
        });
        return;
      }

      // Parse genre filters from request
      const genres = Array.isArray(req.body?.genres) ? req.body.genres : [];
      const includeTopPicks = req.body?.includeTopPicks === true;
      const includeNewReleases = req.body?.includeNewReleases === true;

      const session = sessionStorage.createSession(genres, includeTopPicks, includeNewReleases);
      
      // Generate first pair using filters
      const pair = getRandomMoviePairFiltered(genres, includeTopPicks, new Set(), includeNewReleases);
      if (!pair) {
        res.status(500).json({ error: "Not enough movies available" });
        return;
      }

      sessionPairs.set(session.sessionId, {
        round: 1,
        leftMovie: pair[0],
        rightMovie: pair[1],
      });

      res.set(NO_CACHE_HEADERS);
      res.json({
        sessionId: session.sessionId,
        totalRounds: session.totalRounds,
      });
    } catch (error) {
      console.error("Error starting session:", error);
      res.status(500).json({ error: "Failed to start session" });
    }
  });

  // Get current round's movie pair
  app.get("/api/session/:sessionId/round", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionStorage.getSession(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (session.isComplete) {
        const baseTotalRounds = sessionStorage.getBaseTotalRounds(sessionId);
        const response: RoundPairResponse = {
          sessionId,
          round: session.currentRound,
          totalRounds: session.totalRounds,
          baseTotalRounds,
          choicesMade: session.choices.length,
          leftMovie: session.choices[session.choices.length - 1].leftMovie,
          rightMovie: session.choices[session.choices.length - 1].rightMovie,
          isComplete: true,
        };
        res.set(NO_CACHE_HEADERS);
        res.json(response);
        return;
      }

      // Check if we already have a pair for this round
      let currentPair = sessionPairs.get(sessionId);
      
      if (!currentPair || currentPair.round !== session.currentRound) {
        // Generate new pair for current round using session filters
        const usedIds = new Set(
          session.choices.flatMap((c) => [c.leftMovie.id, c.rightMovie.id])
        );
        const filters = sessionStorage.getSessionFilters(sessionId);
        const pair = filters 
          ? getRandomMoviePairFiltered(filters.genres, filters.includeTopPicks, usedIds, filters.includeNewReleases)
          : getRandomMoviePair(usedIds);
        
        if (!pair) {
          res.status(500).json({ error: "Not enough movies available" });
          return;
        }

        currentPair = {
          round: session.currentRound,
          leftMovie: pair[0],
          rightMovie: pair[1],
        };
        sessionPairs.set(sessionId, currentPair);
      }

      // Build choice history for insights
      const choiceHistory = session.choices.map(choice => ({
        round: choice.round,
        chosenMovie: choice.chosenMovieId === choice.leftMovie.id ? choice.leftMovie : choice.rightMovie,
        rejectedMovie: choice.chosenMovieId === choice.leftMovie.id ? choice.rightMovie : choice.leftMovie,
      }));

      const baseTotalRounds = sessionStorage.getBaseTotalRounds(sessionId);
      const response: RoundPairResponse = {
        sessionId,
        round: session.currentRound,
        totalRounds: session.totalRounds,
        baseTotalRounds,
        choicesMade: session.choices.length,
        leftMovie: currentPair.leftMovie,
        rightMovie: currentPair.rightMovie,
        isComplete: false,
        choiceHistory,
      };

      res.set(NO_CACHE_HEADERS);
      res.json(response);
    } catch (error) {
      console.error("Error getting round:", error);
      res.status(500).json({ error: "Failed to get round" });
    }
  });

  // Submit a choice for current round
  app.post("/api/session/:sessionId/choose", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { chosenMovieId } = req.body;

      if (typeof chosenMovieId !== "number") {
        res.status(400).json({ error: "chosenMovieId must be a number" });
        return;
      }

      const session = sessionStorage.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (session.isComplete) {
        res.status(400).json({ error: "Session is already complete" });
        return;
      }

      const currentPair = sessionPairs.get(sessionId);
      if (!currentPair || currentPair.round !== session.currentRound) {
        res.status(400).json({ error: "No active pair for this round" });
        return;
      }

      // Validate the chosen movie is one of the pair
      if (chosenMovieId !== currentPair.leftMovie.id && chosenMovieId !== currentPair.rightMovie.id) {
        res.status(400).json({ error: "Invalid movie choice" });
        return;
      }

      // Record the choice
      const updatedSession = sessionStorage.addChoice(
        sessionId,
        session.currentRound,
        currentPair.leftMovie,
        currentPair.rightMovie,
        chosenMovieId
      );

      if (!updatedSession) {
        res.status(500).json({ error: "Failed to record choice" });
        return;
      }

      // Prepare next pair if not complete
      if (!updatedSession.isComplete) {
        const usedIds = new Set(
          updatedSession.choices.flatMap((c) => [c.leftMovie.id, c.rightMovie.id])
        );
        const filters = sessionStorage.getSessionFilters(sessionId);
        const pair = filters 
          ? getRandomMoviePairFiltered(filters.genres, filters.includeTopPicks, usedIds, filters.includeNewReleases)
          : getRandomMoviePair(usedIds);
        
        if (pair) {
          sessionPairs.set(sessionId, {
            round: updatedSession.currentRound,
            leftMovie: pair[0],
            rightMovie: pair[1],
          });
        }
      }

      const response: ChoiceResponse = {
        success: true,
        nextRound: updatedSession.isComplete ? null : updatedSession.currentRound,
        isComplete: updatedSession.isComplete,
      };

      res.set(NO_CACHE_HEADERS);
      res.json(response);
    } catch (error) {
      console.error("Error recording choice:", error);
      res.status(500).json({ error: "Failed to record choice" });
    }
  });

  // Skip current round (adds +1 round to session)
  app.post("/api/session/:sessionId/skip", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionStorage.getSession(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (session.isComplete) {
        res.status(400).json({ error: "Session already complete" });
        return;
      }

      // Add an extra round as the "cost" of skipping
      const updatedSession = sessionStorage.addRound(sessionId);
      if (!updatedSession) {
        res.status(500).json({ error: "Failed to update session" });
        return;
      }

      // Generate a new pair for the current round (replacing the skipped one)
      const usedIds = new Set(
        session.choices.flatMap((c) => [c.leftMovie.id, c.rightMovie.id])
      );
      
      // Also exclude the current pair from the new selection
      const currentPair = sessionPairs.get(sessionId);
      if (currentPair) {
        usedIds.add(currentPair.leftMovie.id);
        usedIds.add(currentPair.rightMovie.id);
      }

      const filters = sessionStorage.getSessionFilters(sessionId);
      const pair = filters 
        ? getRandomMoviePairFiltered(filters.genres, filters.includeTopPicks, usedIds)
        : getRandomMoviePair(usedIds);

      if (!pair) {
        res.status(500).json({ error: "Not enough movies to skip" });
        return;
      }

      sessionPairs.set(sessionId, {
        round: session.currentRound,
        leftMovie: pair[0],
        rightMovie: pair[1],
      });

      res.set(NO_CACHE_HEADERS);
      res.json({
        success: true,
        round: session.currentRound,
        totalRounds: updatedSession.totalRounds,
        leftMovie: pair[0],
        rightMovie: pair[1],
      });
    } catch (error) {
      console.error("Error skipping round:", error);
      res.status(500).json({ error: "Failed to skip round" });
    }
  });

  // Get AI recommendations after completing all rounds
  app.get("/api/session/:sessionId/recommendations", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = sessionStorage.getSession(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (!session.isComplete) {
        res.status(400).json({ error: "Complete all rounds first" });
        return;
      }

      const chosenMovies = sessionStorage.getChosenMovies(sessionId);
      
      if (chosenMovies.length === 0) {
        res.status(400).json({ error: "No choices recorded" });
        return;
      }

      const recommendations = await generateRecommendations(chosenMovies);

      res.set(NO_CACHE_HEADERS);
      res.json(recommendations);
    } catch (error) {
      console.error("Error generating recommendations:", error);
      res.status(500).json({ error: "Failed to generate recommendations" });
    }
  });

  // Get a replacement recommendation when user marks one as "seen it"
  app.post("/api/session/:sessionId/replacement", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { excludeTmdbIds } = req.body;

      if (!Array.isArray(excludeTmdbIds)) {
        res.status(400).json({ error: "excludeTmdbIds must be an array" });
        return;
      }

      const session = sessionStorage.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const chosenMovies = sessionStorage.getChosenMovies(sessionId);
      if (chosenMovies.length === 0) {
        res.status(400).json({ error: "No choices recorded" });
        return;
      }

      const replacement = await generateReplacementRecommendation(chosenMovies, excludeTmdbIds);
      
      if (!replacement) {
        res.status(404).json({ error: "No replacement available" });
        return;
      }

      res.set(NO_CACHE_HEADERS);
      res.json(replacement);
    } catch (error) {
      console.error("Error generating replacement:", error);
      res.status(500).json({ error: "Failed to generate replacement" });
    }
  });

  // ===== LEGACY ENDPOINTS (kept for backwards compatibility) =====

  app.get("/api/catalogue", async (req: Request, res: Response) => {
    try {
      if (!isCatalogueReady()) {
        res.status(503).json({ error: "Catalogue is still loading. Please try again shortly." });
        return;
      }

      const grouped = req.query.grouped === "1";
      const catalogue = getCatalogue(grouped);
      
      res.set(NO_CACHE_HEADERS);
      res.json(catalogue);
    } catch (error) {
      console.error("Error fetching catalogue:", error);
      res.status(500).json({ error: "Failed to fetch catalogue" });
    }
  });

  app.get("/api/recs", async (req: Request, res: Response) => {
    try {
      if (!isCatalogueReady()) {
        res.status(503).json({ error: "Catalogue is still loading. Please try again shortly." });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 6, 20);
      const recommendations = getRecommendations(limit);
      
      res.set(NO_CACHE_HEADERS);
      res.json({ movies: recommendations });
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  app.get("/api/trailers", async (req: Request, res: Response) => {
    try {
      const idsParam = req.query.ids as string;
      
      if (!idsParam) {
        res.status(400).json({ error: "Missing ids parameter" });
        return;
      }

      const ids = idsParam.split(",").map((id) => parseInt(id.trim())).filter((id) => !isNaN(id));
      
      if (ids.length === 0) {
        res.status(400).json({ error: "No valid ids provided" });
        return;
      }

      const trailers: Record<string, string | null> = {};
      
      await Promise.all(
        ids.map(async (id) => {
          trailers[id.toString()] = await getMovieTrailer(id);
        })
      );
      
      res.set(NO_CACHE_HEADERS);
      res.json(trailers);
    } catch (error) {
      console.error("Error fetching trailers:", error);
      res.status(500).json({ error: "Failed to fetch trailers" });
    }
  });

  app.get("/api/catalogue-all", async (_req: Request, res: Response) => {
    try {
      const health = getHealth();
      res.json(health);
    } catch (error) {
      console.error("Error fetching health:", error);
      res.status(500).json({ error: "Failed to fetch health status" });
    }
  });

  // Get catalogue status for frontend loading state
  app.get("/api/catalogue-status", async (_req: Request, res: Response) => {
    try {
      const status = getCatalogueStatus();
      res.json(status);
    } catch (error) {
      console.error("Error fetching catalogue status:", error);
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  // Get watch providers for a movie (where to watch in Australia)
  app.get("/api/watch-providers/:tmdbId", async (req: Request, res: Response) => {
    try {
      const tmdbId = parseInt(req.params.tmdbId);
      if (isNaN(tmdbId)) {
        res.status(400).json({ error: "Invalid TMDb ID" });
        return;
      }

      const providers = await getWatchProviders(tmdbId);
      res.json(providers);
    } catch (error) {
      console.error("Error fetching watch providers:", error);
      res.status(500).json({ error: "Failed to fetch watch providers" });
    }
  });

  // ===== WATCHLIST ENDPOINTS =====

  // Get all watchlist items
  app.get("/api/watchlist", async (_req: Request, res: Response) => {
    try {
      const items = await storage.getWatchlist();
      res.json(items);
    } catch (error) {
      console.error("Error fetching watchlist:", error);
      res.status(500).json({ error: "Failed to fetch watchlist" });
    }
  });

  // Add movie to watchlist
  app.post("/api/watchlist", async (req: Request, res: Response) => {
    try {
      const parseResult = insertWatchlistSchema.safeParse({
        tmdbId: req.body.tmdbId,
        title: req.body.title,
        year: req.body.year || null,
        posterPath: req.body.posterPath || null,
        genres: req.body.genres || [],
        rating: req.body.rating ? Math.round(req.body.rating * 10) : null,
        watched: false,
      });

      if (!parseResult.success) {
        res.status(400).json({ error: "Invalid request body", details: parseResult.error.flatten() });
        return;
      }

      // Check if already in watchlist
      const existing = await storage.getWatchlistByTmdbId(parseResult.data.tmdbId);
      if (existing) {
        res.json(existing);
        return;
      }

      const item = await storage.addToWatchlist(parseResult.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Error adding to watchlist:", error);
      res.status(500).json({ error: "Failed to add to watchlist" });
    }
  });

  // Remove movie from watchlist
  app.delete("/api/watchlist/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }

      await storage.removeFromWatchlist(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing from watchlist:", error);
      res.status(500).json({ error: "Failed to remove from watchlist" });
    }
  });

  // Toggle watched status
  app.patch("/api/watchlist/:id/watched", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { watched } = req.body;

      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }

      if (typeof watched !== "boolean") {
        res.status(400).json({ error: "watched must be a boolean" });
        return;
      }

      const item = await storage.toggleWatched(id, watched);
      if (!item) {
        res.status(404).json({ error: "Item not found" });
        return;
      }

      res.json(item);
    } catch (error) {
      console.error("Error toggling watched:", error);
      res.status(500).json({ error: "Failed to toggle watched status" });
    }
  });

  // Check if movie is in watchlist
  app.get("/api/watchlist/check/:tmdbId", async (req: Request, res: Response) => {
    try {
      const tmdbId = parseInt(req.params.tmdbId);
      if (isNaN(tmdbId)) {
        res.status(400).json({ error: "Invalid tmdbId" });
        return;
      }

      const item = await storage.getWatchlistByTmdbId(tmdbId);
      res.json({ inWatchlist: !!item, item: item || null });
    } catch (error) {
      console.error("Error checking watchlist:", error);
      res.status(500).json({ error: "Failed to check watchlist" });
    }
  });

  // ===== SHARE ENDPOINTS =====

  // Save recommendations for sharing
  app.post("/api/share", async (req: Request, res: Response) => {
    try {
      const { recommendations, preferenceProfile } = req.body;

      if (!recommendations || !preferenceProfile) {
        res.status(400).json({ error: "Missing recommendations or preferenceProfile" });
        return;
      }

      // Generate unique share ID (8 characters)
      const shareId = Math.random().toString(36).substring(2, 10);

      await storage.saveSharedRecommendations(
        shareId,
        JSON.stringify(recommendations),
        JSON.stringify(preferenceProfile)
      );

      res.json({ shareId });
    } catch (error) {
      console.error("Error saving shared recommendations:", error);
      res.status(500).json({ error: "Failed to save shared recommendations" });
    }
  });

  // Get shared recommendations
  app.get("/api/share/:shareId", async (req: Request, res: Response) => {
    try {
      const { shareId } = req.params;

      const shared = await storage.getSharedRecommendations(shareId);
      if (!shared) {
        res.status(404).json({ error: "Shared recommendations not found" });
        return;
      }

      res.json({
        recommendations: JSON.parse(shared.recommendations),
        preferenceProfile: JSON.parse(shared.preferenceProfile),
        createdAt: shared.createdAt,
      });
    } catch (error) {
      console.error("Error getting shared recommendations:", error);
      res.status(500).json({ error: "Failed to get shared recommendations" });
    }
  });

  return httpServer;
}
