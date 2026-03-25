interface IMDbListItem {
  title: string;
  year: number | undefined;
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

function decodeHtmlEntities(text: string): string {
  return stripHtmlTags(text)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    // Numeric decimal entities (e.g. &#8220; &#8216; &#8217; &#8221;)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    // Numeric hex entities
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

const IMDB_LISTS = [
  { id: "ls094921320", name: "Top 250 Movies" },
  { id: "ls003501243", name: "Horror" },
  { id: "ls561898139", name: "Horror" },
  { id: "ls006339065", name: "Horror" },
  { id: "ls062655785", name: "Horror" },
  { id: "ls004043006", name: "Horror" },
  { id: "ls064647874", name: "Horror" },
  { id: "ls045568293", name: "Horror" },
  { id: "ls002065120", name: "Classic Movies" },
  { id: "ls058726648", name: "Comedy" },
  { id: "ls592119934", name: "Comedy" },
  { id: "ls005747458", name: "Critically Acclaimed" },
  { id: "ls006660717", name: "Indie Films" }, // Indie/Arthouse films
  { id: "ls4156672710", name: "Indie Films" }, // A24 Movies (2026+)
  { id: "ls000942888", name: "Indie Films" }, // Indie Top 50
  { id: "ls000551942", name: "Indie Films" }, // 50 Greatest Independent Films
  { id: "ls549966710", name: "Action" },
  { id: "ls063897780", name: "Action" },
  { id: "ls4103540912", name: "Romance" },
  { id: "ls072723203", name: "Romance" },
  { id: "ls000485502", name: "Romance" },
  { id: "ls020144005", name: "Fantasy" }, // Best Fantasy Movies
  { id: "ls076967068", name: "Action" }, // Action/Adventure/Fantasy - use across genres
  { id: "ls000551766", name: "Comedy" }, // Essential Comedies
  { id: "ls050296477", name: "Romance" }, // Best Romance
  { id: "ls055874673", name: "Sci-Fi" },
  { id: "ls091410558", name: "Sci-Fi" },
  { id: "ls056141474", name: "Sci-Fi" },
  { id: "ls027138048", name: "Sci-Fi" },
  { id: "ls092675159", name: "Sci-Fi" },
  { id: "ls538933235", name: "Sci-Fi" },
  { id: "ls000045692", name: "Western" }, // The Top 50 Best Western Movies
  { id: "ls021031406", name: "Thriller" }, // Best Thrillers of All Time
  { id: "ls055731784", name: "War" }, // Top 25 Greatest War Movies of All Time
  { id: "ls052424174", name: "War" },
  { id: "ls000032409", name: "Documentary" }, // Top 250 Documentaries
  { id: "ls068305490", name: "Documentary" },
  { id: "ls574334648", name: "Documentary" },
  { id: "ls024427769", name: "Documentary" },
  { id: "ls079181605", name: "Documentary" },
  { id: "ls592350792", name: "Documentary" },
  { id: "ls595254906", name: "New Releases" },
  { id: "ls596414359", name: "New Releases" },
  { id: "ls543298865", name: "New Releases" },
  { id: "ls072723334", name: "Family" }, // Best Rated Family Movies
];

const IMDB_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

/** Parse a single CSV line respecting quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(field); field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Primary method: fetch the list via IMDb's CSV export endpoint.
 * This is structured data and much harder to block than HTML scraping.
 * Returns title + year for every movie in the list.
 */
async function fetchIMDbListCSV(listId: string): Promise<IMDbListItem[]> {
  const url = `https://www.imdb.com/list/${listId}/export`;
  try {
    const response = await fetch(url, {
      headers: {
        ...IMDB_REQUEST_HEADERS,
        "Accept": "text/csv,text/plain,*/*",
        "Referer": `https://www.imdb.com/list/${listId}/`,
      },
    });

    if (!response.ok) {
      console.log(`IMDb CSV export ${listId}: HTTP ${response.status}`);
      return [];
    }

    const text = await response.text();
    if (text.length < 100 || !text.includes(",")) {
      console.log(`IMDb CSV export ${listId}: empty/invalid response`);
      return [];
    }

    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length < 2) return [];

    // Discover column indices from header row
    const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const titleIdx = header.findIndex(h => h === "title");
    const yearIdx  = header.findIndex(h => h === "year");

    if (titleIdx === -1) {
      console.log(`IMDb CSV export ${listId}: no Title column found`);
      return [];
    }

    const items: IMDbListItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      const title = fields[titleIdx]?.trim();
      const yearRaw = yearIdx >= 0 ? parseInt(fields[yearIdx], 10) : NaN;
      if (title && title.length > 0) {
        items.push({ title, year: isNaN(yearRaw) ? undefined : yearRaw });
      }
    }

    if (items.length > 0) {
      console.log(`Fetched ${items.length} movies via CSV export for list ${listId}`);
    }
    return items;
  } catch (error) {
    console.error(`CSV export error for ${listId}:`, error);
    return [];
  }
}

/** Recursively find an array of movie items anywhere in the __NEXT_DATA__ JSON */
function findMovieItemsDeep(obj: any, depth = 0): any[] {
  if (depth > 20 || !obj || typeof obj !== "object") return [];

  // If it's an array, check if it looks like a list of movie items
  if (Array.isArray(obj) && obj.length > 0) {
    const sample = obj[0];
    if (
      sample?.titleText?.text ||
      sample?.item?.titleText?.text ||
      sample?.listItem?.titleText?.text ||
      sample?.node?.titleText?.text ||
      sample?.node?.item?.titleText?.text ||
      sample?.node?.listItem?.titleText?.text ||
      sample?.originalTitleText?.text
    ) {
      return obj;
    }
  }

  // Search high-priority keys first
  const priority = ["items", "edges", "results", "titleListItemSearch", "predefinedList", "listMainColumnData", "contentData", "pageData", "serverData", "mainColumnData"];
  for (const key of priority) {
    if (key in obj) {
      const found = findMovieItemsDeep(obj[key], depth + 1);
      if (found.length > 0) return found;
    }
  }

  // Then search everything else
  for (const [key, val] of Object.entries(obj)) {
    if (!priority.includes(key) && typeof val === "object") {
      const found = findMovieItemsDeep(val, depth + 1);
      if (found.length > 0) return found;
    }
  }

  return [];
}

/** Extract title + year from one movie item regardless of field naming */
function extractTitleYear(item: any): { title: string; year: number | undefined } | null {
  const titleText =
    item?.titleText?.text ||
    item?.item?.titleText?.text ||
    item?.listItem?.titleText?.text ||
    item?.node?.titleText?.text ||
    item?.node?.item?.titleText?.text ||
    item?.node?.listItem?.titleText?.text ||
    item?.originalTitleText?.text ||
    item?.item?.originalTitleText?.text ||
    item?.node?.item?.originalTitleText?.text ||
    item?.primaryTitle ||
    item?.title;

  const year =
    item?.releaseYear?.year ||
    item?.item?.releaseYear?.year ||
    item?.listItem?.releaseYear?.year ||
    item?.node?.releaseYear?.year ||
    item?.node?.item?.releaseYear?.year ||
    item?.node?.listItem?.releaseYear?.year ||
    item?.startYear ||
    item?.year;

  if (!titleText || typeof titleText !== "string") return null;
  return { title: decodeHtmlEntities(titleText), year: typeof year === "number" ? year : undefined };
}

async function fetchIMDbList(listId: string): Promise<IMDbListItem[]> {
  // ── Try CSV export first (structured data, not scraping) ──────────────
  const csvItems = await fetchIMDbListCSV(listId);
  if (csvItems.length > 0) return csvItems;

  // ── Fall back to HTML scraping ─────────────────────────────────────────
  const url = `https://www.imdb.com/list/${listId}/`;
  try {
    const response = await fetch(url, {
      headers: {
        ...IMDB_REQUEST_HEADERS,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

    if (html.length < 3000) {
      console.warn(`IMDb list ${listId}: response too short (${html.length} chars) — likely blocked`);
      return [];
    }

    const items: IMDbListItem[] = [];

    // ── Method 1: __NEXT_DATA__ with deep search ───────────────────────────
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const listItems = findMovieItemsDeep(nextData);

        for (const item of listItems) {
          const extracted = extractTitleYear(item);
          if (extracted) items.push(extracted);
        }

        if (items.length > 0) {
          console.log(`Parsed ${items.length} movies via __NEXT_DATA__ deep search for list ${listId}`);
        }
      } catch (e) {
        console.log(`Failed to parse __NEXT_DATA__ for ${listId}`);
      }
    }

    // ── Method 2: JSON-LD structured data ─────────────────────────────────
    if (items.length === 0) {
      const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      for (const m of jsonLdMatches) {
        try {
          const jsonData = JSON.parse(m[1]);
          if (jsonData.itemListElement && Array.isArray(jsonData.itemListElement)) {
            for (const entry of jsonData.itemListElement) {
              const name = entry?.item?.name || entry?.name;
              if (name) {
                const yearMatch = String(name).match(/\((\d{4})\)/);
                items.push({
                  title: decodeHtmlEntities(String(name).replace(/\s*\(\d{4}\)\s*$/, "").trim()),
                  year: yearMatch ? parseInt(yearMatch[1]) : undefined,
                });
              }
            }
          }
          if (items.length > 0) break;
        } catch {}
      }
      if (items.length > 0) console.log(`Parsed ${items.length} movies via JSON-LD for list ${listId}`);
    }

    // ── Method 3: Multiple inline JSON patterns ────────────────────────────
    if (items.length === 0) {
      const jsonPatterns: RegExp[] = [
        // Standard IMDb __NEXT_DATA__ field names
        /"titleText"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"[^}]*\}[^}]*"releaseYear"\s*:\s*\{\s*"year"\s*:\s*(\d{4})/g,
        // Alternate: originalTitleText
        /"originalTitleText"\s*:\s*\{\s*"text"\s*:\s*"([^"]+)"[^}]*\}[^}]*"releaseYear"\s*:\s*\{\s*"year"\s*:\s*(\d{4})/g,
        // IMDb API v2: primaryTitle + startYear
        /"primaryTitle"\s*:\s*"([^"]+)"[^}]*"startYear"\s*:\s*(\d{4})/g,
        // Simple title + year objects
        /"title"\s*:\s*"([A-Z][^"]{1,100})"\s*,\s*"year"\s*:\s*(\d{4})/g,
      ];

      for (const pattern of jsonPatterns) {
        pattern.lastIndex = 0;
        let match;
        const patternItems: IMDbListItem[] = [];
        while ((match = pattern.exec(html)) !== null) {
          const title = decodeHtmlEntities(match[1]);
          if (title && title.length > 1 && !title.startsWith("/") && !title.includes("http")) {
            patternItems.push({ title, year: parseInt(match[2]) });
          }
        }
        if (patternItems.length > 5) {
          items.push(...patternItems);
          console.log(`Parsed ${patternItems.length} movies via inline JSON pattern for list ${listId}`);
          break;
        }
      }
    }

    // ── Method 4: HTML aria-label fallback ────────────────────────────────
    if (items.length === 0) {
      const ariaRegex = /aria-label="([^"]+)"\s[^>]*>\s*(?:[^<]*<[^>]+>)*[^<]*\((\d{4})\)/g;
      let match;
      while ((match = ariaRegex.exec(html)) !== null) {
        const title = decodeHtmlEntities(match[1].trim());
        if (title && title.length > 1) {
          items.push({ title, year: parseInt(match[2]) });
        }
      }
    }

    // ── Method 5: ipc-title-link h3 fallback ──────────────────────────────
    if (items.length === 0) {
      const h3Regex = /<a[^>]*href="\/title\/tt\d+\/?"[^>]*class="[^"]*ipc-title-link-wrapper[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g;
      let match;
      while ((match = h3Regex.exec(html)) !== null) {
        const title = decodeHtmlEntities(match[1].replace(/^\d+[.)]\s*/, "").trim());
        if (title && title.length > 1) items.push({ title, year: undefined });
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
    
    // Append to existing list if name already exists
    const existing = results.get(list.name) || [];
    results.set(list.name, [...existing, ...items]);
    
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
