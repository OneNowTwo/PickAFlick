/**
 * Scrapes movie titles from editorial list pages (Rotten Tomatoes, Rolling Stone,
 * Empire, IndieWire, Variety). Returns the same shape as IMDb scraper for catalogue integration.
 */

export interface EditorialListItem {
  title: string;
  year: number | undefined;
}

interface EditorialSource {
  url: string;
  listName: string;
  /** Regex to extract title and year. Must have groups: (title)(year) */
  pattern: RegExp;
}

const EDITORIAL_SOURCES: EditorialSource[] = [
  // Rotten Tomatoes - format: ## Title (Year) XX%
  { url: "https://editorial.rottentomatoes.com/guide/best-fantasy-movies-of-all-time/", listName: "Fantasy", pattern: /##\s+([^(]+)\s+\((\d{4})\)\s+\d+%/g },
  { url: "https://editorial.rottentomatoes.com/guide/essential-comedy-movies/", listName: "Comedy", pattern: /##\s+([^(]+)\s+\((\d{4})\)\s+[\d%]+/g },
  { url: "https://editorial.rottentomatoes.com/guide/essential-sci-fi-movies-of-all-time/", listName: "Sci-Fi", pattern: /##\s+([^(]+)\s+\((\d{4})\)\s+\d+%/g },
  { url: "https://editorial.rottentomatoes.com/guide/best-horror-movies-of-all-time/", listName: "Horror", pattern: /##\s+([^(]+)\s+\((\d{4})\)\s+\d+%/g },
  { url: "https://editorial.rottentomatoes.com/guide/best-romantic-comedies-of-all-time/", listName: "Romance", pattern: /##\s+([^(]+)\s+\((\d{4})\)\s+[\d%]+/g },
  // Rolling Stone - format: ## 'Title' (Year)
  { url: "https://www.rollingstone.com/tv-movies/tv-movie-lists/greatest-comedies-of-the-21st-century-630244/", listName: "Comedy", pattern: /##\s+'([^']+)'\s+\((\d{4})\)/g },
  { url: "https://www.rollingstone.com/tv-movies/tv-movie-lists/best-sci-fi-movies-1234893930/", listName: "Sci-Fi", pattern: /##\s+'([^']+)'\s+\((\d{4})\)/g },
  { url: "https://www.rollingstone.com/tv-movies/tv-movie-lists/greatest-horror-movies-of-the-21st-century-103994/", listName: "Horror", pattern: /##\s+'([^']+)'\s+\((\d{4})\)/g },
  // Empire - format: ### N) Title (Year)
  { url: "https://www.empireonline.com/movies/features/best-sci-fi-movies/", listName: "Sci-Fi", pattern: /###\s+\d+\)\s+([^(]+?)\s+\((\d{4})\)/g },
  { url: "https://www.empireonline.com/movies/features/best-horror-movies/", listName: "Horror", pattern: /###\s+\d+\)\s+([^(]+?)\s+\((\d{4})\)/g },
  { url: "https://www.empireonline.com/movies/features/best-romantic-movies/", listName: "Romance", pattern: /###\s+\d+\)\s+([^(]+?)\s+\((\d{4})\)/g },
  // Variety - format: ## Title (Year)
  { url: "https://variety.com/lists/best-romantic-movies/", listName: "Romance", pattern: /##\s+([^(]+)\s+\((\d{4})\)/g },
  // IndieWire - format: ## "Title" (Year) or ## "Title" (Director, Year)
  { url: "https://www.indiewire.com/lists/best-fantasy-movies-all-time/", listName: "Fantasy", pattern: /##\s+"([^"]+)"\s+\([^)]*(\d{4})\)/g },
  { url: "https://www.indiewire.com/feature/best-romance-movies-ranked-1201849113/", listName: "Romance", pattern: /##\s+"([^"]+)"\s+\([^)]*(\d{4})\)/g },
];

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

async function fetchEditorialPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) {
      console.error(`Editorial fetch failed ${url}: ${response.status}`);
      return "";
    }
    return await response.text();
  } catch (error) {
    console.error(`Editorial fetch error ${url}:`, error);
    return "";
  }
}

function parseWithPattern(html: string, source: EditorialSource): EditorialListItem[] {
  const items: EditorialListItem[] = [];
  const pattern = new RegExp(source.pattern.source, source.pattern.flags);
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const title = (match[1] || "").trim();
    const year = parseInt(match[2], 10);

    if (title && title.length > 1 && year >= 1900 && year <= 2030) {
      items.push({
        title: decodeHtmlEntities(title),
        year,
      });
    }
  }

  return items;
}

/** Fallback: generic "Title (Year)" pattern for any page */
function parseGenericTitleYear(html: string): EditorialListItem[] {
  const items: EditorialListItem[] = [];
  const genericPattern = /(?:^|\n)\s*[#\d.]*\s*["']?([^"'\n]{2,80})["']?\s*\((\d{4})\)/gm;
  let match;
  while ((match = genericPattern.exec(html)) !== null) {
    const title = match[1].trim();
    const year = parseInt(match[2], 10);
    if (title && year >= 1900 && year <= 2030) {
      items.push({ title: decodeHtmlEntities(title), year });
    }
  }
  return items;
}

export async function getAllEditorialMovies(): Promise<Map<string, EditorialListItem[]>> {
  const results = new Map<string, EditorialListItem[]>();

  for (const source of EDITORIAL_SOURCES) {
    const html = await fetchEditorialPage(source.url);
    if (!html) continue;

    let items = parseWithPattern(html, source);
    if (items.length === 0) {
      items = parseGenericTitleYear(html);
    }

    if (items.length > 0) {
      const seen = new Set<string>();
      const unique = items.filter((item) => {
        const key = `${item.title.toLowerCase()}-${item.year}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const existing = results.get(source.listName) || [];
      results.set(source.listName, [...existing, ...unique]);
      console.log(`Editorial: ${source.listName} from ${new URL(source.url).hostname} - ${unique.length} movies`);
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  return results;
}
