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

export async function searchMovie(title: string, year?: number): Promise<TMDbSearchResult | null> {
  const params: Record<string, string> = { query: title };
  if (year) {
    params.year = year.toString();
  }

  const data = await tmdbFetch<{ results: TMDbSearchResult[] }>("/search/movie", params);
  
  if (data.results.length === 0) {
    return null;
  }

  if (year) {
    const exactMatch = data.results.find((r) => {
      const releaseYear = r.release_date ? parseInt(r.release_date.split("-")[0]) : null;
      return releaseYear === year;
    });
    if (exactMatch) return exactMatch;
  }

  return data.results[0];
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
    };
  } catch (error) {
    console.error(`Failed to get movie details for ${tmdbId}:`, error);
    return null;
  }
}

export async function getMovieTrailer(tmdbId: number): Promise<string | null> {
  try {
    const data = await tmdbFetch<{ results: TMDbVideoResult[] }>(`/movie/${tmdbId}/videos`);

    const trailer = data.results.find(
      (v) =>
        v.site === "YouTube" &&
        (v.type === "Trailer" || v.type === "Teaser" || v.type === "Official" || v.type === "Clip")
    );

    if (trailer) {
      return `https://www.youtube.com/embed/${trailer.key}`;
    }

    const anyYouTube = data.results.find((v) => v.site === "YouTube");
    if (anyYouTube) {
      return `https://www.youtube.com/embed/${anyYouTube.key}`;
    }

    return null;
  } catch (error) {
    console.error(`Failed to get trailer for ${tmdbId}:`, error);
    return null;
  }
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
