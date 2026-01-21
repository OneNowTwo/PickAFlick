import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { getCatalogue, getRecommendations, getHealth, initCatalogue, isCatalogueReady, getRandomMoviePair } from "./catalogue";
import { getMovieTrailer } from "./tmdb";
import { sessionStorage } from "./session-storage";
import { generateRecommendations } from "./ai-recommender";
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
  app.post("/api/session/start", async (_req: Request, res: Response) => {
    try {
      if (!isCatalogueReady()) {
        res.status(503).json({ error: "Catalogue is still loading. Please try again shortly." });
        return;
      }

      const session = sessionStorage.createSession();
      
      // Generate first pair
      const pair = getRandomMoviePair();
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
        const response: RoundPairResponse = {
          sessionId,
          round: session.currentRound,
          totalRounds: session.totalRounds,
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
        // Generate new pair for current round
        const usedIds = new Set(
          session.choices.flatMap((c) => [c.leftMovie.id, c.rightMovie.id])
        );
        const pair = getRandomMoviePair(usedIds);
        
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

      const response: RoundPairResponse = {
        sessionId,
        round: session.currentRound,
        totalRounds: session.totalRounds,
        leftMovie: currentPair.leftMovie,
        rightMovie: currentPair.rightMovie,
        isComplete: false,
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
        const pair = getRandomMoviePair(usedIds);
        
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

  return httpServer;
}
