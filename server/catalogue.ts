import type { Movie } from "@shared/schema";
import { getAllIMDbMovies, getIMDbLists } from "./imdb-scraper";
import { resolveMovieFromTitle } from "./tmdb";

interface CatalogueCache {
  allMovies: Movie[];
  catalogue: Movie[];
  recPool: Movie[];
  grouped: Record<string, Movie[]>;
  lastUpdated: Date | null;
}

const cache: CatalogueCache = {
  allMovies: [],
  catalogue: [],
  recPool: [],
  grouped: {},
  lastUpdated: null,
};

const CATALOGUE_TTL_HOURS = parseInt(process.env.CATALOGUE_TTL_HOURS || "24");
const MOVIES_PER_LIST = 15;
const TOTAL_CATALOGUE = 75;

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function sampleFromArray<T>(array: T[], count: number): T[] {
  const shuffled = shuffleArray(array);
  return shuffled.slice(0, count);
}

async function buildCatalogue(): Promise<void> {
  console.log("Building movie catalogue...");
  
  const imdbMovies = await getAllIMDbMovies();
  const allMovies: Movie[] = [];
  const grouped: Record<string, Movie[]> = {};

  for (const [listName, items] of imdbMovies.entries()) {
    console.log(`Processing ${listName}: ${items.length} movies`);
    const listMovies: Movie[] = [];

    for (const item of items.slice(0, 50)) {
      const movie = await resolveMovieFromTitle(item.title, item.year, listName);
      if (movie) {
        listMovies.push(movie);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    grouped[listName] = listMovies;
    allMovies.push(...listMovies);
    console.log(`Resolved ${listMovies.length} movies for ${listName}`);
  }

  cache.allMovies = allMovies;
  cache.grouped = grouped;
  cache.lastUpdated = new Date();

  selectNewCatalogue();
  
  console.log(`Catalogue built: ${allMovies.length} total movies`);
}

function selectNewCatalogue(): void {
  const catalogue: Movie[] = [];
  const catalogueIds = new Set<number>();

  for (const [listName, movies] of Object.entries(cache.grouped)) {
    const sampled = sampleFromArray(movies, MOVIES_PER_LIST);
    for (const movie of sampled) {
      if (!catalogueIds.has(movie.id)) {
        catalogue.push(movie);
        catalogueIds.add(movie.id);
      }
    }
  }

  cache.catalogue = shuffleArray(catalogue);
  cache.recPool = cache.allMovies.filter((m) => !catalogueIds.has(m.id));
}

export function getCatalogue(grouped: boolean = false): { movies: Movie[]; grouped?: Record<string, Movie[]> } {
  selectNewCatalogue();
  
  if (grouped) {
    const groupedCatalogue: Record<string, Movie[]> = {};
    for (const movie of cache.catalogue) {
      if (!groupedCatalogue[movie.listSource]) {
        groupedCatalogue[movie.listSource] = [];
      }
      groupedCatalogue[movie.listSource].push(movie);
    }
    return { movies: cache.catalogue, grouped: groupedCatalogue };
  }

  return { movies: cache.catalogue };
}

export function getRecommendations(limit: number = 6): Movie[] {
  selectNewCatalogue();
  return sampleFromArray(cache.recPool, limit);
}

export function getHealth() {
  return {
    totalMovies: cache.allMovies.length,
    catalogueCount: cache.catalogue.length,
    recPoolCount: cache.recPool.length,
    lastUpdated: cache.lastUpdated?.toISOString() || null,
  };
}

export async function initCatalogue(): Promise<void> {
  const cacheAge = cache.lastUpdated
    ? (Date.now() - cache.lastUpdated.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (cacheAge > CATALOGUE_TTL_HOURS || cache.allMovies.length === 0) {
    await buildCatalogue();
  }
}

export function isCatalogueReady(): boolean {
  return cache.allMovies.length > 0;
}
