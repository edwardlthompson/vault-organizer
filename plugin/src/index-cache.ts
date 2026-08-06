import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export const INDEX_CACHE_VERSION = 1;

export interface IndexCacheEntry {
  /** Fingerprint of the exact text that was embedded. */
  fp: string;
  vector: number[];
}

export interface IndexCacheFile {
  version: number;
  modelPackId: string;
  updatedAt: number;
  entries: Record<string, IndexCacheEntry>;
}

export function fingerprintText(text: string): string {
  return crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 20);
}

export function emptyIndexCache(modelPackId: string): IndexCacheFile {
  return {
    version: INDEX_CACHE_VERSION,
    modelPackId,
    updatedAt: Date.now(),
    entries: {},
  };
}

export function loadIndexCache(
  filePath: string,
  modelPackId: string
): IndexCacheFile {
  try {
    if (!fs.existsSync(filePath)) return emptyIndexCache(modelPackId);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as IndexCacheFile;
    if (
      !raw ||
      raw.version !== INDEX_CACHE_VERSION ||
      raw.modelPackId !== modelPackId ||
      typeof raw.entries !== "object"
    ) {
      return emptyIndexCache(modelPackId);
    }
    return raw;
  } catch {
    return emptyIndexCache(modelPackId);
  }
}

export function saveIndexCache(filePath: string, cache: IndexCacheFile): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cache.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(cache));
  } catch {
    /* ignore disk errors — cache is an optimization */
  }
}

/** Move a cached vector when a note is renamed/moved. */
export function migrateCachePath(
  cache: IndexCacheFile,
  from: string,
  to: string
): void {
  if (from === to) return;
  const entry = cache.entries[from];
  if (!entry) return;
  delete cache.entries[from];
  cache.entries[to] = entry;
}

export function cacheToSeedMap(
  cache: IndexCacheFile
): Map<string, IndexCacheEntry> {
  return new Map(Object.entries(cache.entries));
}

export function writeSeedMapToCache(
  cache: IndexCacheFile,
  seed: Map<string, IndexCacheEntry>,
  keepPaths: Set<string>
): void {
  const next: Record<string, IndexCacheEntry> = {};
  for (const [p, entry] of seed) {
    if (keepPaths.has(p)) next[p] = entry;
  }
  cache.entries = next;
}
