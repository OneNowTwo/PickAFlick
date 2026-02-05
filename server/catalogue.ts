import type { Movie } from "@shared/schema";
import { getAllIMDbMovies, getIMDbLists } from "./imdb-scraper";
import { resolveMovieFromTitle, discoverMovies, getTopRatedMovies, getPopularMovies, getNowPlayingMovies } from "./tmdb";
import { storage } from "./storage";

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
  console.log("Building expanded catalogue from TMDb API (this may take a couple minutes)...");
  const allMovies: Movie[] = [];
  const grouped: Record<string, Movie[]> = {};

  // Fetch multiple pages for Top Rated (pages 1-3 = ~60 movies)
  console.log("Fetching Top Rated movies (3 pages)...");
  const topRatedMovies: Movie[] = [];
  for (let page = 1; page <= 3; page++) {
    const movies = await getTopRatedMovies("Top Rated", page);
    topRatedMovies.push(...movies);
    console.log(`  Page ${page}: ${movies.length} movies`);
  }
  grouped["Top Rated"] = topRatedMovies;
  allMovies.push(...topRatedMovies);
  console.log(`Got ${topRatedMovies.length} Top Rated movies total`);

  // Fetch multiple pages for Popular Now (pages 1-2 = ~40 movies)
  console.log("Fetching Popular Now movies (2 pages)...");
  const popularMovies: Movie[] = [];
  for (let page = 1; page <= 2; page++) {
    const movies = await getPopularMovies("Popular Now", page);
    popularMovies.push(...movies);
    console.log(`  Page ${page}: ${movies.length} movies`);
  }
  grouped["Popular Now"] = popularMovies;
  allMovies.push(...popularMovies);
  console.log(`Got ${popularMovies.length} Popular Now movies total`);

  // Fetch New Releases (Now Playing - movies currently in theaters)
  console.log("Fetching New Releases / Now Playing movies (2 pages)...");
  const newReleaseMovies: Movie[] = [];
  for (let page = 1; page <= 2; page++) {
    const movies = await getNowPlayingMovies("New Releases", page);
    newReleaseMovies.push(...movies);
    console.log(`  Page ${page}: ${movies.length} movies`);
  }
  grouped["New Releases"] = newReleaseMovies;
  allMovies.push(...newReleaseMovies);
  console.log(`Got ${newReleaseMovies.length} New Releases movies total`);

  // Genre categories with their TMDb genre IDs (2 pages each)
  // Each genre gets its own separate category - no combining!
  // Minimum ratings set to 5.5 across the board for better variety
  const genreCategories = [
    { name: "Action", genreIds: [28], minRating: 5.5 },
    { name: "Adventure", genreIds: [12], minRating: 5.5 },
    { name: "Animation", genreIds: [16], minRating: 5.5 },
    { name: "Comedy", genreIds: [35], minRating: 5.5 },
    { name: "Crime", genreIds: [80], minRating: 5.5 },
    { name: "Documentary", genreIds: [99], minRating: 5.5 },
    { name: "Drama", genreIds: [18], minRating: 5.5 },
    { name: "Family", genreIds: [10751], minRating: 5.5 },
    { name: "Fantasy", genreIds: [14], minRating: 5.5 },
    { name: "Horror", genreIds: [27], minRating: 5.5 },
    { name: "Mystery", genreIds: [9648], minRating: 5.5 },
    { name: "Romance", genreIds: [10749], minRating: 5.5 },
    { name: "Sci-Fi", genreIds: [878], minRating: 5.5 },
    { name: "Thriller", genreIds: [53], minRating: 5.5 },
    { name: "War", genreIds: [10752], minRating: 5.5 },
    { name: "Western", genreIds: [37], minRating: 5.5 },
  ];

  for (const category of genreCategories) {
    console.log(`Fetching ${category.name} movies (2 pages)...`);
    const categoryMovies: Movie[] = [];
    for (let page = 1; page <= 2; page++) {
      const movies = await discoverMovies(category.name, { 
        genreIds: category.genreIds, 
        minRating: category.minRating,
        page 
      });
      categoryMovies.push(...movies);
      console.log(`  Page ${page}: ${movies.length} movies`);
    }
    grouped[category.name] = categoryMovies;
    allMovies.push(...categoryMovies);
    console.log(`Got ${categoryMovies.length} ${category.name} movies total`);
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
      // Apply quality filters: 5.5+ rating across all genres for better variety
      const MIN_RATING_DEFAULT = 5.5;
      const MIN_RATING_HORROR = 5.5;
      
      for (const [listName, items] of Array.from(imdbMovies.entries())) {
        console.log(`Processing ${listName}: ${items.length} movies`);
        const listMovies: Movie[] = [];
        const minRating = listName.toLowerCase().includes('horror') ? MIN_RATING_HORROR : MIN_RATING_DEFAULT;

        for (const item of items.slice(0, 50)) {
          const movie = await resolveMovieFromTitle(item.title, item.year, listName);
          if (movie) {
            // Apply rating filter to maintain quality standards
            if (movie.rating && movie.rating >= minRating) {
              listMovies.push(movie);
            } else if (!movie.rating) {
              // If no rating data, still include it (might be too new)
              listMovies.push(movie);
            } else {
              console.log(`Filtered out "${movie.title}" (${movie.rating?.toFixed(1)}) - below ${minRating} threshold`);
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        grouped[listName] = listMovies;
        allMovies.push(...listMovies);
        console.log(`Resolved ${listMovies.length} movies for ${listName} (min rating: ${minRating})`);
      }
      
      // Always add New Releases from TMDb (Now Playing) even when IMDb works
      console.log("Adding New Releases from TMDb...");
      const newReleaseMovies: Movie[] = [];
      for (let page = 1; page <= 2; page++) {
        const movies = await getNowPlayingMovies("New Releases", page);
        newReleaseMovies.push(...movies);
        console.log(`  Page ${page}: ${movies.length} movies`);
      }
      if (newReleaseMovies.length > 0) {
        grouped["New Releases"] = newReleaseMovies;
        allMovies.push(...newReleaseMovies);
        console.log(`Got ${newReleaseMovies.length} New Releases movies total`);
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
  // First, try to load from database cache for instant startup
  try {
    const dbCache = await storage.getCatalogueCache();
    
    if (dbCache) {
      const cacheAge = (Date.now() - new Date(dbCache.updatedAt).getTime()) / (1000 * 60 * 60);
      console.log(`Found database cache (${cacheAge.toFixed(1)} hours old)`);
      
      // Load cached data immediately
      const cachedMovies: Movie[] = JSON.parse(dbCache.movies);
      const cachedGrouped: Record<string, Movie[]> = JSON.parse(dbCache.grouped);
      
      cache.allMovies = cachedMovies;
      cache.grouped = cachedGrouped;
      cache.lastUpdated = new Date(dbCache.updatedAt);
      cache.buildComplete = true;
      selectNewCatalogue();
      
      console.log(`Loaded ${cachedMovies.length} movies from database cache - ready to serve!`);
      
      // If cache is stale, rebuild in background (but don't block startup)
      if (cacheAge > CATALOGUE_TTL_HOURS) {
        console.log("Cache is stale, rebuilding in background...");
        buildCatalogueAndSave().catch(err => console.error("Background rebuild failed:", err));
      }
      return;
    }
  } catch (error) {
    console.log("No database cache found, will build fresh catalogue");
  }
  
  // No database cache - build fresh (first-time setup)
  await buildCatalogueAndSave();
}

async function buildCatalogueAndSave(): Promise<void> {
  await buildCatalogue();
  
  // Save to database for future cold starts
  if (cache.allMovies.length > 0) {
    try {
      await storage.saveCatalogueCache(
        JSON.stringify(cache.allMovies),
        JSON.stringify(cache.grouped)
      );
      console.log("Catalogue saved to database cache for instant future startups");
    } catch (error) {
      console.error("Failed to save catalogue to database:", error);
    }
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
  excludeIds: Set<number> = new Set(),
  includeNewReleases: boolean = false
): [Movie, Movie] | null {
  let available: Movie[];
  
  if (genres.length === 0 && !includeTopPicks && !includeNewReleases) {
    // No filters - use all movies
    available = cache.allMovies.filter((m) => !excludeIds.has(m.id));
  } else {
    // Filter by genres and/or top picks and/or new releases
    available = cache.allMovies.filter((m) => {
      if (excludeIds.has(m.id)) return false;
      
      // Check if movie is from top picks lists (Top Rated, Popular Now)
      const isTopPick = m.listSource === "Top Rated" || m.listSource === "Popular Now";
      
      // Check if movie is a new release
      const isNewRelease = m.listSource === "New Releases";
      
      // Check if movie is from special list-based filters
      const isIndie = genres.includes("Indie") && m.listSource === "Indie Films";
      
      // Check if movie's list source matches selected genre (exact match only)
      const isFromGenreList = genres.some(g => {
        if (g === "Indie") return false; // Handled separately
        return m.listSource === g;
      });
      
      // Check if movie's PRIMARY genre (first in array) matches selected genres
      const genreFilters = genres.filter(g => g !== "Indie");
      const matchesGenre = genreFilters.length > 0 && m.genres.length > 0 && 
        genreFilters.includes(m.genres[0]);
      
      // Build criteria
      const specialFiltersOnly = genreFilters.length === 0;
      
      if (specialFiltersOnly) {
        // Only special filters selected (top picks and/or new releases and/or indie)
        if (isIndie) return true; // Indie is always included when selected
        
        if (includeTopPicks && includeNewReleases) {
          return isTopPick || isNewRelease;
        }
        if (includeTopPicks) {
          return isTopPick;
        }
        if (includeNewReleases) {
          return isNewRelease;
        }
      }
      
      // Genres selected - combine with special filters and genre lists
      const matchesAny = matchesGenre || isIndie || isFromGenreList || (includeTopPicks && isTopPick) || (includeNewReleases && isNewRelease);
      return matchesAny;
    });
  }
  
  // IMPROVED FALLBACK: Instead of showing ALL movies, relax filters gradually
  if (available.length < 2) {
    console.log(`Not enough filtered movies (${available.length}), expanding search...`);
    
    // Try expanding to ALL genres (not just primary 2) - still respect Horror/Indie/etc filters
    available = cache.allMovies.filter((m) => {
      if (excludeIds.has(m.id)) return false;
      
      const isTopPick = m.listSource === "Top Rated" || m.listSource === "Popular Now";
      const isNewRelease = m.listSource === "New Releases";
      const isIndie = genres.includes("Indie") && m.listSource === "Indie Films";
      
      // Check list source (exact match only)
      const isFromGenreList = genres.some(g => {
        if (g === "Indie") return false;
        return m.listSource === g;
      });
      
      // Check PRIMARY movie genre (first in array)
      const genreFilters = genres.filter(g => g !== "Indie");
      const matchesGenre = genreFilters.length > 0 && m.genres.length > 0 && genreFilters.includes(m.genres[0]);
      
      return matchesGenre || isIndie || isFromGenreList || (includeTopPicks && isTopPick) || (includeNewReleases && isNewRelease);
    });
    
    // If STILL not enough, only then use all movies
    if (available.length < 2) {
      console.log("Still not enough, using all available movies");
      available = cache.allMovies.filter((m) => !excludeIds.has(m.id));
    }
  }
  
  if (available.length < 2) {
    return null;
  }

  const shuffled = shuffleArray(available);
  return [shuffled[0], shuffled[1]];
}
