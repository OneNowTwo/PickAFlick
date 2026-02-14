/**
 * Flicks.com.au scraper for direct streaming links in Australia.
 * Replaces DuckDuckGo/AI lookup with reliable Flicks data.
 */

/** Map TMDb provider names to Flicks provider identifiers for matching */
const TMDb_TO_FLICKS: Record<string, string[]> = {
  "Netflix": ["netflix", "netflix-au"],
  "Stan": ["stan"],
  "Binge": ["binge"],
  "Amazon Prime Video": ["prime-video", "prime-video-au", "prime-video-store", "prime-video-store-au"],
  "Disney+": ["disney-plus", "disney-plus-au"],
  "Apple TV": ["apple-tv", "itunes", "itunes-au"],
  "Paramount+": ["paramount-plus", "paramount-plus-au"],
  "Foxtel": ["foxtel"],
  "YouTube": ["youtube", "youtube-au"],
  "Google Play Movies": ["google-play"],
  "Microsoft Store": ["microsoft-store"],
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract destination URL from affiliate links (u= parameter) or return as-is for direct links */
function resolveUrl(href: string): string {
  const decoded = href.replace(/&amp;/g, "&");
  const uMatch = decoded.match(/[?&]u=([^&]+)/);
  if (uMatch) {
    try {
      return decodeURIComponent(uMatch[1]);
    } catch {
      return decoded;
    }
  }
  return decoded;
}

function hasNonGenericPath(url: URL): boolean {
  const path = (url.pathname || "").toLowerCase();
  if (!path || path === "/" || path === "/au" || path === "/en-au") return false;
  if (path.startsWith("/search")) return false;
  return true;
}

/**
 * Validate that a provider URL is a direct movie page (not homepage/search).
 */
export function isDirectStreamingDeepLink(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    if (!hasNonGenericPath(url)) return false;

    if (host.includes("netflix.com")) return /\/title\/\d+/.test(path);
    if (host.includes("primevideo.com")) return /\/detail\//.test(path) || /\/gp\/video\/detail\//.test(path);
    if (host.includes("tv.apple.com")) return /\/movie\//.test(path);
    if (host.includes("itunes.apple.com")) return /\/movie\//.test(path);
    if (host.includes("stan.com.au")) return /\/watch\//.test(path) || /\/program\//.test(path);
    if (host.includes("binge.com.au")) return /\/(movies|shows)\//.test(path);
    if (host.includes("disneyplus.com")) return /\/(movies|video)\//.test(path);
    if (host.includes("paramountplus.com")) return /\/(movies|shows)\//.test(path);
    if (host.includes("foxtel.com.au")) return /\/watch\//.test(path) || /\/movie\//.test(path);
    if (host.includes("youtube.com")) return /\/watch/.test(path) && url.searchParams.has("v");

    // Unknown hosts: conservative default to non-generic path.
    return hasNonGenericPath(url);
  } catch {
    return false;
  }
}

/** Domain -> Flicks slug mapping for extracting streaming links */
const DOMAIN_TO_SLUG: Record<string, string> = {
  "netflix.com": "netflix",
  "binge.com.au": "binge",
  "stan.com.au": "stan",
  "primevideo.com": "prime-video",
  "tv.apple.com": "apple-tv",
  "itunes.apple.com": "apple-tv",
  "youtube.com": "youtube",
  "disneyplus.com": "disney-plus",
  "paramountplus.com": "paramount-plus",
  "foxtel.com.au": "foxtel",
  "sjv.io": "foxtel", // Foxtel affiliate
  "pxf.io": "prime-video", // Prime affiliate
  "goto.binge.com.au": "binge",
};

/** Parse Flicks movie page HTML and extract provider slug -> URL map */
function parseFlicksHtml(html: string): Map<string, string> {
  const links = new Map<string, string>();
  const hrefRe = /href="(https?:\/\/[^"]+)"/g;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, "&");
    if (href.includes("flicks.com") || href.includes("flicks.co")) continue;
    const resolved = resolveUrl(href);
    if (!isDirectStreamingDeepLink(resolved)) continue;
    for (const [domain, slug] of Object.entries(DOMAIN_TO_SLUG)) {
      if (href.includes(domain) || resolved.includes(domain)) {
        const existing = links.get(slug);
        // For Apple: prefer /movie/ over /show/
        if (slug === "apple-tv" && existing) {
          if (resolved.includes("/movie/") && !existing.includes("/movie/")) {
            links.set(slug, resolved);
          }
          break;
        }
        if (!existing) links.set(slug, resolved);
        break;
      }
    }
  }
  return links;
}

/** Find Flicks URL for a TMDb provider name */
function matchProviderToFlicksLink(
  tmdbName: string,
  flicksLinks: Map<string, string>
): string | null {
  const keys = TMDb_TO_FLICKS[tmdbName];
  if (!keys) return null;
  for (const k of keys) {
    const link = flicksLinks.get(k) ?? flicksLinks.get(k + "-au");
    if (link) return link;
  }
  // Fuzzy: check if any flicks key contains part of tmdb name
  const lower = tmdbName.toLowerCase();
  for (const [slug, url] of Array.from(flicksLinks.entries())) {
    if (slug.includes("prime") && (lower.includes("prime") || lower.includes("amazon"))) return url;
    if (slug.includes("netflix") && lower.includes("netflix")) return url;
    if (slug.includes("binge") && lower.includes("binge")) return url;
    if (slug.includes("stan") && lower.includes("stan")) return url;
    if (slug.includes("apple") && lower.includes("apple")) return url;
    if (slug.includes("youtube") && lower.includes("youtube")) return url;
    if (slug.includes("disney") && lower.includes("disney")) return url;
    if (slug.includes("foxtel") && lower.includes("foxtel")) return url;
  }
  return null;
}

/**
 * Fetch streaming links for a movie from Flicks.com.au.
 * Returns a map of TMDb provider name -> direct watch URL.
 */
export async function getStreamingLinksFromFlicks(
  movieTitle: string,
  _movieYear?: number | null
): Promise<Map<string, string>> {
  const slug = slugify(movieTitle);
  if (!slug) return new Map();

  const url = `https://www.flicks.com.au/movie/${slug}/`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
    });
    if (!res.ok) return new Map();
    const html = await res.text();
    return parseFlicksHtml(html);
  } catch (err) {
    console.error(`Flicks fetch failed for ${movieTitle}:`, err);
    return new Map();
  }
}

/**
 * Get the direct watch URL for a provider from Flicks data.
 * Used by getWatchProviders to resolve deep links.
 */
export function getDeepLinkFromFlicks(
  providerName: string,
  flicksLinks: Map<string, string>
): string | null {
  const link = matchProviderToFlicksLink(providerName, flicksLinks);
  if (!link) return null;
  return isDirectStreamingDeepLink(link) ? link : null;
}

/**
 * Fallback search URL when Flicks has no link for a provider.
 */
export function getSearchURL(movieTitle: string, movieYear: number | null, providerName: string): string {
  const searchQuery = encodeURIComponent(`${movieTitle} ${movieYear || ""}`);
  const lower = providerName.toLowerCase();

  if (lower.includes("netflix")) return `https://www.netflix.com/au/search?q=${searchQuery}`;
  if (lower.includes("stan")) return `https://www.stan.com.au/search?q=${searchQuery}`;
  if (lower.includes("disney")) return `https://www.disneyplus.com/search?q=${searchQuery}`;
  if (lower.includes("binge")) return `https://binge.com.au/search?q=${searchQuery}`;
  if (lower.includes("hbo") || lower.includes("max")) return `https://www.hbomax.com/au/en/search?q=${searchQuery}`;
  if (lower.includes("youtube")) return `https://www.youtube.com/results?search_query=${searchQuery}`;
  if (lower.includes("prime") || lower.includes("amazon")) return `https://www.primevideo.com/search?phrase=${searchQuery}`;
  if (lower.includes("apple")) return `https://tv.apple.com/au/search?q=${searchQuery}`;
  if (lower.includes("paramount")) return `https://www.paramountplus.com/au/search/?query=${searchQuery}`;

  return `https://www.google.com/search?q=${encodeURIComponent(`${movieTitle} ${movieYear || ""} watch on ${providerName} Australia`)}`;
}
