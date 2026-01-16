import { z } from "zod";

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
});

export type Movie = z.infer<typeof movieSchema>;

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
