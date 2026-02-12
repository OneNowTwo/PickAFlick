import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

interface StreamingLinkRequest {
  movieTitle: string;
  movieYear: number | null;
  providerName: string;
  tmdbId: number;
}

/**
 * Create URL slug from movie title: lowercase, hyphens, remove special chars
 * e.g. "Another Year" -> "another-year"
 */
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[&':]/g, "") // Remove apostrophes etc
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^[-]+|[-]+$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Build direct movie page URL for services with known URL patterns (Australia)
 * Returns the actual watch page URL, NOT search
 */
function buildDirectURL(movieTitle: string, movieYear: number | null, providerName: string): string | null {
  const slug = toSlug(movieTitle);
  const slugWithYear = movieYear ? `${slug}-${movieYear}` : slug;
  const lowerProvider = providerName.toLowerCase();

  // Stan: https://www.stan.com.au/watch/another-year-2010
  if (lowerProvider.includes("stan")) {
    return `https://www.stan.com.au/watch/${slugWithYear}`;
  }

  // Binge: https://binge.com.au/movies/movie-slug (similar pattern)
  if (lowerProvider.includes("binge")) {
    return `https://binge.com.au/movies/${slugWithYear}`;
  }

  // Disney+ AU: https://www.disneyplus.com/movies/title-slug/ID (we use slug, ID unknown)
  if (lowerProvider.includes("disney")) {
    return `https://www.disneyplus.com/au/movies/${slugWithYear}`;
  }

  // Prime Video uses alphanumeric IDs - can't build from slug, AI handles it

  // Paramount+ AU
  if (lowerProvider.includes("paramount")) {
    return `https://www.paramountplus.com/au/movies/${slugWithYear}`;
  }

  // Foxtel Now
  if (lowerProvider.includes("foxtel")) {
    return `https://www.foxtel.com.au/watch/movies/${slugWithYear}`;
  }

  // Apple TV: https://tv.apple.com/au/movie/title-slug/XXX
  if (lowerProvider.includes("apple")) {
    return `https://tv.apple.com/au/movie/${slugWithYear}`;
  }

  // HBO Max / Max: https://www.hbomax.com/au/en/movies/shazam-fury-of-the-gods/[uuid]
  // Slug-only path often works; some pages may need full UUID (AI can help)
  if (lowerProvider.includes("hbo") || lowerProvider.includes("max")) {
    return `https://www.hbomax.com/au/en/movies/${slugWithYear}`;
  }

  // YouTube / YouTube Movies: no slug-based URLs; use search to find movie to rent
  if (lowerProvider.includes("youtube")) {
    const q = encodeURIComponent(`${movieTitle} ${movieYear || ""} movie`);
    return `https://www.youtube.com/results?search_query=${q}`;
  }

  // For Netflix we need the internal ID - can't build from slug alone
  // Return null so AI can try
  return null;
}

/**
 * Use AI to find the actual deep link URL for a movie on a specific streaming service
 * Only used when buildDirectURL can't produce a URL (e.g. Netflix needs internal ID)
 */
export async function getStreamingDeepLink(request: StreamingLinkRequest): Promise<string | null> {
  // First try deterministic URL building for known patterns
  const built = buildDirectURL(request.movieTitle, request.movieYear, request.providerName);
  if (built) {
    return built;
  }

  try {
    const prompt = `Return the EXACT direct movie page URL to watch "${request.movieTitle}" (${request.movieYear || ""}) on ${request.providerName} in Australia.

REQUIRED: Return ONLY a direct URL to the movie's watch page. NO search URLs.
Examples of correct format:
- Stan: https://www.stan.com.au/watch/another-year-2010
- Binge: https://binge.com.au/movies/movie-name-2020
- HBO Max: https://www.hbomax.com/au/en/movies/movie-name-2020
- Netflix: https://www.netflix.com/au/title/70136120
- Disney+: https://www.disneyplus.com/au/movies/movie-name/ID

Return ONLY the URL, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You return only direct movie page URLs for Australian streaming services. Never return search URLs. URL only, no explanation."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0,
      max_tokens: 150,
    });

    const response = completion.choices[0].message.content?.trim();
    
    if (!response || !response.startsWith("http")) {
      return null;
    }

    // Reject if it's a search URL
    if (response.includes("/search") || response.includes("?q=") || response.includes("?q=")) {
      return null;
    }

    return response;
  } catch (error) {
    console.error(`AI deep link failed for ${request.movieTitle} on ${request.providerName}:`, error);
    return null;
  }
}

/**
 * Generate fallback - only used when both buildDirectURL and AI return null
 */
export function getSearchURL(movieTitle: string, movieYear: number | null, providerName: string): string {
  const searchQuery = encodeURIComponent(`${movieTitle} ${movieYear || ''}`);
  const lowerProvider = providerName.toLowerCase();

  if (lowerProvider.includes('netflix')) return `https://www.netflix.com/au/search?q=${searchQuery}`;
  if (lowerProvider.includes('stan')) return `https://www.stan.com.au/search?q=${searchQuery}`;
  if (lowerProvider.includes('disney')) return `https://www.disneyplus.com/search?q=${searchQuery}`;
  if (lowerProvider.includes('binge')) return `https://binge.com.au/search?q=${searchQuery}`;
  if (lowerProvider.includes('hbo') || lowerProvider.includes('max')) return `https://www.hbomax.com/au/en/search?q=${searchQuery}`;
  if (lowerProvider.includes('youtube')) return `https://www.youtube.com/results?search_query=${searchQuery}`;
  if (lowerProvider.includes('prime') || lowerProvider.includes('amazon')) return `https://www.primevideo.com/search?phrase=${searchQuery}`;
  if (lowerProvider.includes('apple')) return `https://tv.apple.com/au/search?q=${searchQuery}`;
  if (lowerProvider.includes('paramount')) return `https://www.paramountplus.com/au/search/?query=${searchQuery}`;

  return `https://www.google.com/search?q=${encodeURIComponent(`${movieTitle} ${movieYear || ''} watch on ${providerName} Australia`)}`;
}
