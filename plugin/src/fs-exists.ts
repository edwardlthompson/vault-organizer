/**
 * Obsidian's vault.adapter cannot see files under `.obsidian/`.
 * On desktop, use Node fs for absolute plugin/model paths.
 */
export function absolutePathExists(absPath: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    return fs.existsSync(absPath);
  } catch {
    return false;
  }
}

export function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, "/");
}
