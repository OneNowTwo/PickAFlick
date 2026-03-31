import { z } from "zod";
import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

// Users table for Google OAuth authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Every A/B vote cast by a logged-in user
export const userVotes = pgTable("user_votes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  round: integer("round").notNull(),
  chosenTmdbId: integer("chosen_tmdb_id").notNull(),
  rejectedTmdbId: integer("rejected_tmdb_id").notNull(),
  chosenTitle: text("chosen_title").notNull(),
  rejectedTitle: text("rejected_title").notNull(),
  chosenGenres: text("chosen_genres").array().notNull().default([]),
  rejectedGenres: text("rejected_genres").array().notNull().default([]),
  votedAt: timestamp("voted_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  votes: many(userVotes),
}));

export type UserVote = typeof userVotes.$inferSelect;
export type InsertUserVote = typeof userVotes.$inferInsert;

// User-based watchlist (requires login — separate from the legacy session-based watchlist)
export const userWatchlist = pgTable("user_watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tmdbId: integer("tmdb_id").notNull(),
  title: text("title").notNull(),
  posterPath: text("poster_path"),
  releaseYear: integer("release_year"),
  genres: text("genres").array().notNull().default([]),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export type UserWatchlistItem = typeof userWatchlist.$inferSelect;
export type InsertUserWatchlistItem = typeof userWatchlist.$inferInsert;

// Shared recommendations table for shareable results
export const sharedRecommendations = pgTable("shared_recommendations", {
  id: serial("id").primaryKey(),
  shareId: text("share_id").notNull().unique(),
  recommendations: text("recommendations").notNull(), // JSON string of recommendations
  preferenceProfile: text("preference_profile").notNull(), // JSON string of preference profile
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SharedRecommendation = typeof sharedRecommendations.$inferSelect;

// Movie catalogue cache table for instant cold starts
export const movieCatalogueCache = pgTable("movie_catalogue_cache", {
  id: serial("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(), // "catalogue" - single row for now
  movies: text("movies").notNull(), // JSON string of Movie[]
  grouped: text("grouped").notNull(), // JSON string of Record<string, Movie[]>
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MovieCatalogueCache = typeof movieCatalogueCache.$inferSelect;

// Watchlist table for persisting liked movies (per-session isolation)
export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id"), // Client-generated UUID; null = legacy (excluded from queries)
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

/** Legacy lane enum (older clients / migrations) */
export const recommendationLaneSchema = z.enum(["mainstream", "movie_buff", "left_field"]);
export type RecommendationLane = z.infer<typeof recommendationLaneSchema>;

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
  original_language: z.string().nullable().optional(),
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

// Choice history for insights
export const choiceHistorySchema = z.object({
  round: z.number(),
  chosenMovie: movieSchema,
  rejectedMovie: movieSchema,
});

export type ChoiceHistory = z.infer<typeof choiceHistorySchema>;

// API response for getting current round's movie pair
export const roundPairResponseSchema = z.object({
  sessionId: z.string(),
  round: z.number(),
  totalRounds: z.number(),
  baseTotalRounds: z.number(), // Original total rounds before any skips (for progress calculation)
  choicesMade: z.number(), // Number of actual choices made (for progress calculation)
  leftMovie: movieSchema,
  rightMovie: movieSchema,
  isComplete: z.boolean(),
  choiceHistory: z.array(choiceHistorySchema).optional(),
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
export const recommendationBucketSchema = z.enum(["mainstream", "discovery"]);
export type RecommendationBucket = z.infer<typeof recommendationBucketSchema>;

export const recommendationSchema = z.object({
  movie: movieSchema,
  trailerUrl: z.string().nullable(),
  trailerUrls: z.array(z.string()).optional(), // Multiple trailer URLs for fallback
  reason: z.string(),
  wildcardBadge: z.string().optional(), // Set on personalised wildcard picks
  /** True when AU stream/rent/buy links exist (final picks must satisfy this). */
  auWatchAvailable: z.boolean().optional(),
  /** Crowd pleasers vs hidden gems row (omit on legacy payloads). */
  bucket: recommendationBucketSchema.optional(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

const preferenceProfileSchema = z.object({
  topGenres: z.array(z.string()),
  themes: z.array(z.string()),
  preferredEras: z.array(z.string()).optional(),
  visualStyle: z.string().optional(),
  mood: z.string().optional(),
  /** Taste / mood headline (e.g. tone line from session mood) */
  headline: z.string().optional(),
  /** Claude 8-word profile line — show above trailer */
  profileLine: z.string().optional(),
  /** Two-sentence "You leaned… So these picks…" pattern copy */
  patternSummary: z.string().optional(),
  /** @deprecated use patternSummary */
  tagline: z.string().optional(),
});

// API response for final recommendations
export const recommendationsResponseSchema = z.object({
  recommendations: z.array(recommendationSchema),
  preferenceProfile: preferenceProfileSchema,
  hasPersonalisation: z.boolean().optional(),
  genreProfileSize: z.number().optional(),
});

export type RecommendationsResponse = z.infer<typeof recommendationsResponseSchema>;

/** GET /api/session/:id/taste-preview — mood line + two-sentence pattern */
export const tastePreviewSchema = z.object({
  headline: z.string(),
  patternSummary: z.string(),
  topGenres: z.array(z.string()),
  themes: z.array(z.string()),
  preferredEras: z.array(z.string()),
});

export type TastePreview = z.infer<typeof tastePreviewSchema>;

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
  deepLink: z.string().optional(), // Direct link to movie on this service
});

export type WatchProvider = z.infer<typeof watchProviderSchema>;

export const watchProvidersResponseSchema = z.object({
  link: z.string().nullable(),
  providers: z.array(watchProviderSchema),
});

export type WatchProvidersResponse = z.infer<typeof watchProvidersResponseSchema>;
