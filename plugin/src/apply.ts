import type { OrganizeSuggestion, UndoRecord, VaultOrganizerSettings } from "./types";
import { normalizeTag } from "./text";

export interface ApplyDeps {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  ensureFolder: (folder: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<string>;
  getTagsFromCache?: (path: string) => string[];
  /** Return true if a vault path is already occupied. */
  pathExists?: (path: string) => boolean;
}

/** Pick a free destination path when consolidating notes with the same filename. */
export function uniqueDestPath(
  folder: string,
  targetName: string,
  fromPath: string,
  exists: (path: string) => boolean
): string {
  const stem = targetName.replace(/\.md$/i, "");
  for (let i = 0; i < 80; i++) {
    const name = i === 0 ? `${stem}.md` : `${stem} ${i + 1}.md`;
    const candidate = folder ? `${folder}/${name}` : name;
    if (candidate === fromPath) return candidate;
    if (!exists(candidate)) return candidate;
  }
  return folder
    ? `${folder}/${stem} ${Date.now()}.md`
    : `${stem} ${Date.now()}.md`;
}

/**
 * Clean frontmatter: drop tags/processed keys and orphan list items that follow scalars
 * (left behind by earlier broken tag writes).
 */
function rebuildFrontmatterBody(fm: string, dropKeys: Set<string>): string {
  const lines = fm.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      const rest = keyMatch[2].trim();
      if (dropKeys.has(key)) {
        i++;
        if (rest === "" || rest === "|" || rest === ">") {
          while (i < lines.length && /^\s+-(\s|$)/.test(lines[i])) i++;
        }
        continue;
      }
      out.push(line);
      i++;
      if (rest === "" || rest === "|" || rest === ">") {
        while (i < lines.length && /^\s+-(\s|$)/.test(lines[i])) {
          out.push(lines[i]);
          i++;
        }
      } else {
        // Scalar value — skip blank lines + orphan list items that wrongly follow.
        while (i < lines.length) {
          if (!lines[i].trim()) {
            let j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && /^\s+-(\s|$)/.test(lines[j])) {
              i = j;
              while (i < lines.length && /^\s+-(\s|$)/.test(lines[i])) i++;
              continue;
            }
            out.push(lines[i]);
            i++;
            continue;
          }
          if (/^\s+-(\s|$)/.test(lines[i])) {
            while (i < lines.length && /^\s+-(\s|$)/.test(lines[i])) i++;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (/^\s+-(\s|$)/.test(line)) {
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const DEAD_LINKS_KEY = "vault-organizer-dead-links";

export function upsertFrontmatter(
  content: string,
  tags: string[],
  processedKey: string,
  opts?: { deadLinks?: string[]; markProcessed?: boolean }
): string {
  const markProcessed = opts?.markProcessed !== false;
  const seen = new Set<string>();
  const tagList: string[] = [];
  for (const t of tags) {
    const clean = normalizeTag(t).replace(/^#/, "").toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    tagList.push(clean);
  }
  const processedLine = markProcessed ? `${processedKey}: processed` : "";
  const tagsBlock =
    tagList.length > 0
      ? `tags:\n${tagList.map((t) => `  - ${t}`).join("\n")}`
      : "tags: []";
  const dead = (opts?.deadLinks ?? []).filter(Boolean);
  const deadBlock =
    dead.length > 0
      ? `${DEAD_LINKS_KEY}:\n${dead.map((u) => `  - ${JSON.stringify(u)}`).join("\n")}`
      : "";

  const dropKeys = new Set(["tags", DEAD_LINKS_KEY]);
  if (markProcessed) dropKeys.add(processedKey);
  const extra = [tagsBlock, processedLine, deadBlock].filter(Boolean).join("\n");

  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = content.slice(4, end);
      const body = content.slice(end + 4);
      const cleaned = rebuildFrontmatterBody(fm, dropKeys);
      const nextFm = `${cleaned}\n${extra}`.trim() + "\n";
      return `---\n${nextFm}---${body.startsWith("\n") ? body : `\n${body}`}`;
    }
  }
  return `---\n${extra}\n---\n\n${content}`;
}

export function isProcessed(content: string, key: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return false;
  const fm = content.slice(0, end);
  return new RegExp(`^${key}:\\s*processed\\s*$`, "m").test(fm);
}

/** User manually filed this note — never auto-move it. */
export function isManualPinned(content: string, key: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return false;
  const fm = content.slice(0, end);
  if (new RegExp(`^${key}:\\s*manual\\s*$`, "m").test(fm)) return true;
  // Also honor an explicit tag.
  return readExistingTags(content).some(
    (t) => normalizeTag(t).toLowerCase() === "#manual-sort"
  );
}

/** Skip auto-organize: always honor manual pin; honor processed unless ignored. */
export function shouldSkipAutoOrganize(
  content: string,
  key: string,
  opts?: { ignoreProcessed?: boolean }
): boolean {
  if (isManualPinned(content, key)) return true;
  if (opts?.ignoreProcessed) return false;
  return isProcessed(content, key);
}

/**
 * Mark a note as manually filed (frontmatter + #manual-sort tag).
 * Preserves other frontmatter keys.
 */
export function markManualPinned(
  content: string,
  key: string,
  existingTags?: string[]
): string {
  const tags = existingTags ?? readExistingTags(content);
  const merged = [...tags];
  if (!merged.some((t) => normalizeTag(t).toLowerCase() === "#manual-sort")) {
    merged.push("#manual-sort");
  }
  const seen = new Set<string>();
  const tagList: string[] = [];
  for (const t of merged) {
    const clean = normalizeTag(t).replace(/^#/, "").toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    tagList.push(clean);
  }
  const tagsBlock =
    tagList.length > 0
      ? `tags:\n${tagList.map((t) => `  - ${t}`).join("\n")}`
      : "tags: []";
  const manualLine = `${key}: manual`;
  const dropKeys = new Set(["tags", key, "vault-organizer-dead-links"]);

  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = content.slice(4, end);
      const body = content.slice(end + 4);
      const cleaned = rebuildFrontmatterBody(fm, dropKeys);
      // Keep dead-links block if present by not stripping body; dead-links already dropped — OK for pin.
      const nextFm = `${cleaned}\n${tagsBlock}\n${manualLine}`.trim() + "\n";
      return `---\n${nextFm}---${body.startsWith("\n") ? body : `\n${body}`}`;
    }
  }
  return `---\n${tagsBlock}\n${manualLine}\n---\n\n${content}`;
}

/** Read existing frontmatter tags (list or scalar). */
export function readExistingTags(content: string): string[] {
  if (!content.startsWith("---")) return [];
  const end = content.indexOf("\n---", 3);
  if (end === -1) return [];
  const fm = content.slice(4, end);
  const inline = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
      .map((t) => (t.startsWith("#") ? t : `#${t}`));
  }
  const scalar = fm.match(/^tags:\s*(.+)\s*$/m);
  if (scalar && !scalar[1].startsWith("|") && scalar[1].trim() !== "") {
    const v = scalar[1].trim();
    if (!v.startsWith("-")) {
      return v.split(/[,\s]+/).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
    }
  }
  const tags: string[] = [];
  const lines = fm.split(/\r?\n/);
  let inTags = false;
  for (const line of lines) {
    if (/^tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) {
        const v = item[1].trim().replace(/^["']|["']$/g, "");
        tags.push(v.startsWith("#") ? v : `#${v}`);
        continue;
      }
      if (/^[a-zA-Z0-9_-]+:/.test(line)) break;
      if (!line.trim()) continue;
      break;
    }
  }
  return tags;
}

export async function applySuggestion(
  suggestion: OrganizeSuggestion,
  settings: VaultOrganizerSettings,
  deps: ApplyDeps,
  opts?: {
    rename?: boolean;
    folderIndex?: number;
    tagsOnly?: boolean;
    /** When false, update tags/dead-links without flipping the processed flag. */
    markProcessed?: boolean;
  }
): Promise<UndoRecord> {
  const folderIdx = opts?.folderIndex ?? 0;
  const folder = opts?.tagsOnly ? "" : suggestion.folders[folderIdx]?.folder ?? "";
  const content = await deps.read(suggestion.path);
  const previousTags = deps.getTagsFromCache?.(suggestion.path) ?? readExistingTags(content);
  const suggested = suggestion.tags.map((t) => t.tag);
  const deadLinks = suggestion.deadLinks ?? [];
  const withDeadTag =
    deadLinks.length > 0 ? [...suggested, "#has-dead-links"] : suggested;
  const merged: string[] = [];
  const seen = new Set<string>();
  // When no dead links, drop a stale has-dead-links tag from previous apply.
  const previousClean = previousTags.filter(
    (t) => normalizeTag(t).toLowerCase() !== "#has-dead-links" || deadLinks.length > 0
  );
  for (const t of [...withDeadTag, ...previousClean]) {
    const key = normalizeTag(t).toLowerCase();
    if (seen.has(key)) continue;
    if (key === "#has-dead-links" && deadLinks.length === 0) continue;
    seen.add(key);
    merged.push(t);
    if (merged.length >= settings.maxTags + (deadLinks.length ? 1 : 0)) break;
  }
  const nextContent = upsertFrontmatter(
    content,
    merged,
    settings.processedFrontmatterKey,
    { deadLinks, markProcessed: opts?.markProcessed }
  );
  await deps.write(suggestion.path, nextContent);

  let toPath = suggestion.path;
  if (folder) {
    await deps.ensureFolder(folder);
    const base = suggestion.path.split("/").pop()!;
    let targetName = base;
    if (opts?.rename && suggestion.titles[0]?.title) {
      targetName = `${suggestion.titles[0].title}.md`;
    }
    const exists = deps.pathExists ?? (() => false);
    const target = uniqueDestPath(folder, targetName, suggestion.path, exists);
    if (target !== suggestion.path) {
      toPath = await deps.rename(suggestion.path, target);
    }
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    fromPath: suggestion.path,
    toPath,
    addedTags: suggested,
    previousTags,
  };
}
