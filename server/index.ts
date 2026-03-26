import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth } from "./auth";
import { pool } from "./db";

const PgSession = connectPgSimple(session);

const app = express();
const httpServer = createServer(app);

// Required for secure cookies to work behind Render's HTTPS proxy
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
    }),
    secret: process.env.SESSION_SECRET || "pickaflick-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "lax" : false,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

setupAuth(app);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Ensure all required tables exist before starting (safe to run on every startup)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS session_id TEXT;
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        CONSTRAINT user_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire);
      CREATE TABLE IF NOT EXISTS user_votes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        chosen_tmdb_id INTEGER NOT NULL,
        rejected_tmdb_id INTEGER NOT NULL,
        chosen_title TEXT NOT NULL,
        rejected_title TEXT NOT NULL,
        chosen_genres TEXT[] NOT NULL DEFAULT '{}',
        rejected_genres TEXT[] NOT NULL DEFAULT '{}',
        voted_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_votes_user_id ON user_votes (user_id);
      CREATE INDEX IF NOT EXISTS idx_user_votes_session_id ON user_votes (session_id);
    `);
    console.log("[startup] Schema check complete");
  } catch (err) {
    console.error("[startup] Schema check failed:", err);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const SERVER_START_ID = Math.random().toString(36).substring(2, 8);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      console.log(`\n🚀 ========================================`);
      console.log(`🚀 SERVER STARTED - ID: ${SERVER_START_ID}`);
      console.log(`🚀 Port: ${port}`);
      console.log(`🚀 Time: ${new Date().toISOString()}`);
      console.log(`🚀 ========================================\n`);
      log(`serving on port ${port}`);
    },
  );
})();
