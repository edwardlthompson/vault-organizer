import { fingerprintText } from "./index-cache";
import {
  ThemeCatalog,
  matchExistingTheme,
  type ThemeMap,
} from "./themes";

export interface ThemeNameRequest {
  hints: string[];
  linkTitles?: string[];
  existingThemes: string[];
  catalog: ThemeCatalog;
}

export interface ThemeNameResult {
  theme: string;
  isNew: boolean;
  source: "catalog" | "wikipedia" | "wikidata" | "link-title" | "misc";
  synonyms: string[];
}

export type ThemeNameCache = Record<
  string,
  { theme: string; isNew: boolean; source: string; ts: number }
>;

export type WikiRequester = (url: string) => Promise<{
  status: number;
  json?: unknown;
  text?: string;
}>;

const WIKI_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function pickQuery(hints: string[], linkTitles: string[]): string | null {
  const candidates = [...hints, ...linkTitles]
    .map((h) => h.replace(/^#/, "").trim())
    .filter((h) => h.length >= 3);
  if (candidates.length === 0) return null;
  // Prefer shorter topical phrases over long sentences.
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates[0].slice(0, 80);
}

function cacheKey(req: ThemeNameRequest): string {
  return fingerprintText(
    [...req.hints, ...(req.linkTitles ?? []), ...req.existingThemes.slice(0, 20)].join("|")
  );
}

/** Resolve theme from catalog + optional keyless web lookups. */
export async function nameTheme(
  req: ThemeNameRequest,
  opts: {
    online: boolean;
    request?: WikiRequester;
    cache?: ThemeNameCache;
    onLearn?: (synonym: string, theme: string) => void;
  }
): Promise<ThemeNameResult> {
  const allHints = [
    ...req.hints,
    ...(req.linkTitles ?? []).flatMap((t) => t.split(/[\s|/,:;—-]+/)),
  ];

  // 1) Catalog hit
  const catalogHit = req.catalog.themeFolderForHints(allHints);
  if (catalogHit) {
    return {
      theme: catalogHit,
      isNew: false,
      source: "catalog",
      synonyms: req.hints.map((h) => h.replace(/^#/, "")).filter(Boolean),
    };
  }

  // Link titles alone may canonicalize
  for (const title of req.linkTitles ?? []) {
    const hit =
      req.catalog.canonicalizeTheme(title) ||
      matchExistingTheme(title, req.existingThemes, req.catalog);
    if (hit) {
      return {
        theme: hit,
        isNew: false,
        source: "link-title",
        synonyms: [title],
      };
    }
  }

  const key = cacheKey(req);
  const cached = opts.cache?.[key];
  if (cached && Date.now() - cached.ts < WIKI_TTL_MS) {
    return {
      theme: cached.theme,
      isNew: cached.isNew,
      source: (cached.source as ThemeNameResult["source"]) || "wikipedia",
      synonyms: req.hints,
    };
  }

  if (!opts.online || !opts.request) {
    return { theme: "Misc", isNew: false, source: "misc", synonyms: [] };
  }

  const query = pickQuery(req.hints, req.linkTitles ?? []);
  if (!query) {
    return { theme: "Misc", isNew: false, source: "misc", synonyms: [] };
  }

  try {
    const wiki = await lookupWikipedia(query, opts.request);
    if (wiki) {
      const blob = `${wiki.title} ${wiki.description} ${wiki.categories.join(" ")}`;
      const existing = matchExistingTheme(
        blob,
        req.existingThemes,
        req.catalog
      );
      if (existing) {
        learnSynonyms(req, existing, opts.onLearn);
        writeCache(opts.cache, key, existing, false, "wikipedia");
        return {
          theme: existing,
          isNew: false,
          source: "wikipedia",
          synonyms: [query, wiki.title],
        };
      }
      // Prefer matching wiki categories against catalog synonyms
      for (const cat of wiki.categories) {
        const cHit = req.catalog.canonicalizeTheme(cat);
        if (cHit) {
          learnSynonyms(req, cHit, opts.onLearn);
          writeCache(opts.cache, key, cHit, false, "wikipedia");
          return {
            theme: cHit,
            isNew: false,
            source: "wikipedia",
            synonyms: [query, cat],
          };
        }
      }
      const label = ThemeCatalog.shortFolderLabel(wiki.title);
      if (label && label.toLowerCase() !== "notes") {
        const remapped = matchExistingTheme(
          label,
          req.existingThemes,
          req.catalog
        );
        // Prefer filing under Misc over inventing one-off Wikipedia folders.
        if (!remapped) {
          learnSynonyms(req, "Misc", opts.onLearn);
          writeCache(opts.cache, key, "Misc", false, "misc");
          return {
            theme: "Misc",
            isNew: false,
            source: "misc",
            synonyms: [query, wiki.title],
          };
        }
        learnSynonyms(req, remapped, opts.onLearn);
        writeCache(opts.cache, key, remapped, false, "wikipedia");
        return {
          theme: remapped,
          isNew: false,
          source: "wikipedia",
          synonyms: [query, wiki.title],
        };
      }
    }

    const wd = await lookupWikidata(query, opts.request);
    if (wd) {
      const existing = matchExistingTheme(
        wd,
        req.existingThemes,
        req.catalog
      );
      const theme = existing || "Misc";
      learnSynonyms(req, theme, opts.onLearn);
      writeCache(opts.cache, key, theme, false, existing ? "wikidata" : "misc");
      return {
        theme,
        isNew: false,
        source: existing ? "wikidata" : "misc",
        synonyms: [query, wd],
      };
    }
  } catch {
    /* network failure → Misc */
  }

  return { theme: "Misc", isNew: false, source: "misc", synonyms: [] };
}

function learnSynonyms(
  req: ThemeNameRequest,
  theme: string,
  onLearn?: (synonym: string, theme: string) => void
): void {
  if (!onLearn) return;
  for (const h of req.hints) {
    const s = h.replace(/^#/, "").trim();
    if (s) onLearn(s, theme);
  }
}

function writeCache(
  cache: ThemeNameCache | undefined,
  key: string,
  theme: string,
  isNew: boolean,
  source: string
): void {
  if (!cache) return;
  cache[key] = { theme, isNew, source, ts: Date.now() };
}

interface WikiSummary {
  title: string;
  description: string;
  categories: string[];
}

async function lookupWikipedia(
  query: string,
  request: WikiRequester
): Promise<WikiSummary | null> {
  const searchUrl =
    "https://en.wikipedia.org/w/rest.php/v1/search/title?q=" +
    encodeURIComponent(query) +
    "&limit=3";
  const search = await request(searchUrl);
  if (search.status < 200 || search.status >= 300) return null;
  const pages =
    (search.json as { pages?: { title?: string; key?: string }[] })?.pages ??
    [];
  const title = pages[0]?.title || pages[0]?.key;
  if (!title) return null;

  const summaryUrl =
    "https://en.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(title.replace(/ /g, "_"));
  const summary = await request(summaryUrl);
  if (summary.status < 200 || summary.status >= 300) {
    return { title, description: "", categories: [] };
  }
  const body = summary.json as {
    title?: string;
    description?: string;
    extract?: string;
  };
  const categories = await fetchWikiCategories(title, request);
  return {
    title: body.title || title,
    description: [body.description, body.extract].filter(Boolean).join(" "),
    categories,
  };
}

async function fetchWikiCategories(
  title: string,
  request: WikiRequester
): Promise<string[]> {
  try {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&prop=categories&cllimit=10&clshow=!hidden&format=json&origin=*&titles=" +
      encodeURIComponent(title);
    const res = await request(url);
    if (res.status < 200 || res.status >= 300) return [];
    const data = res.json as {
      query?: { pages?: Record<string, { categories?: { title: string }[] }> };
    };
    const pages = data.query?.pages ?? {};
    const cats: string[] = [];
    for (const p of Object.values(pages)) {
      for (const c of p.categories ?? []) {
        cats.push(c.title.replace(/^Category:/i, ""));
      }
    }
    return cats;
  } catch {
    return [];
  }
}

async function lookupWikidata(
  query: string,
  request: WikiRequester
): Promise<string | null> {
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&search=" +
    encodeURIComponent(query) +
    "&language=en&limit=1&format=json&origin=*";
  const res = await request(url);
  if (res.status < 200 || res.status >= 300) return null;
  const data = res.json as {
    search?: { label?: string; description?: string }[];
  };
  const hit = data.search?.[0];
  if (!hit?.label) return null;
  return hit.label;
}

/** Merge learned synonyms into a themes file payload. */
export function mergeLearnedThemes(
  existing: ThemeMap,
  learned: ThemeMap
): ThemeMap {
  return { ...existing, ...learned };
}
