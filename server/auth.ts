import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";

declare global {
  namespace Express {
    interface User {
      id: number;
      googleId: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
    }
  }
}

export function setupAuth(app: Express) {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback";

  if (!clientID || !clientSecret) {
    console.warn("[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
    // Mount stub routes so the frontend doesn't 404 during local dev without credentials
    app.get("/auth/google", (_req, res) => res.status(503).json({ error: "Google OAuth not configured" }));
    app.get("/auth/google/callback", (_req, res) => res.redirect("/?auth_error=not_configured"));
    app.get("/auth/me", (_req, res) => res.json({ user: null }));
    app.post("/auth/logout", (_req, res) => res.json({ success: true }));
    return;
  }

  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL, passReqToCallback: true } as Parameters<typeof GoogleStrategy>[0],
      async (req: Request, _accessToken: string, _refreshToken: string, profile: any, done: any) => {
        try {
          const email = profile.emails?.[0]?.value ?? "";
          const avatarUrl = profile.photos?.[0]?.value ?? null;

          const existing = await db.select().from(users).where(eq(users.googleId, profile.id)).limit(1);

          if (existing.length > 0) {
            (req.session as any)._isNewUser = false;
            return done(null, existing[0]);
          }

          const [created] = await db
            .insert(users)
            .values({ googleId: profile.id, email, displayName: profile.displayName, avatarUrl })
            .returning();

          (req.session as any)._isNewUser = true;
          return done(null, created);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      done(null, user ?? null);
    } catch (err) {
      done(err);
    }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  // Kick off Google OAuth flow
  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

  // Google redirects back here after consent
  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth_error=1" }),
    (_req: Request, res: Response) => {
      const isNew = !!(_req.session as any)._isNewUser;
      delete (_req.session as any)._isNewUser;
      res.redirect(`/?auth_success=1${isNew ? "&new_user=1" : ""}`);
    }
  );

  // Return current user (or null)
  app.get("/auth/me", (req: Request, res: Response) => {
    if (req.isAuthenticated() && req.user) {
      res.json({ user: req.user });
    } else {
      res.json({ user: null });
    }
  });

  // Log out
  app.post("/auth/logout", (req: Request, res: Response) => {
    req.logout(() => {
      res.json({ success: true });
    });
  });
}
