import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface StreamingLinkRequest {
  movieTitle: string;
  movieYear: number | null;
  providerName: string;
  tmdbId: number;
}

/**
 * Use AI to find the actual deep link URL for a movie on a specific streaming service
 */
export async function getStreamingDeepLink(request: StreamingLinkRequest): Promise<string | null> {
  try {
    const prompt = `You are a streaming service URL expert. I need the EXACT direct URL to watch this movie on the specified streaming platform in Australia.

Movie: "${request.movieTitle}" (${request.movieYear || 'N/A'})
Streaming Service: ${request.providerName}
TMDb ID: ${request.tmdbId}

IMPORTANT INSTRUCTIONS:
1. Return ONLY the direct movie page URL for ${request.providerName} in Australia
2. Use the Australian domain (.com.au for Netflix, Stan, etc.)
3. Do NOT return search URLs - only direct movie page URLs
4. If you cannot find an exact URL, return the word "SEARCH" followed by the best search URL for that service
5. Common patterns:
   - Netflix AU: https://www.netflix.com/au/title/[netflix-id]
   - Stan: https://www.stan.com.au/watch/[slug]
   - Disney+: https://www.disneyplus.com/movies/[slug]/[id]
   - Binge: https://binge.com.au/movies/[slug]
   - Prime Video: https://www.primevideo.com/detail/[id]
   - Apple TV: https://tv.apple.com/au/movie/[slug]/[id]

Return ONLY the URL, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a streaming URL expert. Return only the direct URL to the movie page, nothing else. If you must use a search URL, prefix it with 'SEARCH: '."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const response = completion.choices[0].message.content?.trim();
    
    if (!response) {
      return null;
    }

    // If AI returns a search URL, extract it
    if (response.startsWith("SEARCH")) {
      return response.replace("SEARCH:", "").trim();
    }

    // Validate it's a URL
    if (response.startsWith("http://") || response.startsWith("https://")) {
      return response;
    }

    console.log(`AI could not find URL for ${request.movieTitle} on ${request.providerName}: ${response}`);
    return null;
  } catch (error) {
    console.error(`Error getting deep link for ${request.movieTitle} on ${request.providerName}:`, error);
    return null;
  }
}

/**
 * Generate fallback search URL for a streaming service
 */
export function getSearchURL(movieTitle: string, movieYear: number | null, providerName: string): string {
  const searchQuery = encodeURIComponent(`${movieTitle} ${movieYear || ''}`);
  const lowerProvider = providerName.toLowerCase();

  // Provider-specific search URLs for Australia
  if (lowerProvider.includes('netflix')) {
    return `https://www.netflix.com/au/search?q=${searchQuery}`;
  }
  if (lowerProvider.includes('stan')) {
    return `https://www.stan.com.au/search?q=${searchQuery}`;
  }
  if (lowerProvider.includes('disney')) {
    return `https://www.disneyplus.com/search?q=${searchQuery}`;
  }
  if (lowerProvider.includes('binge')) {
    return `https://binge.com.au/search?q=${searchQuery}`;
  }
  if (lowerProvider.includes('prime') || lowerProvider.includes('amazon')) {
    return `https://www.primevideo.com/search?phrase=${searchQuery}`;
  }
  if (lowerProvider.includes('apple')) {
    return `https://tv.apple.com/au/search?q=${searchQuery}`;
  }
  if (lowerProvider.includes('paramount')) {
    return `https://www.paramountplus.com/au/search/?query=${searchQuery}`;
  }

  // Generic fallback: Google search for the movie + service
  return `https://www.google.com/search?q=${encodeURIComponent(`${movieTitle} ${movieYear || ''} watch on ${providerName} Australia`)}`;
}
