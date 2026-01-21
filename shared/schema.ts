import { z } from "zod";
import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Watchlist table for persisting liked movies
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  tmdbId: integer("tmdb_id").notNull(),
  title: text("title").notNull(),
  year: integer("year"),
  posterPath: text("poster_path"),
  genres: text("genres").array().notNull().default([]),
  rating: integer("rating"),
  watched: boolean("watched").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true, createdAt: true });
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type WatchlistItem = typeof watchlist.$inferSelect;

// Movie schema with extended metadata for preference learning
export const movieSchema = z.object({
  id: z.number(),
  tmdbId: z.number(),
  title: z.string(),
  year: z.number().nullable(),
  posterPath: z.string().nullable(),
  backdropPath: z.string().nullable(),
  overview: z.string().nullable(),
  genres: z.array(z.string()),
  rating: z.number().nullable(),
  listSource: z.string(),
  // Extended metadata for AI analysis
  director: z.string().nullable().optional(),
  cast: z.array(z.string()).optional(),
  runtime: z.number().nullable().optional(),
  keywords: z.array(z.string()).optional(),
});

export type Movie = z.infer<typeof movieSchema>;

// Session for tracking 7-round game
export const sessionSchema = z.object({
  sessionId: z.string(),
  currentRound: z.number(),
  totalRounds: z.number(),
  choices: z.array(z.object({
    round: z.number(),
    leftMovie: movieSchema,
    rightMovie: movieSchema,
    chosenMovieId: z.number(),
  })),
  isComplete: z.boolean(),
});

export type Session = z.infer<typeof sessionSchema>;

// API response for starting a new session
export const startSessionResponseSchema = z.object({
  sessionId: z.string(),
  totalRounds: z.number(),
});

export type StartSessionResponse = z.infer<typeof startSessionResponseSchema>;

// API response for getting current round's movie pair
export const roundPairResponseSchema = z.object({
  sessionId: z.string(),
  round: z.number(),
  totalRounds: z.number(),
  leftMovie: movieSchema,
  rightMovie: movieSchema,
  isComplete: z.boolean(),
});

export type RoundPairResponse = z.infer<typeof roundPairResponseSchema>;

// API request for making a choice
export const choiceRequestSchema = z.object({
  sessionId: z.string(),
  chosenMovieId: z.number(),
});

export type ChoiceRequest = z.infer<typeof choiceRequestSchema>;

// API response after making a choice
export const choiceResponseSchema = z.object({
  success: z.boolean(),
  nextRound: z.number().nullable(),
  isComplete: z.boolean(),
});

export type ChoiceResponse = z.infer<typeof choiceResponseSchema>;

// AI recommendation result
export const recommendationSchema = z.object({
  movie: movieSchema,
  trailerUrl: z.string().nullable(),
  reason: z.string(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

// API response for final recommendations
export const recommendationsResponseSchema = z.object({
  recommendations: z.array(recommendationSchema),
  preferenceProfile: z.object({
    topGenres: z.array(z.string()),
    themes: z.array(z.string()),
    preferredEras: z.array(z.string()).optional(),
    visualStyle: z.string().optional(),
    mood: z.string().optional(),
  }),
});

export type RecommendationsResponse = z.infer<typeof recommendationsResponseSchema>;

// Legacy types for backwards compatibility
export const catalogueResponseSchema = z.object({
  movies: z.array(movieSchema),
  grouped: z.record(z.string(), z.array(movieSchema)).optional(),
});

export type CatalogueResponse = z.infer<typeof catalogueResponseSchema>;

export const recResponseSchema = z.object({
  movies: z.array(movieSchema),
});

export type RecResponse = z.infer<typeof recResponseSchema>;

export const trailerResponseSchema = z.record(z.string(), z.string().nullable());

export type TrailerResponse = z.infer<typeof trailerResponseSchema>;

export const healthResponseSchema = z.object({
  totalMovies: z.number(),
  catalogueCount: z.number(),
  recPoolCount: z.number(),
  lastUpdated: z.string().nullable(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// Watch provider schema for "where to watch" feature
export const watchProviderSchema = z.object({
  id: z.number(),
  name: z.string(),
  logoPath: z.string(),
  type: z.enum(["subscription", "rent", "buy"]),
});

export type WatchProvider = z.infer<typeof watchProviderSchema>;

export const watchProvidersResponseSchema = z.object({
  link: z.string().nullable(),
  providers: z.array(watchProviderSchema),
});

export type WatchProvidersResponse = z.infer<typeof watchProvidersResponseSchema>;
