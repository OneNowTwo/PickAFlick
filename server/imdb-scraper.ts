interface IMDbListItem {
  title: string;
  year: number | undefined;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

const IMDB_LISTS = [
  { id: "ls094921320", name: "Top 250 Movies" },
  { id: "ls003501243", name: "Best Horror Movies" },
  { id: "ls002065120", name: "Classic Movies" },
  { id: "ls000873904", name: "Best Comedies" },
  { id: "ls005747458", name: "Critically Acclaimed" },
];

async function fetchIMDbList(listId: string): Promise<IMDbListItem[]> {
  const url = `https://www.imdb.com/list/${listId}/`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch IMDb list ${listId}: ${response.status}`);
      return [];
    }

    const html = await response.text();
    const items: IMDbListItem[] = [];

    const titleRegex = /<h3 class="ipc-title__text"[^>]*>[\s\S]*?<a[^>]*href="\/title\/[^"]*"[^>]*>([^<]+)<\/a>/g;
    const altTitleRegex = /class="lister-item-header"[\s\S]*?<a[^>]*href="\/title\/[^"]*"[^>]*>([^<]+)<\/a>[\s\S]*?<span class="lister-item-year[^"]*">\((\d{4})\)/g;
    
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        if (jsonData.itemListElement && Array.isArray(jsonData.itemListElement)) {
          for (const item of jsonData.itemListElement) {
            if (item.item && item.item.name) {
              const yearMatch = item.item.name.match(/\((\d{4})\)/);
              items.push({
                title: decodeHtmlEntities(item.item.name.replace(/\s*\(\d{4}\)\s*$/, "").trim()),
                year: yearMatch ? parseInt(yearMatch[1]) : undefined,
              });
            }
          }
        }
      } catch (e) {
        console.log("Failed to parse JSON-LD, falling back to regex");
      }
    }

    if (items.length === 0) {
      const modernListRegex = /"titleText":\{"text":"([^"]+)"\}[\s\S]*?"releaseYear":\{"year":(\d{4})/g;
      let match;
      while ((match = modernListRegex.exec(html)) !== null) {
        items.push({
          title: decodeHtmlEntities(match[1]),
          year: parseInt(match[2]),
        });
      }
    }

    if (items.length === 0) {
      const simpleRegex = /href="\/title\/tt\d+\/"[^>]*>([^<]+)<\/a>[\s\S]{0,500}?(?:\((\d{4})\)|"releaseYear":\{"year":(\d{4})\})/g;
      let match;
      while ((match = simpleRegex.exec(html)) !== null) {
        const title = decodeHtmlEntities(match[1].trim());
        const year = parseInt(match[2] || match[3]);
        if (title && !title.includes("See more") && title.length > 1) {
          items.push({ title, year: isNaN(year) ? undefined : year });
        }
      }
    }

    const seen = new Set<string>();
    const uniqueItems = items.filter((item) => {
      const key = `${item.title.toLowerCase()}-${item.year}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`Fetched ${uniqueItems.length} movies from IMDb list ${listId}`);
    return uniqueItems;
  } catch (error) {
    console.error(`Error fetching IMDb list ${listId}:`, error);
    return [];
  }
}

export async function getAllIMDbMovies(): Promise<Map<string, IMDbListItem[]>> {
  const results = new Map<string, IMDbListItem[]>();

  for (const list of IMDB_LISTS) {
    const items = await fetchIMDbList(list.id);
    results.set(list.name, items);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return results;
}

export function getIMDbLists() {
  return IMDB_LISTS;
}

export async function getMoviesFromList(listId: string): Promise<IMDbListItem[]> {
  return fetchIMDbList(listId);
}
