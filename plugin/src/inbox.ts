import type { VaultOrganizerSettings } from "./types";

export function shouldWatchPath(path: string, settings: VaultOrganizerSettings): boolean {
  const inbox = settings.inboxFolder.replace(/\/$/, "");
  return path === inbox || path.startsWith(`${inbox}/`);
}

/** Note sits in vault root (no parent folder). */
export function isRootNote(path: string): boolean {
  return !path.includes("/");
}

/**
 * Uncategorized = vault-root notes and/or Inbox notes (configurable).
 * These are the primary targets for bulk organize-uncategorized.
 */
export function isUncategorized(path: string, settings: VaultOrganizerSettings): boolean {
  if (isExcluded(path, settings)) return false;
  if (settings.organizeRootNotes && isRootNote(path)) return true;
  if (settings.organizeInboxAsUncategorized && shouldWatchPath(path, settings)) return true;
  return false;
}

export function isExcluded(path: string, settings: VaultOrganizerSettings): boolean {
  return settings.excludedFolders.some(
    (ex) => path === ex || path.startsWith(`${ex}/`)
  );
}

export function shouldAutoApply(
  path: string,
  settings: VaultOrganizerSettings
): boolean {
  if (settings.applyMode === "auto-all") return true;
  if (settings.applyMode === "auto-inbox") return shouldWatchPath(path, settings);
  return false;
}
