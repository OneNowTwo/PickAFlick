import type { Movie } from "@shared/schema";
import { getAllIMDbMovies, getIMDbLists } from "./imdb-scraper";
import { resolveMovieFromTitle, discoverMovies, getTopRatedMovies, getPopularMovies } from "./tmdb";

interface CatalogueCache {
  allMovies: Movie[];
  catalogue: Movie[];
  recPool: Movie[];
  grouped: Record<string, Movie[]>;
  lastUpdated: Date | null;
  buildComplete: boolean;
  buildError: string | null;
}

const cache: CatalogueCache = {
  allMovies: [],
  catalogue: [],
  recPool: [],
  grouped: {},
  lastUpdated: null,
  buildComplete: false,
  buildError: null,
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

async function buildCatalogueFromTMDb(): Promise<{ allMovies: Movie[]; grouped: Record<string, Movie[]> }> {
  console.log("Building catalogue from TMDb API...");
  const allMovies: Movie[] = [];
  const grouped: Record<string, Movie[]> = {};

  // Categories with their TMDb genre IDs
  const categories = [
    { name: "Top Rated", fetch: () => getTopRatedMovies("Top Rated", 1) },
    { name: "Popular Now", fetch: () => getPopularMovies("Popular Now", 1) },
    { name: "Horror", fetch: () => discoverMovies("Horror", { genreIds: [27], minRating: 6.0 }) },
    { name: "Comedy", fetch: () => discoverMovies("Comedy", { genreIds: [35], minRating: 6.5 }) },
    { name: "Sci-Fi & Fantasy", fetch: () => discoverMovies("Sci-Fi & Fantasy", { genreIds: [878, 14], minRating: 6.5 }) },
  ];

  for (const category of categories) {
    console.log(`Fetching ${category.name} movies from TMDb...`);
    const movies = await category.fetch();
    grouped[category.name] = movies.slice(0, 30);
    allMovies.push(...movies.slice(0, 30));
    console.log(`Got ${movies.length} movies for ${category.name}`);
  }

  return { allMovies, grouped };
}

async function buildCatalogue(): Promise<void> {
  console.log("Building movie catalogue...");
  cache.buildComplete = false;
  cache.buildError = null;
  
  try {
    // First try IMDb scraping
    const imdbMovies = await getAllIMDbMovies();
    let allMovies: Movie[] = [];
    let grouped: Record<string, Movie[]> = {};
    let usedTMDbFallback = false;

    // Check if IMDb scraping returned any movies
    let imdbTotalCount = 0;
    for (const [, items] of Array.from(imdbMovies.entries())) {
      imdbTotalCount += items.length;
    }

    if (imdbTotalCount > 0) {
      // IMDb scraping worked, use it
      for (const [listName, items] of Array.from(imdbMovies.entries())) {
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
    } else {
      // IMDb scraping failed, use TMDb fallback
      console.log("IMDb scraping failed, falling back to TMDb API...");
      usedTMDbFallback = true;
      const tmdbResult = await buildCatalogueFromTMDb();
      allMovies = tmdbResult.allMovies;
      grouped = tmdbResult.grouped;
    }

    // Deduplicate allMovies by tmdbId to prevent same movie appearing twice
    const uniqueMovies = new Map<number, Movie>();
    for (const movie of allMovies) {
      if (!uniqueMovies.has(movie.tmdbId)) {
        uniqueMovies.set(movie.tmdbId, movie);
      }
    }
    cache.allMovies = Array.from(uniqueMovies.values());
    cache.grouped = grouped;
    cache.lastUpdated = new Date();
    cache.buildComplete = true;

    if (allMovies.length === 0) {
      cache.buildError = "Failed to load movies. Please check your TMDB_API_KEY and try again.";
      console.error("Catalogue build completed but no movies were loaded!");
    } else if (usedTMDbFallback) {
      console.log("Using TMDb fallback catalogue successfully");
    }

    selectNewCatalogue();
    
    console.log(`Catalogue built: ${allMovies.length} total movies`);
  } catch (error) {
    cache.buildComplete = true;
    cache.buildError = "An error occurred while building the movie catalogue.";
    console.error("Catalogue build failed:", error);
  }
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
  return cache.buildComplete && cache.allMovies.length > 0;
}

export function getCatalogueStatus(): { ready: boolean; loading: boolean; error: string | null; movieCount: number } {
  return {
    ready: cache.buildComplete && cache.allMovies.length > 0,
    loading: !cache.buildComplete,
    error: cache.buildError,
    movieCount: cache.allMovies.length,
  };
}

export function getAllMovies(): Movie[] {
  return cache.allMovies;
}

// Get a random pair of movies for a round
export function getRandomMoviePair(excludeIds: Set<number> = new Set()): [Movie, Movie] | null {
  const available = cache.allMovies.filter((m) => !excludeIds.has(m.id));
  
  if (available.length < 2) {
    return null;
  }

  const shuffled = shuffleArray(available);
  return [shuffled[0], shuffled[1]];
}

// Get a random pair of movies filtered by genres
export function getRandomMoviePairFiltered(
  genres: string[],
  includeTopPicks: boolean,
  excludeIds: Set<number> = new Set()
): [Movie, Movie] | null {
  let available: Movie[];
  
  if (genres.length === 0 && !includeTopPicks) {
    // No filters - use all movies
    available = cache.allMovies.filter((m) => !excludeIds.has(m.id));
  } else {
    // Filter by genres and/or top picks
    available = cache.allMovies.filter((m) => {
      if (excludeIds.has(m.id)) return false;
      
      // Check if movie is from top picks lists (Top Rated, Popular Now)
      const isTopPick = m.listSource === "Top Rated" || m.listSource === "Popular Now";
      
      // Check if movie matches any selected genre
      const matchesGenre = genres.length > 0 && m.genres.some(g => genres.includes(g));
      
      // If only top picks selected (no genres), only show top picks
      if (includeTopPicks && genres.length === 0) {
        return isTopPick;
      }
      
      // If genres selected (with or without top picks), show matching genres OR top picks
      if (includeTopPicks) {
        return matchesGenre || isTopPick;
      }
      
      // Only genres selected, no top picks
      return matchesGenre;
    });
  }
  
  if (available.length < 2) {
    // Fallback to all movies if not enough matches
    console.log("Not enough filtered movies, falling back to all movies");
    available = cache.allMovies.filter((m) => !excludeIds.has(m.id));
  }
  
  if (available.length < 2) {
    return null;
  }

  const shuffled = shuffleArray(available);
  return [shuffled[0], shuffled[1]];
}
