import * as fs from "fs";
import * as path from "path";

export interface GeneratedFoldersFile {
  /** Vault-relative folder paths created/owned by Vault Organizer. */
  folders: string[];
}

export class GeneratedFolderRegistry {
  private folders = new Set<string>();

  constructor(initial?: string[]) {
    for (const f of initial ?? []) this.add(f);
  }

  static load(filePath: string): GeneratedFolderRegistry {
    try {
      if (!fs.existsSync(filePath)) return new GeneratedFolderRegistry();
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as GeneratedFoldersFile;
      return new GeneratedFolderRegistry(
        Array.isArray(raw.folders) ? raw.folders : []
      );
    } catch {
      return new GeneratedFolderRegistry();
    }
  }

  save(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload: GeneratedFoldersFile = {
        folders: [...this.folders].sort((a, b) => a.localeCompare(b)),
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    } catch {
      /* ignore */
    }
  }

  add(folder: string): void {
    const f = folder.replace(/^\/+|\/+$/g, "").trim();
    if (!f) return;
    this.folders.add(f);
    // Also record every ancestor so empty parent cleanup can run.
    const parts = f.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      this.folders.add(cur);
    }
  }

  has(folder: string): boolean {
    const f = folder.replace(/^\/+|\/+$/g, "").trim();
    return this.folders.has(f);
  }

  /** True if this folder (or any prefix we own) may be pruned when empty. */
  isGenerated(folder: string): boolean {
    return this.has(folder);
  }

  list(): string[] {
    return [...this.folders];
  }
}
