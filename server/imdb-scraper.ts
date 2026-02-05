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
  { id: "ls561898139", name: "Horror Classics" }, // Additional horror list
  { id: "ls002065120", name: "Classic Movies" },
  { id: "ls055592025", name: "Best Comedies" }, // 50 Best Comedy Movies of All Time
  { id: "ls005747458", name: "Critically Acclaimed" },
  { id: "ls006660717", name: "Indie Films" }, // Indie/Arthouse films
  { id: "ls4156672710", name: "Indie Films" }, // A24 Movies (2026+)
  { id: "ls000942888", name: "Indie Films" }, // Indie Top 50
  { id: "ls000551942", name: "Indie Films" }, // 50 Greatest Independent Films
  { id: "ls000093103", name: "Action" }, // Top 100 Action Movies
  { id: "ls006639119", name: "Romance" }, // Best Romance Movies
  { id: "ls000093512", name: "Sci-Fi" }, // Top Rated Sci-Fi Movies
  { id: "ls000045692", name: "Western" }, // The Top 50 Best Western Movies
  { id: "ls021031406", name: "Thriller" }, // Best Thrillers of All Time
  { id: "ls055731784", name: "War" }, // Top 25 Greatest War Movies of All Time
  { id: "ls000032409", name: "Documentary" }, // Top 250 Documentaries
  { id: "ls072723334", name: "Family" }, // Best Rated Family Movies
];

async function fetchIMDbList(listId: string): Promise<IMDbListItem[]> {
  const url = `https://www.imdb.com/list/${listId}/`;
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch IMDb list ${listId}: ${response.status}`);
      return [];
    }

    const html = await response.text();
    const items: IMDbListItem[] = [];

    // Try parsing __NEXT_DATA__ JSON (modern IMDb uses Next.js)
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const listItems = nextData?.props?.pageProps?.list?.items || 
                          nextData?.props?.pageProps?.mainColumnData?.predefinedList?.titleListItemSearch?.edges ||
                          [];
        
        for (const item of listItems) {
          const titleText = item?.item?.titleText?.text || 
                           item?.listItem?.titleText?.text ||
                           item?.node?.item?.titleText?.text ||
                           item?.node?.listItem?.titleText?.text;
          const year = item?.item?.releaseYear?.year || 
                      item?.listItem?.releaseYear?.year ||
                      item?.node?.item?.releaseYear?.year ||
                      item?.node?.listItem?.releaseYear?.year;
          
          if (titleText) {
            items.push({
              title: decodeHtmlEntities(titleText),
              year: year || undefined,
            });
          }
        }
        
        if (items.length > 0) {
          console.log(`Parsed ${items.length} movies from __NEXT_DATA__ for list ${listId}`);
        }
      } catch (e) {
        console.log("Failed to parse __NEXT_DATA__, trying other methods");
      }
    }

    // Try JSON-LD structured data
    if (items.length === 0) {
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
          console.log("Failed to parse JSON-LD");
        }
      }
    }

    // Try extracting from inline JSON data patterns
    if (items.length === 0) {
      const titleYearRegex = /"titleText":\s*\{\s*"text"\s*:\s*"([^"]+)"\s*\}[^}]*"releaseYear":\s*\{\s*"year"\s*:\s*(\d{4})/g;
      let match;
      while ((match = titleYearRegex.exec(html)) !== null) {
        items.push({
          title: decodeHtmlEntities(match[1]),
          year: parseInt(match[2]),
        });
      }
    }

    // Fallback: Try extracting title/year from visible HTML
    if (items.length === 0) {
      const listItemRegex = /data-testid="list-page-mc-list-item"[\s\S]*?aria-label="([^"]+)"[\s\S]*?\((\d{4})\)/g;
      let match;
      while ((match = listItemRegex.exec(html)) !== null) {
        items.push({
          title: decodeHtmlEntities(match[1].trim()),
          year: parseInt(match[2]),
        });
      }
    }

    // Another fallback pattern for h3 titles
    if (items.length === 0) {
      const altRegex = /<a[^>]*href="\/title\/tt\d+\/?"[^>]*class="[^"]*ipc-title-link-wrapper[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g;
      let match;
      while ((match = altRegex.exec(html)) !== null) {
        const title = decodeHtmlEntities(match[1].replace(/^\d+\.\s*/, '').trim());
        if (title && title.length > 1) {
          items.push({ title, year: undefined });
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
