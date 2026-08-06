import { cosineSimilarity } from "./math";
import { clampDepth, normalizeTag, topicFolderLabel, extractTopicTerms, isJunkTopicFolder } from "./text";
import type { ThemeCatalog } from "./themes";
import type { FolderSuggestion, TagSuggestion } from "./types";

export interface FolderCentroid {
  folder: string;
  vector: number[];
  count: number;
}

export interface TagPrototype {
  tag: string;
  vector: number[];
}

function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function folderLeaf(folder: string): string {
  return normKey(folder.split("/").pop() ?? folder);
}

function meaningfulTokens(s: string): string[] {
  return normKey(s)
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export function composeTopicFolder(
  topicLabel: string,
  prefix: string,
  maxDepth: number
): string {
  const label = topicFolderLabel(topicLabel.split(/\s+/).map((w) => w.toLowerCase()), 2);
  const path = prefix.trim()
    ? `${prefix.replace(/\/$/, "")}/${label}`
    : label;
  return clampDepth(path, maxDepth);
}

/** Collapse centroids whose leaves canonicalize to the same theme. */
export function collapseSameThemeCentroids(
  centroids: FolderCentroid[],
  catalog: ThemeCatalog
): FolderCentroid[] {
  const groups = new Map<string, FolderCentroid[]>();
  for (const c of centroids) {
    if (isJunkTopicFolder(c.folder)) continue;
    const remapped = catalog.remapFolderLeaf(c.folder);
    const key = remapped.toLowerCase();
    const list = groups.get(key) ?? [];
    list.push({ ...c, folder: remapped });
    groups.set(key, list);
  }
  const out: FolderCentroid[] = [];
  for (const [, list] of groups) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const total = list.reduce((s, c) => s + c.count, 0);
    const dim = list[0].vector.length;
    const vector = new Array(dim).fill(0);
    for (const c of list) {
      const w = c.count / total;
      for (let i = 0; i < dim; i++) vector[i] += c.vector[i] * w;
    }
    out.push({ folder: list[0].folder, vector, count: total });
  }
  return out;
}

export function findSimilarFolder(
  proposed: string,
  centroids: FolderCentroid[],
  catalog?: ThemeCatalog
): FolderCentroid | undefined {
  const wantRaw = folderLeaf(proposed);
  const want = catalog?.canonicalizeTheme(wantRaw) ?? wantRaw;
  const wantKey = normKey(typeof want === "string" ? want : wantRaw);
  const wantTokens = new Set(meaningfulTokens(wantKey));
  if (!wantKey || wantKey.length < 3) return undefined;

  let best: { c: FolderCentroid; score: number } | undefined;
  for (const c of centroids) {
    if (isJunkTopicFolder(c.folder)) continue;
    const remapped = catalog?.remapFolderLeaf(c.folder) ?? c.folder;
    const leaf = folderLeaf(remapped);
    if (!leaf || leaf.length < 3) continue;

    let score = 0;
    if (leaf === wantKey) {
      score = 1000 + c.count;
    } else if (
      (leaf.includes(wantKey) || wantKey.includes(leaf)) &&
      Math.min(leaf.length, wantKey.length) >= 4
    ) {
      score = 800 + c.count - leaf.length;
    } else {
      const ft = meaningfulTokens(leaf);
      const inter = ft.filter((t) => wantTokens.has(t)).length;
      const union = new Set([...ft, ...wantTokens]).size;
      if (inter >= 1 && union > 0 && inter / union >= 0.5) {
        score = 400 + inter * 40 + c.count;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { c: { ...c, folder: remapped }, score };
    }
  }
  return best?.c;
}

export function findFolderForTags(
  tagHints: string[],
  centroids: FolderCentroid[],
  catalog?: ThemeCatalog
): { folder: string; reason: string } | undefined {
  if (catalog) {
    const theme = catalog.themeFolderForHints(tagHints);
    if (theme) {
      const existing = centroids.find(
        (c) =>
          !isJunkTopicFolder(c.folder) &&
          folderLeaf(catalog.remapFolderLeaf(c.folder)) === normKey(theme)
      );
      return {
        folder: existing ? catalog.remapFolderLeaf(existing.folder) : theme,
        reason: `Theme catalog → ${theme}`,
      };
    }
  }

  let best: { folder: string; reason: string; score: number } | undefined;
  for (const raw of tagHints) {
    const hint = normKey(raw.replace(/^#/, ""));
    if (!hint || hint.length < 3) continue;

    const exact = centroids.find(
      (c) => !isJunkTopicFolder(c.folder) && folderLeaf(c.folder) === hint
    );
    if (exact) {
      const score = 2000 + exact.count;
      if (!best || score > best.score) {
        best = {
          folder: exact.folder,
          reason: `Shared tag #${hint.replace(/\s+/g, "-")} → folder`,
          score,
        };
      }
      continue;
    }

    const sim = findSimilarFolder(hint, centroids, catalog);
    if (sim) {
      const score = 1000 + sim.count;
      if (!best || score > best.score) {
        best = {
          folder: sim.folder,
          reason: `Tag #${hint.replace(/\s+/g, "-")} blends into ${sim.folder}`,
          score,
        };
      }
    }
  }
  return best ? { folder: best.folder, reason: best.reason } : undefined;
}

export function pickFolderRelevantTags(
  candidates: string[],
  centroids: FolderCentroid[],
  tagPrototypes: TagPrototype[],
  maxHints = 3,
  catalog?: ThemeCatalog
): string[] {
  const leaves = new Set(
    centroids
      .filter((c) => !isJunkTopicFolder(c.folder))
      .map((c) => folderLeaf(catalog?.remapFolderLeaf(c.folder) ?? c.folder))
  );
  const vault = new Set(
    tagPrototypes.map((t) => normKey(t.tag.replace(/^#/, "")))
  );

  const scored = candidates.map((raw) => {
    const h = normKey(raw.replace(/^#/, ""));
    if (!h || h.length < 3) return { h, score: -1 };
    let score = 0;
    const theme = catalog?.canonicalizeTheme(h);
    if (theme) score += 25;
    if (leaves.has(h) || (theme && leaves.has(normKey(theme)))) score += 20;
    else if ([...leaves].some((l) => l.includes(h) || h.includes(l))) score += 12;
    if (vault.has(h)) score += 8;
    if (meaningfulTokens(h).length === 1) score += 3;
    score += Math.min(4, h.length / 4);
    return { h, score };
  });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const { h, score } of scored.sort((a, b) => b.score - a.score)) {
    if (score < 0 || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    if (out.length >= maxHints) break;
  }
  return out;
}

export function pickPrimaryTag(
  tagHints: string[],
  centroids: FolderCentroid[],
  catalog?: ThemeCatalog
): string {
  if (catalog) {
    const theme = catalog.themeFolderForHints(tagHints);
    if (theme) return theme;
  }
  const leaves = new Set(
    centroids.filter((c) => !isJunkTopicFolder(c.folder)).map((c) => folderLeaf(c.folder))
  );
  for (const raw of tagHints) {
    const h = normKey(raw.replace(/^#/, ""));
    if (h && leaves.has(h)) return h;
  }
  for (const raw of tagHints) {
    const h = normKey(raw.replace(/^#/, ""));
    if (h.length >= 4 && meaningfulTokens(h).length === 1) return h;
  }
  return normKey(tagHints[0]?.replace(/^#/, "") ?? "notes") || "notes";
}

export function rankFolders(
  noteVec: number[],
  centroids: FolderCentroid[],
  opts: {
    allowNew: boolean;
    maxDepth: number;
    topK?: number;
    noteText?: string;
    noteFilename?: string;
    newFolderThreshold?: number;
    topicFolderPrefix?: string;
    tagHints?: string[];
    themeCatalog?: ThemeCatalog;
    forcedTheme?: string;
    useThemeCatalog?: boolean;
  }
): FolderSuggestion[] {
  const topK = opts.topK ?? 3;
  const threshold = opts.newFolderThreshold ?? 0.28;
  const catalog =
    opts.useThemeCatalog === false ? undefined : opts.themeCatalog;
  const tagHints = (opts.tagHints ?? [])
    .map((t) => normKey(t.replace(/^#/, "")))
    .filter((t) => t.length >= 3);

  const prefix = opts.topicFolderPrefix ?? "";
  const withPrefix = (name: string) =>
    composeTopicFolder(name, prefix, opts.maxDepth);

  const catalogTheme =
    opts.forcedTheme ||
    (catalog ? catalog.themeFolderForHints(tagHints) : null);
  if (catalogTheme) {
    const folder = withPrefix(catalogTheme);
    const exists = centroids.some(
      (c) =>
        folderLeaf(catalog?.remapFolderLeaf(c.folder) ?? c.folder) ===
        normKey(catalogTheme)
    );
    return [
      {
        folder,
        score: 0.95,
        isNewFolder: !exists,
        reason: opts.forcedTheme
          ? `Theme: ${catalogTheme}`
          : `Theme catalog → ${catalogTheme}`,
      },
    ];
  }

  const remappedCentroids = catalog
    ? collapseSameThemeCentroids(centroids, catalog)
    : centroids.filter((c) => !isJunkTopicFolder(c.folder));

  const themeOf = (folder: string): string =>
    catalog ? folderLeaf(catalog.remapFolderLeaf(folder)) : folderLeaf(folder);

  const tagBoost = (folder: string): { boost: number; reason?: string } => {
    const leaf = themeOf(folder);
    const parts = leaf.split(/\s+/).filter((p) => p.length >= 3);
    for (const hint of tagHints) {
      const hintTheme = catalog?.canonicalizeTheme(hint) ?? hint;
      const hintKey = normKey(hintTheme);
      if (leaf === hintKey) {
        return {
          boost: 0.55,
          reason: `Matches theme/tag #${hint.replace(/\s+/g, "-")}`,
        };
      }
      if (parts.some((p) => p === hintKey)) {
        return {
          boost: 0.35,
          reason: `Aligned with #${hint.replace(/\s+/g, "-")}`,
        };
      }
      if (
        Math.min(leaf.length, hintKey.length) >= 4 &&
        (leaf.includes(hintKey) || hintKey.includes(leaf))
      ) {
        return {
          boost: 0.28,
          reason: `Related to #${hint.replace(/\s+/g, "-")}`,
        };
      }
    }
    return { boost: 0 };
  };

  const popularityBoost = (count: number): number =>
    Math.min(0.1, Math.log10(count + 1) * 0.04);

  const ranked = remappedCentroids
    .map((c) => {
      const base = cosineSimilarity(noteVec, c.vector);
      const { boost, reason } = tagBoost(c.folder);
      return {
        folder: c.folder,
        score: Math.min(1, base + boost + popularityBoost(c.count)),
        isNewFolder: false,
        reason:
          boost > 0
            ? `${reason} · similar to ${c.count} note(s) in folder`
            : `Similar to ${c.count} note(s) already in this folder`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topK, 5));

  const tagHome = findFolderForTags(tagHints, remappedCentroids, catalog);
  if (tagHome) {
    const homeFolder = withPrefix(tagHome.folder.split("/").pop() ?? tagHome.folder);
    if (!ranked.some((r) => r.folder === homeFolder || r.folder === tagHome.folder)) {
      ranked.unshift({
        folder: homeFolder,
        score: 0.93,
        isNewFolder: false,
        reason: tagHome.reason,
      });
    } else {
      const hit = ranked.find(
        (r) => r.folder === homeFolder || r.folder === tagHome.folder
      )!;
      hit.folder = homeFolder;
      hit.score = Math.max(hit.score, 0.93);
      hit.reason = tagHome.reason;
      ranked.sort((a, b) => b.score - a.score);
    }
    if (catalog) return ranked.slice(0, topK);
  }

  const trimmed = ranked.slice(0, topK);
  const best = trimmed[0]?.score ?? 0;
  const bestOverlap = trimmed[0] ? tagBoost(trimmed[0].folder).boost > 0 : false;

  if (catalog) {
    if (trimmed.length > 0 && (bestOverlap || best >= threshold)) {
      return trimmed;
    }
    if (opts.allowNew) {
      const misc = withPrefix("Misc");
      return [
        {
          folder: misc,
          score: 0.4,
          isNewFolder: !centroids.some((c) => folderLeaf(c.folder) === "misc"),
          reason: "No theme match; filed under Misc",
        },
        ...trimmed,
      ].slice(0, topK);
    }
    return trimmed;
  }

  if (opts.allowNew && tagHints.length > 0 && !bestOverlap && !tagHome) {
    const primary = pickPrimaryTag(tagHints, remappedCentroids, catalog);
    const similar = findSimilarFolder(primary, remappedCentroids, catalog);
    if (similar) {
      return [
        {
          folder: similar.folder,
          score: 0.9,
          isNewFolder: false,
          reason: `Blended #${primary.replace(/\s+/g, "-")} into existing ${similar.folder}`,
        },
        ...trimmed.filter((t) => t.folder !== similar.folder),
      ].slice(0, topK);
    }
    const folder = withPrefix(primary);
    if (!isJunkTopicFolder(folder)) {
      const canon = findSimilarFolder(folder, remappedCentroids, catalog);
      const finalFolder = canon?.folder ?? folder;
      return [
        {
          folder: finalFolder,
          score: 0.86,
          isNewFolder: !canon && !centroids.some((c) => c.folder === finalFolder),
          reason: `Consolidated under primary tag #${primary.replace(/\s+/g, "-")}`,
        },
        ...trimmed,
      ].slice(0, topK);
    }
  }

  const shouldProposeNew =
    opts.allowNew && (trimmed.length === 0 || best < threshold);

  if (shouldProposeNew) {
    const terms = extractTopicTerms(
      `${opts.noteFilename ?? ""}\n${opts.noteText ?? ""}`,
      6
    );
    const label = terms.slice(0, 2).join(" ") || "Notes";
    let folder = withPrefix(label);
    if (isJunkTopicFolder(folder)) folder = withPrefix("Notes");
    const similar =
      findSimilarFolder(folder, remappedCentroids, catalog) ??
      findSimilarFolder(terms[0] ?? "", remappedCentroids, catalog);
    if (similar) {
      return [
        {
          folder: similar.folder,
          score: Math.max(0.55, best + 0.05),
          isNewFolder: false,
          reason: `Consolidated weak match into existing ${similar.folder}`,
        },
        ...trimmed.filter((t) => t.folder !== similar.folder),
      ].slice(0, topK);
    }
    return [
      {
        folder,
        score: trimmed.length === 0 ? 0.55 : Math.max(0.45, 1 - best),
        isNewFolder: true,
        reason:
          trimmed.length === 0
            ? "Generated topic folder (no existing taxonomy match)"
            : `Weak match to existing folders (best ${(best * 100).toFixed(0)}%); proposed new topic folder`,
      },
      ...trimmed,
    ].slice(0, topK);
  }

  if (trimmed.length === 0 && opts.allowNew) {
    return [
      {
        folder: withPrefix("Misc"),
        score: 0.2,
        isNewFolder: true,
        reason: "No existing folder taxonomy; proposed bootstrap folder",
      },
    ];
  }
  return trimmed;
}

export function rankTags(
  noteVec: number[],
  tags: TagPrototype[],
  maxTags: number
): TagSuggestion[] {
  return tags
    .map((t) => ({
      tag: normalizeTag(t.tag),
      score: cosineSimilarity(noteVec, t.vector),
      isNew: false,
      reason: "Matches existing vault tag vocabulary",
    }))
    .filter((t) => t.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTags);
}

export function proposeTags(
  noteVec: number[],
  tagPrototypes: TagPrototype[],
  opts: {
    maxTags: number;
    noteText: string;
    noteFilename: string;
    folderHint?: string;
  }
): TagSuggestion[] {
  const out: TagSuggestion[] = [];
  const seen = new Set<string>();
  const push = (tag: string, score: number, isNew: boolean, reason: string) => {
    const n = normalizeTag(tag);
    const key = n.toLowerCase();
    if (!n || n === "#" || seen.has(key)) return;
    const bare = key.replace(/^#/, "");
    if (isJunkTopicFolder(bare)) return;
    if (bare.length < 3) return;
    seen.add(key);
    out.push({ tag: n, score, isNew, reason });
  };

  const topicBudget = opts.folderHint ? Math.max(1, opts.maxTags - 1) : opts.maxTags;
  for (const term of extractTopicTerms(
    `${opts.noteFilename}\n${opts.noteText}`,
    topicBudget + 4
  )) {
    if (out.length >= topicBudget) break;
    push(term, 0.7, true, "Derived from note topics");
  }

  if (opts.folderHint) {
    const leaf = opts.folderHint.split("/").filter(Boolean).pop();
    if (leaf && !isJunkTopicFolder(leaf)) {
      push(leaf.replace(/\s+/g, "-"), 0.6, true, "From destination folder");
    }
  }

  for (const t of rankTags(noteVec, tagPrototypes, opts.maxTags)) {
    push(t.tag, t.score, false, t.reason);
  }

  return out.slice(0, opts.maxTags);
}

export function prioritizeFolders(folders: string[], limit = 100): string[] {
  const scored = folders.map((f) => ({
    f,
    depth: f.split("/").filter(Boolean).length,
  }));
  scored.sort((a, b) => a.depth - b.depth || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((x) => x.f);
}
