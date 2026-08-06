export interface LinkProbe {
  url: string;
  kind: "external" | "wiki";
  ok: boolean;
  status?: number;
  title?: string;
  error?: string;
}

export interface LinkCacheEntry {
  ts: number;
  ok: boolean;
  status?: number;
  title?: string;
  error?: string;
}

export type LinkCache = Record<string, LinkCacheEntry>;

const URL_RE =
  /https?:\/\/[^\s<>\]\)"']+/gi;
const MD_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
const WIKI_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;

/** Extract external http(s) URLs from markdown body. */
export function extractExternalUrls(content: string): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(MD_LINK_RE)) {
    found.add(cleanUrl(m[1]));
  }
  for (const m of content.matchAll(URL_RE)) {
    found.add(cleanUrl(m[0]));
  }
  return [...found].filter(Boolean);
}

/** Extract wiki link targets (note names) from markdown. */
export function extractWikiTargets(content: string): string[] {
  const found = new Set<string>();
  for (const m of content.matchAll(WIKI_RE)) {
    const target = m[1].trim();
    if (target) found.add(target);
  }
  return [...found];
}

export function cleanUrl(raw: string): string {
  return raw.replace(/[),.;:!?\]]+$/g, "").trim();
}

/**
 * Offline context from a URL path/host — no network.
 * e.g. https://site.com/bitcoin-cold-wallet → "bitcoin cold wallet site"
 */
export function contextFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").split(".")[0] ?? "";
    const pathBits = decodeURIComponent(u.pathname)
      .split(/[/_\-.]+/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length >= 3 && !/^\d+$/.test(p) && !isUrlNoise(p));
    const q = u.searchParams.get("q") || u.searchParams.get("query") || "";
    const queryBits = q
      .split(/[\s+/_\-.]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length >= 3 && !isUrlNoise(p));
    return [...new Set([host, ...pathBits, ...queryBits].filter(Boolean))].join(" ");
  } catch {
    return "";
  }
}

function isUrlNoise(token: string): boolean {
  return /^(https?|www|com|org|net|html|htm|php|asp|index|page|ref|utm|share|watch|v|id|amp)$/i.test(
    token
  );
}

/** Build enrichment text from all links without network I/O. */
export function offlineLinkContext(content: string, maxUrls = 8): string {
  const urls = extractExternalUrls(content).slice(0, maxUrls);
  return urls.map(contextFromUrl).filter(Boolean).join("\n");
}

export function parseHtmlTitle(html: string): string | undefined {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m?.[1]) return undefined;
  return m[1].replace(/\s+/g, " ").trim().slice(0, 160);
}

const DEFAULT_TTL_OK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TTL_DEAD_MS = 24 * 60 * 60 * 1000;

export function cacheFresh(
  entry: LinkCacheEntry | undefined,
  now = Date.now()
): boolean {
  if (!entry) return false;
  const ttl = entry.ok ? DEFAULT_TTL_OK_MS : DEFAULT_TTL_DEAD_MS;
  return now - entry.ts < ttl;
}

export type LinkRequester = (args: {
  url: string;
  method: "HEAD" | "GET";
  timeoutMs: number;
}) => Promise<{ status: number; text: string }>;

let defaultRequester: LinkRequester | null = null;

/** Wire Obsidian `requestUrl` (or a test mock) once at plugin load. */
export function setLinkRequester(requester: LinkRequester | null): void {
  defaultRequester = requester;
}

/** Probe an external URL (HEAD then GET fallback). */
export async function probeExternalUrl(
  url: string,
  opts: { timeoutMs?: number; request?: LinkRequester } = {}
): Promise<LinkProbe> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const request = opts.request ?? defaultRequester;
  if (!request) {
    return {
      url,
      kind: "external",
      ok: false,
      error: "link requester not configured",
    };
  }
  try {
    let status = 0;
    let title: string | undefined;
    try {
      const head = await request({ url, method: "HEAD", timeoutMs });
      status = head.status;
    } catch {
      /* some hosts reject HEAD */
    }
    const get = await request({ url, method: "GET", timeoutMs });
    status = get.status || status;
    const body = typeof get.text === "string" ? get.text.slice(0, 80_000) : "";
    title = parseHtmlTitle(body);
    const ok = status >= 200 && status < 400;
    return {
      url,
      kind: "external",
      ok,
      status,
      title,
      error: ok ? undefined : `HTTP ${status || "error"}`,
    };
  } catch (err) {
    return {
      url,
      kind: "external",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface EnrichLinksResult {
  contextText: string;
  deadLinks: LinkProbe[];
  liveLinks: LinkProbe[];
}

/**
 * Enrich note text with link path tokens + optional live titles; collect dead links.
 */
export async function enrichWithLinks(
  content: string,
  opts: {
    checkDead: boolean;
    fetchTitles: boolean;
    maxUrls?: number;
    timeoutMs?: number;
    cache?: LinkCache;
    resolveWiki?: (target: string) => boolean;
    onProbe?: (probe: LinkProbe) => void;
  }
): Promise<EnrichLinksResult> {
  const maxUrls = opts.maxUrls ?? 5;
  const parts: string[] = [offlineLinkContext(content, maxUrls)];
  const deadLinks: LinkProbe[] = [];
  const liveLinks: LinkProbe[] = [];
  const cache = opts.cache ?? {};

  if (opts.resolveWiki) {
    for (const target of extractWikiTargets(content).slice(0, maxUrls)) {
      const ok = opts.resolveWiki(target);
      const probe: LinkProbe = {
        url: `[[${target}]]`,
        kind: "wiki",
        ok,
        error: ok ? undefined : "missing note",
      };
      opts.onProbe?.(probe);
      if (ok) liveLinks.push(probe);
      else deadLinks.push(probe);
    }
  }

  if (!opts.checkDead && !opts.fetchTitles) {
    return { contextText: parts.filter(Boolean).join("\n"), deadLinks, liveLinks };
  }

  const urls = extractExternalUrls(content).slice(0, maxUrls);
  for (const url of urls) {
    const cached = cache[url];
    let probe: LinkProbe;
    if (cacheFresh(cached)) {
      probe = {
        url,
        kind: "external",
        ok: cached.ok,
        status: cached.status,
        title: cached.title,
        error: cached.error,
      };
    } else {
      probe = await probeExternalUrl(url, { timeoutMs: opts.timeoutMs });
      cache[url] = {
        ts: Date.now(),
        ok: probe.ok,
        status: probe.status,
        title: probe.title,
        error: probe.error,
      };
    }
    opts.onProbe?.(probe);
    if (probe.ok) {
      liveLinks.push(probe);
      if (opts.fetchTitles && probe.title) parts.push(probe.title);
    } else if (opts.checkDead) {
      deadLinks.push(probe);
    }
  }

  return {
    contextText: parts.filter(Boolean).join("\n"),
    deadLinks,
    liveLinks,
  };
}
