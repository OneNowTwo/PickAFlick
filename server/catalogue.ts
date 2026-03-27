import type { Movie } from "@shared/schema";
import { getAllEditorialMovies } from "./editorial-scraper";
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
  // NO rating filters - get maximum variety
  const genreCategories = [
    { name: "Action", genreIds: [28], minRating: 6.0 },
    { name: "Adventure", genreIds: [12], minRating: 6.0 },
    { name: "Animation", genreIds: [16], minRating: 6.0 },
    { name: "Comedy", genreIds: [35], minRating: 6.0 },
    { name: "Crime", genreIds: [80], minRating: 6.0 },
    { name: "Documentary", genreIds: [99], minRating: 6.0 },
    { name: "Drama", genreIds: [18], minRating: 6.0 },
    { name: "Family", genreIds: [10751], minRating: 6.0 },
    { name: "Fantasy", genreIds: [14], minRating: 6.0 },
    { name: "Horror", genreIds: [27], minRating: 6.0 },
    { name: "Mystery", genreIds: [9648], minRating: 6.0 },
    { name: "Romance", genreIds: [10749], minRating: 6.0 },
    { name: "Sci-Fi", genreIds: [878], minRating: 6.0 },
    { name: "Thriller", genreIds: [53], minRating: 6.0 },
    { name: "War", genreIds: [10752], minRating: 6.0 },
    { name: "Western", genreIds: [37], minRating: 6.0 },
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
    // Fetch editorial lists (Rolling Stone, Empire, IndieWire, Variety, RT) only —
    // IMDb list scraping is permanently blocked so those calls have been removed.
    const editorialMovies = await getAllEditorialMovies();

    const allMovies: Movie[] = [];
    const grouped: Record<string, Movie[]> = {};

    // Process all editorial sources
    const asianLanguages = ['ko', 'ja', 'zh', 'th', 'vi'];
    for (const [listName, items] of Array.from(editorialMovies.entries())) {
      console.log(`Processing ${listName}: ${items.length} movies`);
      const listMovies: Movie[] = [];

      for (const item of items.slice(0, 200)) {
        // Strip leading number prefixes like "49) " or "1. " produced by some editorial scrapers
        const cleanTitle = item.title.replace(/^\d+[.):\s]+/, "").trim();
        const movie = await resolveMovieFromTitle(cleanTitle, item.year, listName);
        if (movie && movie.posterPath && movie.posterPath.trim() && movie.rating && movie.rating >= 6.0) {
          if (movie.original_language && asianLanguages.includes(movie.original_language)) {
            console.log(`Filtered out "${movie.title}" - Asian language film (${movie.original_language})`);
          } else {
            listMovies.push(movie);
          }
        } else if (movie && (!movie.posterPath || !movie.posterPath.trim())) {
          console.log(`Filtered out "${movie.title}" - no poster`);
        } else if (movie && movie.rating && movie.rating < 6.0) {
          console.log(`Filtered out "${movie.title}" - rating ${movie.rating} below 6.0`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      grouped[listName] = listMovies;
      allMovies.push(...listMovies);
      console.log(`Resolved ${listMovies.length} movies for ${listName}`);
    }

    // Supplement any genre with fewer than MIN_GENRE_MOVIES using TMDb discover.
    // Curated sources are preferred; TMDb fills gaps. 4 pages ≈ 80 movies per genre.
    const MIN_GENRE_MOVIES = 10;
    const SUPPLEMENT_PAGES = 4;

    // Each genre maps to a TMDb config. genreIds are joined with | (OR logic in TMDb).
    // Special value genreIds: [] means use getTopRatedMovies (no genre filter).
    const TMDB_GENRE_MAP: Record<string, { genreIds: number[]; minRating?: number }> = {
      "Action":               { genreIds: [28] },
      "Comedy":               { genreIds: [35] },
      "Classic Movies":       { genreIds: [18, 80, 53, 37] }, // Drama|Crime|Thriller|Western
      "Critically Acclaimed": { genreIds: [], minRating: 7.8 }, // Top-rated, no genre filter
      "Indie Films":          { genreIds: [18, 53], minRating: 7.0 },
      "Western":              { genreIds: [37] },
      "Thriller":             { genreIds: [53] },
      "War":                  { genreIds: [10752] },
      "Documentary":          { genreIds: [99] },
      "Family":               { genreIds: [10751] },
      "Top 250 Movies":       { genreIds: [], minRating: 7.8 }, // Top-rated, no genre filter
      "Fantasy":              { genreIds: [14] },
      "Horror":               { genreIds: [27] },
      "Romance":              { genreIds: [10749] },
      "Sci-Fi":               { genreIds: [878] },
    };

    for (const [listName, genreCfg] of Object.entries(TMDB_GENRE_MAP)) {
      const existing = (grouped[listName] || []).length;
      if (existing < MIN_GENRE_MOVIES) {
        console.log(`${listName} has only ${existing} movies — supplementing with TMDb...`);
        const supplementMovies: Movie[] = [];

        for (let page = 1; page <= SUPPLEMENT_PAGES; page++) {
          let pageMovies: Movie[];
          if (genreCfg.genreIds.length === 0) {
            // Use top-rated endpoint (no genre filter) — for Top 250 / Critically Acclaimed
            pageMovies = await getTopRatedMovies(listName, page);
            if (genreCfg.minRating) {
              pageMovies = pageMovies.filter(m => m.rating != null && m.rating >= genreCfg.minRating!);
            }
          } else {
            pageMovies = await discoverMovies(listName, {
              genreIds: genreCfg.genreIds,
              minRating: genreCfg.minRating ?? 6.5,
              page,
            });
          }
          supplementMovies.push(...pageMovies);
        }

        if (supplementMovies.length > 0) {
          const prev = grouped[listName] || [];
          const existingIds = new Set(prev.map(m => m.tmdbId));
          const fresh = supplementMovies.filter(m => !existingIds.has(m.tmdbId));
          grouped[listName] = [...prev, ...fresh];
          allMovies.push(...fresh);
          console.log(`  Added ${fresh.length} TMDb movies to ${listName} (total: ${grouped[listName].length})`);
        }
      }
    }

    // Always add New Releases from TMDb (Now Playing)
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
      const cachedMovies: Movie[] = JSON.parse(dbCache.movies);
      const cachedGrouped: Record<string, Movie[]> = JSON.parse(dbCache.grouped);

      // Discard cache if it looks broken (too few movies — scraper must have failed)
      const MIN_HEALTHY_CATALOGUE = 100;
      if (cachedMovies.length < MIN_HEALTHY_CATALOGUE) {
        console.log(`Cache has only ${cachedMovies.length} movies (below ${MIN_HEALTHY_CATALOGUE} minimum) — discarding and rebuilding...`);
        await storage.clearCatalogueCache().catch(() => {});
      } else {
        console.log(`Found database cache (${cacheAge.toFixed(1)} hours old, ${cachedMovies.length} movies)`);

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
  const available = cache.allMovies.filter((m) => !excludeIds.has(m.id) && (!m.year || m.year >= 1980));
  
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
  includeNewReleases: boolean = false,
  englishOnly: boolean = false
): [Movie, Movie] | null {
  let available: Movie[];
  
  if (genres.length === 0 && !includeTopPicks && !includeNewReleases) {
    // Surprise Me — no genre filters. Optionally restrict to English-language films.
    available = cache.allMovies.filter((m) => {
      if (excludeIds.has(m.id)) return false;
      if (!m.year || m.year < 1980) return false;
      if (englishOnly && m.original_language && m.original_language !== 'en') return false;
      return true;
    });
  } else {
    // Filter by genres and/or top picks and/or new releases
    available = cache.allMovies.filter((m) => {
      if (excludeIds.has(m.id)) return false;
      if (!m.year || m.year < 1980) return false;
      
      // Check if movie is from top picks lists (Top Rated, Popular Now)
      const isTopPick = m.listSource === "Top Rated" || m.listSource === "Popular Now";
      
      // Check if movie is a new release
      const isNewRelease = m.listSource === "New Releases";
      
      // Check if movie is from special list-based filters
      const isIndie = genres.includes("Indie") && m.listSource === "Indie Films";
      
      // Check if movie's PRIMARY genre (first in array) matches selected genres - THIS IS THE MAIN FILTER
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
      
      // STRICT: Genres selected - PRIMARY genre MUST match. No OR logic with lists.
      // If Horror is selected, movie's first genre MUST be Horror.
      return matchesGenre || isIndie || (includeTopPicks && isTopPick) || (includeNewReleases && isNewRelease);
    });
  }
  
  // IMPROVED FALLBACK: Instead of showing ALL movies, relax filters gradually
  if (available.length < 2) {
    console.log(`Not enough filtered movies (${available.length}), expanding search...`);
    
    // Try expanding to ALL genres (not just primary) - still respect Horror/Indie/etc filters
    available = cache.allMovies.filter((m) => {
      if (excludeIds.has(m.id)) return false;
      if (!m.year || m.year < 1980) return false;

      const isTopPick = m.listSource === "Top Rated" || m.listSource === "Popular Now";
      const isNewRelease = m.listSource === "New Releases";
      const isIndie = genres.includes("Indie") && m.listSource === "Indie Films";
      
      const isFromGenreList = genres.some(g => {
        if (g === "Indie") return false;
        return m.listSource === g;
      });
      
      const genreFilters = genres.filter(g => g !== "Indie");
      const matchesGenre = genreFilters.length > 0 && m.genres.length > 0 && genreFilters.includes(m.genres[0]);
      
      return matchesGenre || isIndie || isFromGenreList || (includeTopPicks && isTopPick) || (includeNewReleases && isNewRelease);
    });
    
    // If STILL not enough, use all post-1980 movies
    if (available.length < 2) {
      console.log("Still not enough, using all available movies");
      available = cache.allMovies.filter((m) => !excludeIds.has(m.id) && (!m.year || m.year >= 1980));
    }
  }
  
  if (available.length < 2) {
    return null;
  }

  // Prefer well-known, recognisable films (rating >= 7.0) so the A/B posters
  // feel familiar and meaningful to users. Fall back to the full filtered pool
  // if the tier is too small (e.g. very niche genre selections).
  const RECOGNIZABLE_MIN_RATING = 7.0;
  const recognizable = available.filter(m => m.rating != null && m.rating >= RECOGNIZABLE_MIN_RATING);
  const pickPool = recognizable.length >= 4 ? recognizable : available;

  const shuffled = shuffleArray(pickPool);
  return [shuffled[0], shuffled[1]];
}
