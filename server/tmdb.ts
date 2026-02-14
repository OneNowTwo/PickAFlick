import type { Movie } from "@shared/schema";

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = "https://api.themoviedb.org/3";

interface TMDbSearchResult {
  id: number;
  title: string;
  release_date?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  vote_average: number;
  genre_ids: number[];
}

interface TMDbMovieDetails {
  id: number;
  title: string;
  release_date?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  vote_average: number;
  runtime: number | null;
  genres: { id: number; name: string }[];
  original_language?: string;
  credits?: {
    cast: { id: number; name: string; character: string; order: number }[];
    crew: { id: number; name: string; job: string }[];
  };
  keywords?: {
    keywords: { id: number; name: string }[];
  };
}

interface TMDbVideoResult {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

interface TMDbWatchProvider {
  logo_path: string;
  provider_id: number;
  provider_name: string;
  display_priority: number;
}

interface TMDbWatchProvidersResponse {
  results: {
    AU?: {
      link?: string;
      flatrate?: TMDbWatchProvider[];
      rent?: TMDbWatchProvider[];
      buy?: TMDbWatchProvider[];
    };
  };
}

export interface WatchProvider {
  id: number;
  name: string;
  logoPath: string;
  type: "subscription" | "rent" | "buy";
  deepLink: string;
}

export interface WatchProvidersResult {
  link: string | null;
  providers: WatchProvider[];
}

const GENRE_MAP: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

async function tmdbFetch<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  if (!TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is not set");
  }

  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`TMDb API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function normalizeTitleForSearch(title: string): string {
  return title
    .replace(/[’']/g, "")
    .replace(/[:,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function tmdbSearchWithParams(params: Record<string, string>): Promise<TMDbSearchResult[]> {
  const data = await tmdbFetch<{ results: TMDbSearchResult[] }>("/search/movie", params);
  return data.results ?? [];
}

export async function searchMovie(title: string, year?: number): Promise<TMDbSearchResult | null> {
  const normalized = normalizeTitleForSearch(title);
  const baseQueries = Array.from(new Set([title, normalized].filter(Boolean)));

  const queryVariants: Array<Record<string, string>> = [];
  for (const q of baseQueries) {
    if (year) queryVariants.push({ query: q, year: year.toString() });
    queryVariants.push({ query: q });
  }

  for (const params of queryVariants) {
    const results = await tmdbSearchWithParams(params);
    if (results.length === 0) continue;

    if (year) {
      const exactMatch = results.find((r) => {
        const releaseYear = r.release_date ? parseInt(r.release_date.split("-")[0]) : null;
        return releaseYear === year;
      });
      if (exactMatch) return exactMatch;
    }

    return results[0];
  }

  return null;
}

// Alias for AI recommender - returns just id for lookup
export async function searchMovieByTitle(title: string, year?: number): Promise<{ id: number } | null> {
  const result = await searchMovie(title, year);
  return result ? { id: result.id } : null;
}

export async function getMovieDetails(tmdbId: number): Promise<Movie | null> {
  try {
    const data = await tmdbFetch<TMDbMovieDetails>(
      `/movie/${tmdbId}`,
      { append_to_response: "credits,keywords" }
    );

    const year = data.release_date ? parseInt(data.release_date.split("-")[0]) : null;
    
    // Extract director from crew
    const director = data.credits?.crew?.find((c) => c.job === "Director")?.name || null;
    
    // Extract top 5 cast members
    const cast = data.credits?.cast
      ?.sort((a, b) => a.order - b.order)
      ?.slice(0, 5)
      ?.map((c) => c.name) || [];
    
    // Extract keywords
    const keywords = data.keywords?.keywords?.slice(0, 10)?.map((k) => k.name) || [];

    return {
      id: data.id,
      tmdbId: data.id,
      title: data.title,
      year,
      posterPath: data.poster_path,
      backdropPath: data.backdrop_path,
      overview: data.overview,
      genres: data.genres.map((g) => g.name),
      rating: data.vote_average || null,
      listSource: "",
      director,
      cast,
      runtime: data.runtime || null,
      keywords,
      original_language: data.original_language || null,
    };
  } catch (error) {
    console.error(`Failed to get movie details for ${tmdbId}:`, error);
    return null;
  }
}

export async function getMovieTrailer(tmdbId: number): Promise<string | null> {
  const trailers = await getMovieTrailers(tmdbId);
  return trailers.length > 0 ? trailers[0] : null;
}

// Returns multiple trailer URLs for fallback when one is region-blocked
export async function getMovieTrailers(tmdbId: number): Promise<string[]> {
  try {
    // Collect videos from multiple regions/languages for better coverage
    const allVideos: TMDbVideoResult[] = [];
    const seenKeys = new Set<string>();
    
    // Try AU region first
    try {
      const auData = await tmdbFetch<{ results: TMDbVideoResult[] }>(`/movie/${tmdbId}/videos`, { 
        language: "en-AU" 
      });
      for (const v of auData.results) {
        if (!seenKeys.has(v.key)) {
          seenKeys.add(v.key);
          allVideos.push(v);
        }
      }
    } catch (e) { /* ignore */ }

    // Try US region
    try {
      const usData = await tmdbFetch<{ results: TMDbVideoResult[] }>(`/movie/${tmdbId}/videos`, {
        language: "en-US"
      });
      for (const v of usData.results) {
        if (!seenKeys.has(v.key)) {
          seenKeys.add(v.key);
          allVideos.push(v);
        }
      }
    } catch (e) { /* ignore */ }
    
    // Try default (no language filter)
    try {
      const defaultData = await tmdbFetch<{ results: TMDbVideoResult[] }>(`/movie/${tmdbId}/videos`);
      for (const v of defaultData.results) {
        if (!seenKeys.has(v.key)) {
          seenKeys.add(v.key);
          allVideos.push(v);
        }
      }
    } catch (e) { /* ignore */ }

    const youtubeVideos = allVideos.filter((v) => v.site === "YouTube");
    const trailerUrls: string[] = [];

    // Priority 1: Official trailers
    const officialTrailers = youtubeVideos.filter(
      (v) => v.type === "Trailer" && v.official === true
    );
    for (const t of officialTrailers) {
      trailerUrls.push(`https://www.youtube.com/embed/${t.key}`);
    }

    // Priority 2: Non-official trailers
    const otherTrailers = youtubeVideos.filter(
      (v) => v.type === "Trailer" && v.official !== true
    );
    for (const t of otherTrailers) {
      trailerUrls.push(`https://www.youtube.com/embed/${t.key}`);
    }

    // Priority 3: Official teasers
    const officialTeasers = youtubeVideos.filter(
      (v) => v.type === "Teaser" && v.official === true
    );
    for (const t of officialTeasers) {
      trailerUrls.push(`https://www.youtube.com/embed/${t.key}`);
    }

    // Priority 4: Other teasers
    const otherTeasers = youtubeVideos.filter(
      (v) => v.type === "Teaser" && v.official !== true
    );
    for (const t of otherTeasers) {
      trailerUrls.push(`https://www.youtube.com/embed/${t.key}`);
    }

    // Priority 5: Featurettes (fallback when no trailers exist)
    const featurettes = youtubeVideos.filter((v) => v.type === "Featurette");
    for (const v of featurettes) {
      trailerUrls.push(`https://www.youtube.com/embed/${v.key}`);
    }

    // Priority 6: Clips (last resort)
    const clips = youtubeVideos.filter((v) => v.type === "Clip");
    for (const v of clips) {
      trailerUrls.push(`https://www.youtube.com/embed/${v.key}`);
    }

    return trailerUrls;
  } catch (error) {
    console.error(`Failed to get trailers for ${tmdbId}:`, error);
    return [];
  }
}

export async function getFallbackTrailerUrls(title: string, year?: number | null): Promise<string[]> {
  const query = encodeURIComponent(`${title} ${year ?? ""} official trailer`.trim());
  const urls: string[] = [];

  try {
    const response = await fetch(`https://www.youtube.com/results?search_query=${query}`);
    if (!response.ok) return [];
    const html = await response.text();

    const seen = new Set<string>();
    const re = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      urls.push(`https://www.youtube.com/embed/${id}`);
      if (urls.length >= 5) break;
    }
  } catch (error) {
    console.error(`Failed fallback YouTube search for "${title}"`, error);
  }

  return urls;
}

export async function resolveMovieFromTitle(
  title: string,
  year: number | undefined,
  listSource: string
): Promise<Movie | null> {
  const searchResult = await searchMovie(title, year);
  
  if (!searchResult) {
    console.log(`No TMDb match found for: ${title} (${year})`);
    return null;
  }

  const movie = await getMovieDetails(searchResult.id);
  
  if (movie) {
    movie.listSource = listSource;
  }

  return movie;
}

// Discover movies from TMDb (fallback when IMDb scraping fails)
export async function discoverMovies(
  category: string,
  options: { genreIds?: number[]; minRating?: number; page?: number } = {}
): Promise<Movie[]> {
  try {
    const params: Record<string, string> = {
      sort_by: "vote_count.desc",
      "vote_average.gte": (options.minRating || 6.5).toString(),
      "vote_count.gte": "1000",
      page: (options.page || 1).toString(),
      include_adult: "false",
    };

    if (options.genreIds && options.genreIds.length > 0) {
      params.with_genres = options.genreIds.join(",");
    }

    const data = await tmdbFetch<{ results: TMDbSearchResult[] }>("/discover/movie", params);
    
    const movies: Movie[] = [];
    for (const result of data.results) {
      const movie = await getMovieDetails(result.id);
      if (movie) {
        movie.listSource = category;
        movies.push(movie);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return movies;
  } catch (error) {
    console.error(`Failed to discover movies for ${category}:`, error);
    return [];
  }
}

export async function getPopularMovies(listSource: string, page: number = 1): Promise<Movie[]> {
  try {
    const data = await tmdbFetch<{ results: TMDbSearchResult[] }>("/movie/popular", { page: page.toString() });
    
    const movies: Movie[] = [];
    for (const result of data.results) {
      const movie = await getMovieDetails(result.id);
      if (movie) {
        movie.listSource = listSource;
        movies.push(movie);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return movies;
  } catch (error) {
    console.error("Failed to get popular movies:", error);
    return [];
  }
}

export async function getTopRatedMovies(listSource: string, page: number = 1): Promise<Movie[]> {
  try {
    const data = await tmdbFetch<{ results: TMDbSearchResult[] }>("/movie/top_rated", { page: page.toString() });
    
    const movies: Movie[] = [];
    for (const result of data.results) {
      const movie = await getMovieDetails(result.id);
      if (movie) {
        movie.listSource = listSource;
        movies.push(movie);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return movies;
  } catch (error) {
    console.error("Failed to get top rated movies:", error);
    return [];
  }
}

export async function getNowPlayingMovies(listSource: string, page: number = 1): Promise<Movie[]> {
  try {
    const data = await tmdbFetch<{ results: TMDbSearchResult[] }>("/movie/now_playing", { 
      page: page.toString(),
      region: "AU" // Focus on Australia for more relevant releases
    });
    
    const movies: Movie[] = [];
    for (const result of data.results) {
      const movie = await getMovieDetails(result.id);
      if (movie) {
        movie.listSource = listSource;
        movies.push(movie);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return movies;
  } catch (error) {
    console.error("Failed to get now playing movies:", error);
    return [];
  }
}

export async function getWatchProviders(tmdbId: number, movieTitle?: string, movieYear?: number | null): Promise<WatchProvidersResult> {
  try {
    const [data, flicksLinks] = await Promise.all([
      tmdbFetch<TMDbWatchProvidersResponse>(`/movie/${tmdbId}/watch/providers`),
      movieTitle ? import("./streaming-links").then(({ getStreamingLinksFromFlicks }) => getStreamingLinksFromFlicks(movieTitle, movieYear)) : Promise.resolve(new Map<string, string>()),
    ]);

    const auData = data.results.AU;
    if (!auData) {
      return { link: null, providers: [] };
    }

    const { getDeepLinkFromFlicks, isDirectStreamingDeepLink } = await import("./streaming-links");

    const addProvider = (p: { provider_id: number; provider_name: string; logo_path: string }, type: "subscription" | "rent" | "buy", providers: WatchProvider[]) => {
      if (providers.find((existing) => existing.id === p.provider_id)) return;
      const deepLink = getDeepLinkFromFlicks(p.provider_name, flicksLinks) ?? undefined;
      if (!deepLink) return;
      if (!isDirectStreamingDeepLink(deepLink)) return;
      providers.push({
        id: p.provider_id,
        name: p.provider_name,
        logoPath: p.logo_path,
        type,
        deepLink,
      });
    };

    const providers: WatchProvider[] = [];

    for (const p of auData.flatrate ?? []) {
      addProvider(p, "subscription", providers);
    }
    for (const p of auData.rent ?? []) {
      addProvider(p, "rent", providers);
    }
    for (const p of auData.buy ?? []) {
      addProvider(p, "buy", providers);
    }

    return {
      link: auData.link || null,
      providers,
    };
  } catch (error) {
    console.error(`Failed to get watch providers for ${tmdbId}:`, error);
    return { link: null, providers: [] };
  }
}
