import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { getCatalogue, getRecommendations, getHealth, initCatalogue, isCatalogueReady } from "./catalogue";
import { getMovieTrailer } from "./tmdb";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  initCatalogue().catch((error) => {
    console.error("Failed to initialize catalogue:", error);
  });

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

  return httpServer;
}
