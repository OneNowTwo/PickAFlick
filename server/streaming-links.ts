import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface StreamingLinkRequest {
  movieTitle: string;
  movieYear: number | null;
  providerName: string;
  tmdbId: number;
}

function getProviderDomains(providerName: string): string[] {
  const lower = providerName.toLowerCase();
  if (lower.includes("netflix")) return ["netflix.com"];
  if (lower.includes("stan")) return ["stan.com.au"];
  if (lower.includes("binge")) return ["binge.com.au"];
  if (lower.includes("prime") || lower.includes("amazon")) return ["primevideo.com", "amazon.com"];
  if (lower.includes("disney")) return ["disneyplus.com"];
  if (lower.includes("apple")) return ["tv.apple.com"];
  if (lower.includes("paramount")) return ["paramountplus.com"];
  if (lower.includes("max") || lower.includes("hbo")) return ["max.com", "hbomax.com"];
  if (lower.includes("youtube")) return ["youtube.com"];
  return [];
}

function looksLikeDirectTitleUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes("/search") || lower.includes("?q=") || lower.includes("search_query=")) return false;
  if (lower.includes("/signin") || lower.includes("/login") || lower.includes("/browse")) return false;
  if (lower.includes("justwatch.com") || lower.includes("themoviedb.org") || lower.includes("tmdb.org")) return false;
  return true;
}

async function findProviderDeepLinkViaSearch(request: StreamingLinkRequest): Promise<string | null> {
  const providerDomains = getProviderDomains(request.providerName);
  if (providerDomains.length === 0) return null;

  const query = `${request.movieTitle} ${request.movieYear ?? ""} ${request.providerName} Australia`;
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) return null;
  const html = await response.text();
  const links = Array.from(html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/g)).map((m) => m[1]);

  for (const candidate of links) {
    const decoded = candidate.startsWith("//") ? `https:${candidate}` : candidate;
    if (!decoded.startsWith("http")) continue;
    if (!providerDomains.some((domain) => decoded.includes(domain))) continue;
    if (!looksLikeDirectTitleUrl(decoded)) continue;
    return decoded;
  }

  return null;
}

/**
 * Use AI to find the actual deep link URL for a movie on a specific streaming service.
 * Slug-based URLs are unreliable (404s, wrong format) - AI is used for all providers.
 */
export async function getStreamingDeepLink(request: StreamingLinkRequest): Promise<string | null> {
  // YouTube has no direct movie pages - use search
  const lowerProvider = request.providerName.toLowerCase();
  if (lowerProvider.includes("youtube")) {
    const q = encodeURIComponent(`${request.movieTitle} ${request.movieYear || ""} movie`);
    return `https://www.youtube.com/results?search_query=${q}`;
  }

  try {
    const searchedLink = await findProviderDeepLinkViaSearch(request);
    if (searchedLink) {
      return searchedLink;
    }

    const prompt = `Find the EXACT direct URL where I can watch the movie "${request.movieTitle}"${request.movieYear ? ` (${request.movieYear})` : ""} on ${request.providerName} in Australia.

CRITICAL: Return ONLY the direct movie/watch page URL. Not a search page, not a homepage.
- Netflix AU: https://www.netflix.com/au/title/[numeric-id]
- Stan: https://www.stan.com.au/watch/[slug] (slug format varies per title)
- Binge: https://binge.com.au/movies/[slug]
- Amazon Prime: https://www.primevideo.com/region/au/detail/[alphanumeric-id] or /detail/0XXXX
- Disney+ AU: https://www.disneyplus.com/au/movies/[slug]/[id]
- HBO Max: https://www.hbomax.com/au/en/movies/[slug]/[uuid]
- Apple TV: https://tv.apple.com/au/movie/[slug]/[id]

Use the Australian domain (.com.au) where the service has one. If the movie is not available on this service in Australia, return the word UNAVAILABLE.
Return ONLY the URL or UNAVAILABLE, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at finding streaming URLs. You know the exact URL structure for each Australian streaming service. Return only the direct watch URL for the movie on that service. No search URLs, no explanations. If unsure, return UNAVAILABLE."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0,
      max_tokens: 250,
    });

    const response = completion.choices[0].message.content?.trim();
    
    if (!response || response === "UNAVAILABLE") {
      return null;
    }

    // Extract URL if AI wrapped it in markdown or extra text
    const urlMatch = response.match(/https?:\/\/[^\s\]\)"']+/);
    const url = urlMatch ? urlMatch[0] : response;

    if (!url.startsWith("http")) {
      return null;
    }

    // Reject search URLs
    if (!looksLikeDirectTitleUrl(url)) {
      return null;
    }

    return url;
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
