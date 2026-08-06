import type { EmbedFn } from "./embedder";
import { kMeans } from "./math";
import {
  extractTitleHint,
  headTail,
  clampDepth,
  stripFrontmatter,
  sharedTopicLabel,
  isJunkTopicFolder,
} from "./text";
import {
  composeTopicFolder,
  rankFolders,
  proposeTags,
  pickFolderRelevantTags,
  findSimilarFolder,
  collapseSameThemeCentroids,
  type FolderCentroid,
  type TagPrototype,
} from "./taxonomy";
import { readExistingTags } from "./apply";
import { offlineLinkContext } from "./links";
import { fingerprintText, type IndexCacheEntry } from "./index-cache";
import type { ThemeCatalog } from "./themes";
import type { OrganizeSuggestion, VaultOrganizerSettings } from "./types";
import { JobCancelledError, yieldToEventLoop } from "./job";

export interface VaultIndex {
  folderCentroids: FolderCentroid[];
  tagPrototypes: TagPrototype[];
  noteVectors: Map<string, number[]>;
  /** Fingerprints for the embedded text — used to persist/reuse vectors. */
  fingerprints: Map<string, string>;
}

export interface BuildIndexResult extends VaultIndex {
  embedded: number;
  reused: number;
}

export async function buildVaultIndex(
  embed: EmbedFn,
  notes: { path: string; folder: string; content: string; tags: string[] }[],
  settings: VaultOrganizerSettings,
  onProgress?: (done: number, total: number, detail: string) => void,
  shouldCancel?: () => boolean,
  seedVectors?: Map<string, IndexCacheEntry>,
  themeCatalog?: ThemeCatalog
): Promise<BuildIndexResult> {
  const noteVectors = new Map<string, number[]>();
  const fingerprints = new Map<string, string>();
  const batch: { path: string; text: string; folder: string; tags: string[]; fp: string }[] = [];

  for (const n of notes) {
    if (settings.excludedFolders.some((ex) => n.path === ex || n.path.startsWith(`${ex}/`))) {
      continue;
    }
    const body = stripFrontmatter(n.content);
    const linkCtx = settings.useLinkContext
      ? offlineLinkContext(n.content, settings.maxLinksPerNote)
      : "";
    const text = headTail(linkCtx ? `${body}\n${linkCtx}` : body);
    const fp = fingerprintText(text || n.path);
    batch.push({
      path: n.path,
      folder: n.folder,
      tags: n.tags,
      text,
      fp,
    });
  }

  const toEmbed: typeof batch = [];
  let reused = 0;
  for (const b of batch) {
    const hit = seedVectors?.get(b.path);
    if (hit && hit.fp === b.fp && Array.isArray(hit.vector) && hit.vector.length > 0) {
      noteVectors.set(b.path, hit.vector);
      fingerprints.set(b.path, b.fp);
      reused++;
    } else {
      toEmbed.push(b);
    }
  }

  const total = batch.length;
  onProgress?.(reused, total, reused ? `Reused ${reused} cached embeddings…` : "Embedding…");

  const chunk = 2;
  let embedded = 0;
  for (let i = 0; i < toEmbed.length; i += chunk) {
    if (shouldCancel?.()) throw new JobCancelledError();
    const slice = toEmbed.slice(i, i + chunk);
    const vecs = await embed(slice.map((b) => b.text || b.path));
    for (let j = 0; j < slice.length; j++) {
      noteVectors.set(slice[j].path, vecs[j]);
      fingerprints.set(slice[j].path, slice[j].fp);
    }
    embedded += slice.length;
    onProgress?.(
      reused + embedded,
      total,
      slice[slice.length - 1]?.path ?? ""
    );
    await yieldToEventLoop();
  }

  onProgress?.(total, total, "Building folder centroids…");

  const byFolder = new Map<string, number[][]>();
  for (const b of batch) {
    const v = noteVectors.get(b.path);
    if (!v || !b.folder) continue;
    if (isJunkTopicFolder(b.folder)) continue;
    const folderKey =
      settings.useThemeCatalog && themeCatalog
        ? themeCatalog.remapFolderLeaf(b.folder)
        : b.folder;
    if (isJunkTopicFolder(folderKey)) continue;
    const list = byFolder.get(folderKey) ?? [];
    list.push(v);
    byFolder.set(folderKey, list);
  }

  let folderCentroids: FolderCentroid[] = [];
  for (const [folder, vecs] of byFolder) {
    const sum = vecs[0].map((_, i) => vecs.reduce((acc, v) => acc + v[i], 0) / vecs.length);
    folderCentroids.push({ folder, vector: sum, count: vecs.length });
  }
  if (settings.useThemeCatalog && themeCatalog) {
    folderCentroids = collapseSameThemeCentroids(folderCentroids, themeCatalog);
  }

  const byTag = new Map<string, number[][]>();
  for (const b of batch) {
    const v = noteVectors.get(b.path);
    if (!v) continue;
    for (const tag of b.tags) {
      const n = tag.toLowerCase().replace(/^#/, "");
      if (!n || isJunkTopicFolder(n) || n.length < 3) continue;
      const list = byTag.get(tag) ?? [];
      list.push(v);
      byTag.set(tag, list);
    }
  }
  const tagPrototypes: TagPrototype[] = [];
  for (const [tag, vecs] of byTag) {
    const sum = vecs[0].map((_, i) => vecs.reduce((acc, v) => acc + v[i], 0) / vecs.length);
    tagPrototypes.push({ tag, vector: sum });
  }

  // Seed generative topic folders from uncategorized (root) notes, or when taxonomy is thin.
  const uncategorized = batch.filter((b) => !b.folder);
  const shouldClusterTopics =
    settings.allowNewFolders &&
    (folderCentroids.length < 2 || uncategorized.length >= 4) &&
    (uncategorized.length >= 4 || batch.length >= 6);

  if (shouldClusterTopics) {
    onProgress?.(total, total, "Generating topic folders…");
    const clusterBatch = uncategorized.length >= 4 ? uncategorized : batch;
    const points = clusterBatch.map((b) => noteVectors.get(b.path)!).filter(Boolean);
    const k = Math.min(6, Math.max(2, Math.floor(Math.sqrt(points.length / 3))));
    const { centroids, assignments } = kMeans(points, k);
    const usedNames = new Set(folderCentroids.map((c) => c.folder.toLowerCase()));

    centroids.forEach((vector, idx) => {
      const members = clusterBatch.filter((_, i) => assignments[i] === idx);
      if (members.length === 0) return;
      // Prefer a short shared label so clusters reuse the same names.
      const label = sharedTopicLabel(
        members.map((m) => m.text || m.path),
        2
      );
      let folder = composeTopicFolder(
        label,
        settings.topicFolderPrefix,
        settings.maxFolderDepth
      );
      if (isJunkTopicFolder(folder)) {
        folder = composeTopicFolder(
          "Notes",
          settings.topicFolderPrefix,
          settings.maxFolderDepth
        );
      }
      if (settings.useThemeCatalog && themeCatalog) {
        const theme =
          themeCatalog.canonicalizeTheme(label) ||
          themeCatalog.themeFolderForHints(label.split(/\s+/));
        if (theme) {
          folder = composeTopicFolder(
            theme,
            settings.topicFolderPrefix,
            settings.maxFolderDepth
          );
        } else {
          // Don't seed free-form clusters when using the theme catalog.
          return;
        }
      }
      const similar = findSimilarFolder(folder, folderCentroids, themeCatalog);
      if (similar) return;
      if (usedNames.has(folder.toLowerCase())) return;

      usedNames.add(folder.toLowerCase());
      folderCentroids.push({
        folder,
        vector,
        count: members.length,
      });
    });
  }

  if (settings.useThemeCatalog && themeCatalog) {
    folderCentroids = collapseSameThemeCentroids(folderCentroids, themeCatalog);
  }

  return {
    folderCentroids,
    tagPrototypes,
    noteVectors,
    fingerprints,
    embedded,
    reused,
  };
}

export async function suggestForNote(
  embed: EmbedFn,
  index: VaultIndex,
  note: { path: string; filename: string; content: string },
  settings: VaultOrganizerSettings,
  opts?: {
    folderHint?: string;
    extraContext?: string;
    deadLinks?: string[];
    themeCatalog?: ThemeCatalog;
    forcedTheme?: string;
  }
): Promise<OrganizeSuggestion> {
  const body = headTail(stripFrontmatter(note.content));
  const text = opts?.extraContext
    ? headTail(`${body}\n${opts.extraContext}`)
    : body;
  let vec = index.noteVectors.get(note.path);
  if (!vec) {
    [vec] = await embed([text || note.filename]);
  }

  const contentTags = proposeTags(vec, index.tagPrototypes, {
    maxTags: settings.maxTags,
    noteText: text,
    noteFilename: note.filename,
  });
  const currentFolder = note.path.includes("/")
    ? note.path.split("/").slice(0, -1).join("/")
    : "";
  const existing = readExistingTags(note.content).filter((t) => {
    const bare = t.replace(/^#/, "").toLowerCase().replace(/-/g, " ");
    if (!currentFolder) return true;
    const parts = currentFolder.toLowerCase().split(/[/\s_-]+/);
    return !parts.includes(bare);
  });
  const tagHints = pickFolderRelevantTags(
    [...contentTags.map((t) => t.tag), ...existing],
    index.folderCentroids,
    index.tagPrototypes,
    3,
    opts?.themeCatalog
  );

  const folders = rankFolders(vec, index.folderCentroids, {
    allowNew: settings.allowNewFolders,
    maxDepth: settings.maxFolderDepth,
    noteText: text,
    noteFilename: note.filename,
    newFolderThreshold: settings.newFolderThreshold,
    topicFolderPrefix: settings.topicFolderPrefix,
    tagHints,
    themeCatalog: opts?.themeCatalog,
    forcedTheme: opts?.forcedTheme,
    useThemeCatalog: settings.useThemeCatalog,
  }).map((f) => ({
    ...f,
    folder: clampDepth(f.folder, settings.maxFolderDepth),
  }));

  const dest = opts?.folderHint || folders[0]?.folder;
  const tags = proposeTags(vec, index.tagPrototypes, {
    maxTags: settings.maxTags,
    noteText: text,
    noteFilename: note.filename,
    folderHint: dest,
  });
  const title = extractTitleHint(note.filename, note.content);
  const confidence = folders[0]?.score ?? 0;

  return {
    path: note.path,
    summary: text.slice(0, 160).replace(/\s+/g, " "),
    folders,
    tags,
    titles: [
      {
        title,
        score: 0.7,
        reason: "Extracted from heading or filename",
      },
    ],
    confidence,
    deadLinks: opts?.deadLinks?.length ? opts.deadLinks : undefined,
  };
}
