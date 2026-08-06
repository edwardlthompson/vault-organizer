import {
  App,
  Notice,
  Plugin,
  TFile,
  TFolder,
  normalizePath,
  requestUrl,
  type PluginManifest,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { applySuggestion, isManualPinned, markManualPinned, readExistingTags, shouldSkipAutoOrganize } from "./apply";
import { GeneratedFolderRegistry } from "./generated-folders";
import {
  createProductionEmbedder,
  modelRelativePath,
  type EmbedFn,
  type EmbedderStatus,
} from "./embedder";
import { probeHardware } from "./hardware";
import { isExcluded, isUncategorized, shouldAutoApply, shouldWatchPath } from "./inbox";
import { PreviewOrganizeModal, ProgressModal, RepairModelModal } from "./modals";
import { ConcurrentQueue } from "./queue";
import { VaultOrganizerSettingTab } from "./settings-tab";
import {
  buildVaultIndex,
  suggestForNote,
  type VaultIndex,
} from "./sorter";
import { JobCancelledError } from "./job";
import { isJunkTopicFolder, extractTopicTerms } from "./text";
import {
  enrichWithLinks,
  setLinkRequester,
  type LinkCache,
} from "./links";
import {
  cacheToSeedMap,
  loadIndexCache,
  migrateCachePath,
  saveIndexCache,
  writeSeedMapToCache,
  type IndexCacheFile,
} from "./index-cache";
import {
  ThemeCatalog,
  type ThemeMap,
  type ThemesFile,
} from "./themes";
import {
  nameTheme,
  type ThemeNameCache,
  type WikiRequester,
} from "./theme-namer";
import {
  DEFAULT_SETTINGS,
  type OrganizeSuggestion,
  type VaultOrganizerSettings,
} from "./types";
import { UndoStack } from "./undo";

export default class VaultOrganizerPlugin extends Plugin {
  settings: VaultOrganizerSettings = DEFAULT_SETTINGS;
  private embed: EmbedFn | null = null;
  private embedStatus: EmbedderStatus | null = null;
  private index: VaultIndex | null = null;
  private queue = new ConcurrentQueue(2);
  private undo = new UndoStack();
  private statusEl: HTMLElement | null = null;
  private jobCancel = false;
  private activeProgress: ProgressModal | null = null;
  /** Exclusive lock — overlapping ONNX rebuilds freeze Obsidian's main thread. */
  private busy = false;
  private busyLabel = "";
  private lastProgressWriteMs = 0;
  private automationRunning = false;
  private loggedSkipInboxNoIndex = false;
  private linkCache: LinkCache = {};
  private indexCache: IndexCacheFile | null = null;
  private themeCatalog: ThemeCatalog | null = null;
  private themeNameCache: ThemeNameCache = {};
  private generatedFolders: GeneratedFolderRegistry | null = null;
  /** True while plugin is renaming/moving notes — skip manual-pin listener. */
  private pluginMoving = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.loadLinkCache();
    this.loadThemeNameCache();
    this.generatedFolders = GeneratedFolderRegistry.load(this.generatedFoldersPath());
    setLinkRequester(async ({ url, method, timeoutMs }) => {
      const res = await requestUrl({
        url,
        method,
        throw: false,
        headers:
          method === "GET"
            ? { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" }
            : undefined,
        // Obsidian supports timeout at runtime; typings may lag.
        ...( { timeout: timeoutMs } as object ),
      } as Parameters<typeof requestUrl>[0]);
      return {
        status: res.status,
        text: typeof res.text === "string" ? res.text : "",
      };
    });
    this.addSettingTab(new VaultOrganizerSettingTab(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("vault-organizer-status");
    this.setStatus("Vault Organizer: starting…");

    // Start automation poll before embedder load — ONNX init can take a long time.
    this.scheduleAutomationPoll();

    this.addRibbonIcon("folder-tree", "Vault Organizer", async () => {
      await this.organizeActiveNote(true);
    });

    this.addCommand({
      id: "organize-current-note",
      name: "Organize current note",
      callback: async () => this.organizeActiveNote(true),
    });

    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild vault embedding index",
      callback: async () => {
        await this.rebuildIndex(true);
      },
    });

    this.addCommand({
      id: "organize-vault",
      name: "Organize entire vault (review)",
      callback: async () => this.organizeMany(this.listMarkdownFiles(), false),
    });

    this.addCommand({
      id: "organize-uncategorized",
      name: "Organize uncategorized notes (root + Inbox)",
      callback: async () => this.organizeUncategorized(false),
    });

    this.addCommand({
      id: "organize-uncategorized-apply",
      name: "Organize uncategorized notes (auto-apply / move files)",
      callback: async () => this.organizeUncategorized(true),
    });

    this.addCommand({
      id: "reorganize-junk-folders",
      name: "Re-file notes in URL-junk folders (auto-apply)",
      callback: async () => this.reorganizeJunkFolders(true),
    });

    this.addCommand({
      id: "retag-vault",
      name: "Retag all notes (keep folders)",
      callback: async () => this.retagVault(),
    });

    this.addCommand({
      id: "recategorize-vault",
      name: "Recategorize vault using tags + embeddings (auto-apply)",
      callback: async () => this.recategorizeVault(),
    });

    this.addCommand({
      id: "consolidate-themes",
      name: "Consolidate vault into themes (auto-apply)",
      callback: async () => this.consolidateIntoThemes(),
    });

    this.addCommand({
      id: "scan-dead-links",
      name: "Scan vault for dead links",
      callback: async () => this.scanDeadLinks(),
    });

    this.addCommand({
      id: "organize-inbox",
      name: "Process Inbox",
      callback: async () => {
        const inbox = this.settings.inboxFolder.replace(/\/$/, "");
        const files = this.listMarkdownFiles().filter(
          (f) => f.path === inbox || f.path.startsWith(`${inbox}/`)
        );
        await this.organizeMany(files, this.settings.applyMode !== "suggest");
      },
    });

    this.addCommand({
      id: "undo-last-organize",
      name: "Undo last organize action",
      callback: async () => this.undoLast(),
    });

    this.addCommand({
      id: "cancel-job",
      name: "Cancel current job",
      callback: () => {
        this.requestCancel("command");
      },
    });

    this.registerEvent(
      this.app.vault.on("create", (f) => {
        if (f instanceof TFile && f.extension === "md") {
          this.scheduleInbox(f);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => {
        if (f instanceof TFile && f.extension === "md") {
          this.scheduleInbox(f);
          void this.onUserNoteMoved(f, oldPath);
        }
      })
    );

    // Load embedder only — do NOT auto-rebuild index on startup.
    // Startup rebuild races with automation and freezes the UI for many minutes.
    void this.reloadEmbedder();
  }

  onunload(): void {
    this.jobCancel = true;
    setLinkRequester(null);
  }

  private requestCancel(source: string): void {
    this.jobCancel = true;
    new Notice("Vault Organizer: cancel requested");
    this.setStatus("Vault Organizer: cancelling…", true);
    this.appendLogcat("warn", `cancel requested via ${source}`);
  }

  /** Run at most one heavy job (index / organize). Reject overlaps instead of stacking ONNX. */
  private async runExclusive(label: string, fn: () => Promise<void>): Promise<boolean> {
    if (this.busy) {
      const msg = `Busy (${this.busyLabel}) — cancel or wait before: ${label}`;
      new Notice(`Vault Organizer: ${msg}`, 6000);
      this.appendLogcat("warn", msg);
      this.writeAutomationLog("job-rejected", { label, busy: this.busyLabel });
      return false;
    }
    this.busy = true;
    this.busyLabel = label;
    this.jobCancel = false;
    this.appendLogcat("event", `job-start:${label}`);
    try {
      await fn();
      return true;
    } catch (err) {
      if (err instanceof JobCancelledError) {
        this.setStatus("Vault Organizer: cancelled");
        this.writeAutomationLog("job-cancelled", { label });
        return false;
      }
      throw err;
    } finally {
      this.busy = false;
      this.busyLabel = "";
      this.appendLogcat("event", `job-end:${label}`);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private linkCachePath(): string {
    return path.join(this.pluginRootAbs(), "link-cache.json");
  }

  private indexCachePath(): string {
    return path.join(this.pluginRootAbs(), "index-cache.json");
  }

  private loadLinkCache(): void {
    try {
      const p = this.linkCachePath();
      if (fs.existsSync(p)) {
        this.linkCache = JSON.parse(fs.readFileSync(p, "utf8")) as LinkCache;
      }
    } catch {
      this.linkCache = {};
    }
  }

  private saveLinkCache(): void {
    try {
      const root = this.pluginRootAbs();
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(this.linkCachePath(), JSON.stringify(this.linkCache));
    } catch {
      /* ignore */
    }
  }

  private ensureIndexCache(): IndexCacheFile {
    if (
      !this.indexCache ||
      this.indexCache.modelPackId !== this.settings.modelPackId
    ) {
      this.indexCache = loadIndexCache(
        this.indexCachePath(),
        this.settings.modelPackId
      );
    }
    return this.indexCache;
  }

  private persistIndexCache(index: VaultIndex): void {
    const cache = this.ensureIndexCache();
    const seed = new Map<string, { fp: string; vector: number[] }>();
    for (const [p, vector] of index.noteVectors) {
      const fp = index.fingerprints.get(p);
      if (!fp) continue;
      seed.set(p, { fp, vector });
    }
    writeSeedMapToCache(cache, seed, new Set(index.noteVectors.keys()));
    saveIndexCache(this.indexCachePath(), cache);
    this.indexCache = cache;
  }

  private migrateIndexPath(from: string, to: string): void {
    if (!from || !to || from === to) return;
    if (this.index) {
      const v = this.index.noteVectors.get(from);
      if (v) {
        this.index.noteVectors.delete(from);
        this.index.noteVectors.set(to, v);
      }
      const fp = this.index.fingerprints.get(from);
      if (fp) {
        this.index.fingerprints.delete(from);
        this.index.fingerprints.set(to, fp);
      }
    }
    const cache = this.ensureIndexCache();
    migrateCachePath(cache, from, to);
    saveIndexCache(this.indexCachePath(), cache);
  }

  /**
   * Pull context from note links (URL path tokens + optional page titles)
   * and collect dead external/wiki links. Network only when settings ask for it.
   */
  private async enrichNoteLinks(
    content: string,
    sourcePath: string,
    opts?: { network?: boolean }
  ): Promise<{ contextText: string; deadLinks: string[]; linkTitles: string[] }> {
    if (!this.settings.useLinkContext && !this.settings.checkDeadLinks) {
      return { contextText: "", deadLinks: [], linkTitles: [] };
    }
    const network = opts?.network !== false;
    const result = await enrichWithLinks(content, {
      checkDead: network && this.settings.checkDeadLinks,
      fetchTitles: network && this.settings.useLinkContext,
      maxUrls: this.settings.maxLinksPerNote,
      cache: this.linkCache,
      resolveWiki:
        network && this.settings.checkDeadLinks
          ? (target) =>
              !!this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)
          : undefined,
    });
    if (network) this.saveLinkCache();
    return {
      contextText: this.settings.useLinkContext ? result.contextText : "",
      deadLinks: result.deadLinks.map((d) => d.url),
      linkTitles: result.liveLinks
        .map((l) => l.title)
        .filter((t): t is string => !!t),
    };
  }

  private themesVaultPath(): string {
    return "_VaultOrganizer/themes.json";
  }

  private themeNameCachePath(): string {
    return path.join(this.pluginRootAbs(), "theme-name-cache.json");
  }

  private generatedFoldersPath(): string {
    return path.join(this.pluginRootAbs(), "generated-folders.json");
  }

  private ensureGeneratedRegistry(): GeneratedFolderRegistry {
    if (!this.generatedFolders) {
      this.generatedFolders = GeneratedFolderRegistry.load(
        this.generatedFoldersPath()
      );
    }
    return this.generatedFolders;
  }

  /**
   * After upgrade: if we have no registry yet, claim existing builtin theme
   * folders as plugin-managed so empty ones can be pruned safely.
   */
  private bootstrapGeneratedFolders(): void {
    const reg = this.ensureGeneratedRegistry();
    if (reg.list().length > 0) return;
    const catalog = new ThemeCatalog();
    for (const theme of [...catalog.listBuiltinThemes(), "Misc"]) {
      if (this.app.vault.getAbstractFileByPath(theme)) {
        reg.add(theme);
      }
    }
    reg.save(this.generatedFoldersPath());
  }

  private markGeneratedFolder(folder: string): void {
    const reg = this.ensureGeneratedRegistry();
    reg.add(folder);
    reg.save(this.generatedFoldersPath());
  }

  /**
   * When the user moves a note between folders (not the plugin), pin it so
   * auto-organize / consolidate never relocates it again.
   */
  private async onUserNoteMoved(file: TFile, oldPath: string): Promise<void> {
    if (this.pluginMoving || this.busy) return;
    const oldFolder = oldPath.includes("/")
      ? oldPath.slice(0, oldPath.lastIndexOf("/"))
      : "";
    const newFolder =
      file.parent && file.parent.path !== "/" ? file.parent.path : "";
    if (oldFolder === newFolder) return; // filename-only rename
    try {
      const content = await this.app.vault.read(file);
      if (isManualPinned(content, this.settings.processedFrontmatterKey)) return;
      const next = markManualPinned(
        content,
        this.settings.processedFrontmatterKey,
        this.collectTags(file)
      );
      await this.app.vault.modify(file, next);
      this.appendLogcat("event", `manual-pin:${file.path}`);
      new Notice(`Vault Organizer: pinned manual folder for ${file.name}`, 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.appendLogcat("warn", `manual-pin failed ${file.path}: ${msg}`);
    }
  }

  private async loadThemeCatalog(): Promise<ThemeCatalog> {
    if (this.themeCatalog) return this.themeCatalog;
    let overrides = {};
    try {
      const p = this.themesVaultPath();
      if (await this.app.vault.adapter.exists(p)) {
        const raw = await this.app.vault.adapter.read(p);
        const parsed = JSON.parse(raw || "{}") as ThemesFile | ThemeMap;
        this.themeCatalog = ThemeCatalog.fromFile(parsed);
        return this.themeCatalog;
      }
    } catch {
      /* ignore */
    }
    this.themeCatalog = new ThemeCatalog(overrides as ThemeMap);
    return this.themeCatalog;
  }

  private async persistThemeCatalog(): Promise<void> {
    if (!this.themeCatalog) return;
    const folder = "_VaultOrganizer";
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        /* race */
      }
    }
    // Only persist non-builtin overrides so learned junk themes cannot pollute.
    const payload = JSON.stringify(this.themeCatalog.toFile(false), null, 2);
    try {
      await this.app.vault.adapter.write(this.themesVaultPath(), payload);
    } catch {
      /* ignore */
    }
  }

  private loadThemeNameCache(): void {
    try {
      const p = this.themeNameCachePath();
      if (fs.existsSync(p)) {
        this.themeNameCache = JSON.parse(
          fs.readFileSync(p, "utf8")
        ) as ThemeNameCache;
      }
    } catch {
      this.themeNameCache = {};
    }
  }

  private saveThemeNameCache(): void {
    try {
      const root = this.pluginRootAbs();
      if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(
        this.themeNameCachePath(),
        JSON.stringify(this.themeNameCache)
      );
    } catch {
      /* ignore */
    }
  }

  private wikiRequester(): WikiRequester {
    return async (url: string) => {
      const res = await requestUrl({
        url,
        method: "GET",
        throw: false,
        headers: { Accept: "application/json" },
      } as Parameters<typeof requestUrl>[0]);
      let json: unknown;
      try {
        json = JSON.parse(typeof res.text === "string" ? res.text : "");
      } catch {
        json = undefined;
      }
      return {
        status: res.status,
        json,
        text: typeof res.text === "string" ? res.text : "",
      };
    };
  }

  private async resolveForcedTheme(
    hints: string[],
    linkTitles: string[]
  ): Promise<string | undefined> {
    if (!this.settings.useThemeCatalog) return undefined;
    const catalog = await this.loadThemeCatalog();
    const hit = catalog.themeFolderForHints([...hints, ...linkTitles]);
    if (hit) return hit;
    if (!this.settings.onlineThemeNaming) return undefined;
    const named = await nameTheme(
      {
        hints,
        linkTitles,
        existingThemes: catalog.listBuiltinThemes(),
        catalog,
      },
      {
        online: true,
        request: this.wikiRequester(),
        cache: this.themeNameCache,
        onLearn: (syn, theme) => catalog.learn(syn, theme),
      }
    );
    this.saveThemeNameCache();
    if (named.synonyms.length) await this.persistThemeCatalog();
    return named.theme;
  }

  private async suggestForFile(
    file: TFile,
    content: string,
    opts?: { folderHint?: string; networkLinks?: boolean }
  ): Promise<OrganizeSuggestion> {
    const network = opts?.networkLinks === true;
    const enrich = await this.enrichNoteLinks(content, file.path, {
      network,
    });
    const catalog = this.settings.useThemeCatalog
      ? await this.loadThemeCatalog()
      : undefined;
    // Lightweight hints before full suggest (filename + existing tags).
    const currentFolder =
      file.parent && file.parent.path !== "/" ? file.parent.path : "";
    const quickHints = [
      file.basename,
      currentFolder,
      ...(currentFolder ? currentFolder.split(/[/\s_-]+/) : []),
      ...readExistingTags(content).map((t) => t.replace(/^#/, "")),
      ...extractTopicTerms(content, 8),
    ];
    // Prefer remapping the note's current folder leaf (consolidates Metamask Act → Cryptocurrency).
    let forcedTheme: string | undefined;
    if (catalog) {
      if (currentFolder) {
        const remapped = catalog.remapFolderLeaf(currentFolder);
        const leaf = remapped.split("/").pop() || "";
        const origLeaf = currentFolder.split("/").pop() || "";
        if (leaf && leaf.toLowerCase() !== origLeaf.toLowerCase()) {
          forcedTheme = leaf;
        } else if (origLeaf && !catalog.isBuiltinTheme(origLeaf)) {
          // Leftover invented folders (Drift Event, May Cave, …) → Misc.
          forcedTheme = "Misc";
        }
      }
      if (!forcedTheme) {
        forcedTheme = await this.resolveForcedTheme(quickHints, enrich.linkTitles);
      }
    }

    return suggestForNote(
      this.embed!,
      this.index!,
      { path: file.path, filename: file.name, content },
      this.settings,
      {
        folderHint: opts?.folderHint,
        extraContext: enrich.contextText || undefined,
        deadLinks: enrich.deadLinks,
        themeCatalog: catalog,
        forcedTheme,
      }
    );
  }

  /** Vault-relative path to the model pack directory. */
  pluginModelsRel(): string {
    return normalizePath(
      `${this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`}/${modelRelativePath(this.settings.modelPackId)}`
    );
  }

  /** Absolute path when desktop adapter exposes basePath (for Transformers.js local load). */
  pluginModelsRoot(): string {
    const rel = this.pluginModelsRel();
    const base = (this.app.vault.adapter as { basePath?: string }).basePath;
    if (base) return normalizePath(`${base}/${rel}`);
    return rel;
  }

  async reloadEmbedder(): Promise<void> {
    const hardware = probeHardware(this.settings);
    this.queue.setConcurrency(hardware.batchSize);
    this.setStatus("Vault Organizer: loading model…", true);
    new Notice("Vault Organizer: loading embedding model…", 4000);
    // Absolute FS path — vault.adapter cannot see `.obsidian/plugins/...`
    const modelDir = this.pluginModelsRoot();
    const result = await createProductionEmbedder({
      modelDir,
      hardware,
    });
    this.embed = result.embed;
    this.embedStatus = result.status;
    this.setStatus(
      result.status.mode === "missing"
        ? "Vault Organizer: model missing"
        : `Vault Organizer: ${result.status.message}`
    );
    if (result.status.mode === "missing") {
      new Notice(result.status.message, 8000);
    } else if (result.status.mode === "hash-fallback") {
      new Notice(result.status.message, 8000);
    } else {
      new Notice(`Vault Organizer: ${result.status.message}`, 4000);
    }
    this.writeAutomationLog("embedder-ready");
  }

  private setStatus(text: string, busy = false): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-busy", busy);
    // Throttle disk IO — sync writes during ONNX were contributing to FS timeouts.
    const now = Date.now();
    if (!busy || now - this.lastProgressWriteMs >= 2000) {
      this.lastProgressWriteMs = now;
      this.appendLogcat(busy ? "progress" : "info", text);
      if (busy) {
        try {
          fs.writeFileSync(
            path.join(this.pluginRootAbs(), "progress.json"),
            JSON.stringify({ ts: new Date().toISOString(), statusBar: text }, null, 2),
            "utf8"
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Append one line to plugin logcat.jsonl for external monitors. */
  private appendLogcat(level: string, message: string, extra: Record<string, unknown> = {}): void {
    try {
      const out = path.join(this.pluginRootAbs(), "logcat.jsonl");
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        ...extra,
      });
      fs.appendFileSync(out, line + "\n", "utf8");
    } catch {
      /* ignore logging failures */
    }
  }

  /** Write a small JSON status file for external automation (CDP/SendKeys). */
  private writeAutomationLog(event: string, extra: Record<string, unknown> = {}): void {
    try {
      const out = path.join(this.pluginRootAbs(), "last-run.json");
      const payload = {
        ts: new Date().toISOString(),
        event,
        embedStatus: this.embedStatus,
        statusBar: this.statusEl?.textContent ?? null,
        ...extra,
      };
      fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
      this.appendLogcat("event", event, {
        statusBar: payload.statusBar,
        ...extra,
      });
    } catch {
      /* ignore logging failures */
    }
  }

  private listMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, this.settings));
  }

  /** Root-level and/or Inbox notes that are not yet processed. */
  private async listUncategorizedFiles(): Promise<TFile[]> {
    const candidates = this.listMarkdownFiles().filter((f) =>
      isUncategorized(f.path, this.settings)
    );
    const out: TFile[] = [];
    for (const f of candidates) {
      const content = await this.app.vault.cachedRead(f);
      if (
        !shouldSkipAutoOrganize(content, this.settings.processedFrontmatterKey)
      ) {
        out.push(f);
      }
    }
    return out;
  }

  async organizeUncategorized(
    autoApply: boolean,
    opts: { skipRebuild?: boolean } = {}
  ): Promise<void> {
    const files = await this.listUncategorizedFiles();
    if (files.length === 0) {
      new Notice(
        "Vault Organizer: no uncategorized notes (vault root / Inbox) left to organize"
      );
      this.setStatus("Vault Organizer: nothing uncategorized");
      return;
    }
    new Notice(
      `Vault Organizer: ${files.length} uncategorized note(s) in root/Inbox…`,
      5000
    );
    await this.runExclusive("organize-uncategorized", async () => {
      if (!opts.skipRebuild || !this.index) {
        await this.runRebuildIndex(true);
      }
      if (this.jobCancel) throw new JobCancelledError();
      await this.runOrganizeMany(files, autoApply);
    });
  }

  /** Re-file notes currently sitting in URL-noise folders (Https Com, etc.). */
  async reorganizeJunkFolders(autoApply: boolean): Promise<void> {
    const files = this.listMarkdownFiles().filter((f) => {
      const top = f.path.split("/")[0] ?? "";
      return isJunkTopicFolder(top);
    });
    if (files.length === 0) {
      new Notice("Vault Organizer: no URL-junk folders found");
      this.setStatus("Vault Organizer: no junk folders");
      return;
    }
    new Notice(
      `Vault Organizer: re-filing ${files.length} note(s) from URL-junk folders…`,
      6000
    );
    await this.runExclusive("reorganize-junk", async () => {
      await this.runRebuildIndex(true);
      if (this.jobCancel) throw new JobCancelledError();
      await this.runOrganizeMany(files, autoApply, { ignoreProcessed: true });
    });
  }

  /** Refresh tags on every note from folder + topics; does not move files. */
  async retagVault(): Promise<void> {
    const files = this.listMarkdownFiles();
    new Notice(`Vault Organizer: retagging ${files.length} notes…`, 5000);
    await this.runExclusive("retag-vault", async () => {
      await this.runRebuildIndex(true);
      if (this.jobCancel) throw new JobCancelledError();
      if (!this.embed || !this.index) return;

      const progress = new ProgressModal(this.app, "Retagging vault", () => {
        this.requestCancel("progress-modal");
      });
      this.activeProgress = progress;
      progress.open();
      let done = 0;
      const total = files.length;
      let tagged = 0;

      await Promise.all(
        files.map((file) =>
          this.queue.add(async () => {
            if (this.jobCancel) return;
            const content = await this.app.vault.cachedRead(file);
            const folder =
              file.parent?.path === "/" || !file.parent ? "" : file.parent.path;
            const suggestion = await this.suggestForFile(file, content, {
              folderHint: folder || undefined,
            });
            await this.applyOne(suggestion, {
              folderIndex: 0,
              rename: false,
              tagsOnly: true,
            });
            tagged++;
            done++;
            progress.update({
              phase: "Retagging notes…",
              done,
              total,
              detail: file.path,
            });
            this.setStatus(`Vault Organizer: retag ${done}/${total}`, true);
          })
        )
      );

      if (this.jobCancel || progress.wasCancelled) {
        progress.finish(`Cancelled at ${done}/${total}`);
        throw new JobCancelledError();
      }
      progress.finish(`Retagged ${tagged} notes`);
      this.setStatus(`Vault Organizer: retagged ${tagged} notes`);
      new Notice(`Vault Organizer: retagged ${tagged} notes`, 8000);
      this.writeAutomationLog("retag-finished", { tagged, total });
      this.activeProgress = null;
    });
  }

  /** Re-file every note using content tags + embeddings (ignores processed flag). */
  async recategorizeVault(): Promise<void> {
    const files = this.listMarkdownFiles();
    new Notice(
      `Vault Organizer: recategorizing ${files.length} notes with tags…`,
      6000
    );
    await this.runExclusive("recategorize-vault", async () => {
      await this.runRebuildIndex(true);
      if (this.jobCancel) throw new JobCancelledError();
      await this.runOrganizeMany(files, true, { ignoreProcessed: true });
    });
  }

  /**
   * Collapse vault into theme catalog folders (Bitcoin/Crypto → Cryptocurrency, etc.).
   * Uses network for link titles + Wikipedia naming on catalog misses.
   */
  async consolidateIntoThemes(): Promise<void> {
    const files = this.listMarkdownFiles();
    new Notice(
      `Vault Organizer: consolidating ${files.length} notes into themes…`,
      6000
    );
    await this.runExclusive("consolidate-themes", async () => {
      this.themeCatalog = null;
      await this.loadThemeCatalog();
      this.bootstrapGeneratedFolders();
      await this.runRebuildIndex(true);
      if (this.jobCancel) throw new JobCancelledError();
      await this.runOrganizeMany(files, true, {
        ignoreProcessed: true,
        networkLinks: true,
      });
      if (this.jobCancel) throw new JobCancelledError();
      const removed = await this.pruneEmptyFolders();
      new Notice(
        `Vault Organizer: theme consolidate done · removed ${removed} empty folder(s)`,
        10000
      );
      this.writeAutomationLog("consolidate-themes-finished", { removed });
    });
  }

  /** Remove empty *plugin-generated* folders only. Never deletes user-created folders. */
  private async pruneEmptyFolders(): Promise<number> {
    const excluded = new Set(
      this.settings.excludedFolders.map((e) => e.replace(/\/$/, ""))
    );
    excluded.add(this.settings.inboxFolder.replace(/\/$/, ""));
    const generated = this.ensureGeneratedRegistry();
    let removed = 0;
    const base = (this.app.vault.adapter as { basePath?: string }).basePath;
    if (base && fs.existsSync(base)) {
      const walk = (dir: string, rel: string): boolean => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return false;
        }
        let empty = true;
        for (const ent of entries) {
          if (ent.name.startsWith(".")) {
            empty = false;
            continue;
          }
          const childRel = rel ? `${rel}/${ent.name}` : ent.name;
          const childAbs = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            const top = childRel.split("/")[0];
            if (excluded.has(childRel) || excluded.has(top)) {
              empty = false;
              walk(childAbs, childRel);
              continue;
            }
            const childEmpty = walk(childAbs, childRel);
            if (childEmpty && generated.isGenerated(childRel)) {
              try {
                fs.rmdirSync(childAbs);
                removed++;
              } catch {
                empty = false;
              }
            } else {
              if (!childEmpty) empty = false;
              // User-created empty folders: leave in place.
              else empty = false;
            }
          } else {
            empty = false;
          }
        }
        return empty && !!rel && generated.isGenerated(rel);
      };
      walk(base, "");
    }
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .sort((a, b) => b.path.length - a.path.length);
    for (const folder of folders) {
      if (!folder.path || folder.path === "/") continue;
      const top = folder.path.split("/")[0];
      if (excluded.has(folder.path) || excluded.has(top)) continue;
      if (!generated.isGenerated(folder.path)) continue;
      if (folder.children.length === 0) {
        try {
          await this.app.vault.delete(folder);
          removed++;
        } catch {
          /* ignore */
        }
      }
    }
    return removed;
  }

  /** Probe links in every note; write dead-link frontmatter + #has-dead-links. */
  async scanDeadLinks(): Promise<void> {
    if (!this.settings.checkDeadLinks) {
      new Notice("Enable “Check dead links” in Vault Organizer settings first");
      return;
    }
    const files = this.listMarkdownFiles();
    new Notice(`Vault Organizer: scanning ${files.length} notes for dead links…`, 5000);
    await this.runExclusive("scan-dead-links", async () => {
      const progress = new ProgressModal(this.app, "Scanning dead links", () => {
        this.requestCancel("progress-modal");
      });
      this.activeProgress = progress;
      progress.open();
      let done = 0;
      let notesWithDead = 0;
      let deadTotal = 0;
      const total = files.length;

      await Promise.all(
        files.map((file) =>
          this.queue.add(async () => {
            if (this.jobCancel) return;
            const content = await this.app.vault.cachedRead(file);
            const enrich = await this.enrichNoteLinks(content, file.path);
            if (enrich.deadLinks.length > 0 || content.includes("vault-organizer-dead-links")) {
              const stub: OrganizeSuggestion = {
                path: file.path,
                summary: "",
                folders: [],
                tags: [],
                titles: [],
                confidence: 0,
                deadLinks: enrich.deadLinks,
              };
              await this.applyOne(stub, {
                folderIndex: 0,
                rename: false,
                tagsOnly: true,
                markProcessed: false,
              });
              if (enrich.deadLinks.length > 0) {
                notesWithDead++;
                deadTotal += enrich.deadLinks.length;
              }
            }
            done++;
            progress.update({
              phase: "Probing links…",
              done,
              total,
              detail: file.path,
            });
            this.setStatus(`Vault Organizer: links ${done}/${total}`, true);
          })
        )
      );

      if (this.jobCancel || progress.wasCancelled) {
        progress.finish(`Cancelled at ${done}/${total}`);
        throw new JobCancelledError();
      }
      progress.finish(`${notesWithDead} notes · ${deadTotal} dead links`);
      this.setStatus(
        `Vault Organizer: ${deadTotal} dead links in ${notesWithDead} notes`
      );
      new Notice(
        `Vault Organizer: ${deadTotal} dead link(s) in ${notesWithDead} note(s)`,
        10000
      );
      this.writeAutomationLog("dead-link-scan-finished", {
        notesWithDead,
        deadTotal,
        total,
      });
      this.activeProgress = null;
    });
  }

  private collectTags(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = new Set<string>();
    cache?.tags?.forEach((t) => tags.add(t.tag));
    const fm = cache?.frontmatter?.tags;
    if (Array.isArray(fm)) fm.forEach((t) => tags.add(String(t).startsWith("#") ? String(t) : `#${t}`));
    else if (typeof fm === "string") tags.add(fm.startsWith("#") ? fm : `#${fm}`);
    return [...tags];
  }

  async rebuildIndex(notify: boolean): Promise<void> {
    await this.runExclusive("rebuild-index", async () => {
      await this.runRebuildIndex(notify);
    });
  }

  private async runRebuildIndex(notify: boolean): Promise<void> {
    if (!this.embed) await this.reloadEmbedder();
    if (!this.embed) return;
    if (this.embedStatus && !this.embedStatus.ready && this.embedStatus.mode === "missing") {
      if (notify) {
        new RepairModelModal(this.app, this.pluginModelsRoot(), this.embedStatus.message).open();
      }
      return;
    }

    const files = this.listMarkdownFiles();
    const progress = notify
      ? new ProgressModal(this.app, "Rebuilding embedding index", () => {
          this.requestCancel("progress-modal");
        })
      : null;
    this.activeProgress = progress;
    progress?.open();
    progress?.update({
      phase: "Reading notes…",
      done: 0,
      total: files.length,
      detail: `${files.length} markdown files`,
    });
    this.setStatus(`Vault Organizer: reading ${files.length} notes…`, true);
    if (notify) new Notice(`Vault Organizer: indexing ${files.length} notes…`, 5000);

    const notes = [];
    for (let i = 0; i < files.length; i++) {
      if (this.jobCancel) break;
      const f = files[i];
      const content = await this.app.vault.cachedRead(f);
      const folder = f.parent?.path === "/" || !f.parent ? "" : f.parent.path;
      notes.push({
        path: f.path,
        folder,
        content,
        tags: this.collectTags(f),
      });
      if (i % 25 === 0 || i === files.length - 1) {
        progress?.update({
          phase: "Reading notes…",
          done: i + 1,
          total: files.length,
          detail: f.path,
        });
        this.setStatus(`Vault Organizer: read ${i + 1}/${files.length}`, true);
      }
    }

    if (this.jobCancel) {
      progress?.finish("Cancelled");
      this.setStatus("Vault Organizer: cancelled");
      this.activeProgress = null;
      throw new JobCancelledError();
    }

    progress?.update({
      phase: "Embedding notes (ONNX)…",
      done: 0,
      total: notes.length,
      detail: "Reusing cached vectors when note text is unchanged",
    });
    this.setStatus("Vault Organizer: embedding…", true);

    const seed = cacheToSeedMap(this.ensureIndexCache());
    let embedded = 0;
    let reused = 0;
    try {
      const catalog = this.settings.useThemeCatalog
        ? await this.loadThemeCatalog()
        : undefined;
      const built = await buildVaultIndex(
        this.embed,
        notes,
        this.settings,
        (done, total, detail) => {
          progress?.update({
            phase: "Embedding notes (ONNX)…",
            done,
            total,
            detail,
          });
          this.setStatus(`Vault Organizer: embed ${done}/${total}`, true);
        },
        () => this.jobCancel,
        seed,
        catalog
      );
      embedded = built.embedded;
      reused = built.reused;
      this.index = built;
      this.persistIndexCache(built);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        progress?.finish("Cancelled");
        this.setStatus("Vault Organizer: cancelled");
        this.activeProgress = null;
        throw err;
      }
      throw err;
    }

    const msg = `Index ready (${notes.length} notes, ${this.index.folderCentroids.length} folders · ${reused} cached, ${embedded} embedded)`;
    progress?.finish(msg);
    this.setStatus(`Vault Organizer: ${msg}`);
    if (notify) new Notice(`Vault Organizer: ${msg}`, 6000);
    this.writeAutomationLog("index-rebuilt", {
      notes: notes.length,
      folders: this.index.folderCentroids.length,
      reused,
      embedded,
    });
    this.activeProgress = null;
  }

  private async ensureIndex(): Promise<boolean> {
    if (!this.embed) await this.reloadEmbedder();
    if (this.embedStatus?.mode === "missing") {
      new RepairModelModal(
        this.app,
        this.pluginModelsRoot(),
        this.embedStatus.message
      ).open();
      return false;
    }
    if (!this.index) {
      // Nested rebuild under an already-held exclusive lock (e.g. organize).
      if (this.busy) await this.runRebuildIndex(false);
      else await this.rebuildIndex(false);
    }
    return !!this.index && !!this.embed;
  }

  async organizeActiveNote(showPreview: boolean): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("Open a markdown note first");
      return;
    }
    if (!(await this.ensureIndex()) || !this.embed || !this.index) return;

    const content = await this.app.vault.read(file);
    const suggestion = await this.suggestForFile(file, content, {
      networkLinks: true,
    });

    if (showPreview && !shouldAutoApply(file.path, this.settings)) {
      new PreviewOrganizeModal(this.app, suggestion, async (opts) => {
        await this.applyOne(suggestion, opts);
      }).open();
      return;
    }

    if (suggestion.confidence < this.settings.confidenceThreshold) {
      new PreviewOrganizeModal(this.app, suggestion, async (opts) => {
        await this.applyOne(suggestion, opts);
      }).open();
      return;
    }

    await this.applyOne(suggestion, { folderIndex: 0, rename: false });
  }

  private async applyOne(
    suggestion: OrganizeSuggestion,
    opts: {
      folderIndex: number;
      rename: boolean;
      tagsOnly?: boolean;
      markProcessed?: boolean;
    }
  ): Promise<void> {
    const record = await applySuggestion(suggestion, this.settings, {
      read: (p) => this.app.vault.adapter.read(p),
      write: async (p, c) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) await this.app.vault.modify(f, c);
        else await this.app.vault.adapter.write(p, c);
      },
      ensureFolder: async (folder) => {
        const parts = folder.split("/").filter(Boolean);
        let cur = "";
        for (const part of parts) {
          cur = cur ? `${cur}/${part}` : part;
          if (!this.app.vault.getAbstractFileByPath(cur)) {
            try {
              this.pluginMoving = true;
              await this.app.vault.createFolder(cur);
              this.markGeneratedFolder(cur);
            } catch (err) {
              // Parallel organize tasks often race on the same new folder.
              if (!this.app.vault.getAbstractFileByPath(cur)) throw err;
            } finally {
              this.pluginMoving = false;
            }
          }
        }
      },
      rename: async (from, to) => {
        const file = this.app.vault.getAbstractFileByPath(from);
        if (!(file instanceof TFile)) return from;
        if (from === to) return from;

        const slash = to.lastIndexOf("/");
        const folder = slash >= 0 ? to.slice(0, slash) : "";
        const rawName = slash >= 0 ? to.slice(slash + 1) : to;
        const stem = rawName.replace(/\.md$/i, "");

        this.pluginMoving = true;
        try {
          for (let i = 0; i < 80; i++) {
            const dest =
              i === 0
                ? to
                : folder
                  ? `${folder}/${stem} ${i + 1}.md`
                  : `${stem} ${i + 1}.md`;
            if (dest === from) return from;
            if (this.app.vault.getAbstractFileByPath(dest)) continue;
            try {
              await this.app.fileManager.renameFile(file, dest);
              return dest;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (/already exists/i.test(msg)) continue;
              throw err;
            }
          }
          throw new Error(`Could not find a free path for ${to}`);
        } finally {
          this.pluginMoving = false;
        }
      },
      getTagsFromCache: (p) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        return f instanceof TFile ? this.collectTags(f) : [];
      },
      pathExists: (p) => !!this.app.vault.getAbstractFileByPath(p),
    }, opts);
    if (record.fromPath !== record.toPath) {
      this.migrateIndexPath(record.fromPath, record.toPath);
    }
    this.undo.push(record);
    this.setStatus(
      opts.tagsOnly
        ? `Vault Organizer: tagged → ${record.toPath}`
        : `Vault Organizer: applied → ${record.toPath}`
    );
  }

  async organizeMany(files: TFile[], autoApply: boolean): Promise<void> {
    await this.runExclusive("organize", async () => {
      if (!(await this.ensureIndex()) || !this.embed || !this.index) return;
      await this.runOrganizeMany(files, autoApply);
    });
  }

  private async runOrganizeMany(
    files: TFile[],
    autoApply: boolean,
    opts: { ignoreProcessed?: boolean; networkLinks?: boolean } = {}
  ): Promise<void> {
    if (!this.embed || !this.index) return;
    let done = 0;
    const total = files.length;
    const review: OrganizeSuggestion[] = [];

    const progress = new ProgressModal(this.app, "Organizing vault", () => {
      this.requestCancel("progress-modal");
    });
    this.activeProgress = progress;
    progress.open();
    progress.update({
      phase: autoApply ? "Organizing (auto-apply)…" : "Organizing (review mode)…",
      done: 0,
      total,
      detail: `${total} notes`,
    });
    this.setStatus(`Vault Organizer: organize 0/${total}`, true);
    new Notice(`Vault Organizer: organizing ${total} notes…`, 5000);

    const report = (filePath: string) => {
      progress.update({
        phase: autoApply ? "Organizing (auto-apply)…" : "Organizing (review mode)…",
        done,
        total,
        detail: filePath,
      });
      this.setStatus(`Vault Organizer: organize ${done}/${total}`, true);
    };

    let applied = 0;
    let lowConfidence = 0;
    let applyErrors = 0;
    // Serial moves avoid parallel rename races on the same destination name.
    const moveQueue = new ConcurrentQueue(1);
    await Promise.all(
      files.map((file) =>
        moveQueue.add(async () => {
          if (this.jobCancel) return;
          try {
            const content = await this.app.vault.cachedRead(file);
            if (
              shouldSkipAutoOrganize(
                content,
                this.settings.processedFrontmatterKey,
                { ignoreProcessed: opts.ignoreProcessed }
              )
            ) {
              done++;
              report(file.path);
              return;
            }
            const suggestion = await this.suggestForFile(file, content, {
              networkLinks: opts.networkLinks === true,
            });
            // Never re-apply into another URL-junk folder.
            if (suggestion.folders[0] && isJunkTopicFolder(suggestion.folders[0].folder)) {
              const next = suggestion.folders.find((f) => !isJunkTopicFolder(f.folder));
              if (next) {
                suggestion.folders = [next, ...suggestion.folders.filter((f) => f !== next)];
              }
            }
            if (this.jobCancel) return;
            if (autoApply && suggestion.folders.length > 0) {
              if (suggestion.confidence < this.settings.confidenceThreshold) {
                lowConfidence++;
              }
              await this.applyOne(suggestion, { folderIndex: 0, rename: false });
              applied++;
            } else if (!autoApply) {
              review.push(suggestion);
            }
          } catch (err) {
            applyErrors++;
            const msg = err instanceof Error ? err.message : String(err);
            this.appendLogcat("warn", `organize skip ${file.path}: ${msg}`);
          }
          done++;
          report(file.path);
        })
      )
    );

    if (this.jobCancel || progress.wasCancelled) {
      progress.finish(`Cancelled at ${done}/${total}`);
      this.setStatus(`Vault Organizer: cancelled (${done}/${total})`);
      new Notice(`Vault Organizer: cancelled after ${done}/${total}`);
      throw new JobCancelledError();
    } else if (autoApply) {
      progress.finish(`Moved ${applied} notes`);
      this.setStatus(`Vault Organizer: moved ${applied}/${total}`);
      new Notice(
        `Vault Organizer: moved ${applied} note(s)${
          lowConfidence ? ` (${lowConfidence} below confidence threshold)` : ""
        }${applyErrors ? ` · ${applyErrors} skipped` : ""}`,
        10000
      );
    } else if (review.length > 0) {
      progress.finish(`Done — ${review.length} need review`);
      this.setStatus(`Vault Organizer: ${done}/${total} · ${review.length} review`);
      new Notice(
        `Vault Organizer: ${review.length} note(s) scored for review — run "Organize uncategorized notes (auto-apply / move files)" to file them`,
        12000
      );
    } else {
      progress.finish(`Finished ${done} notes`);
      this.setStatus(`Vault Organizer: finished ${done} notes`);
      new Notice(`Vault Organizer: finished ${done} notes`, 6000);
    }
    this.writeAutomationLog("organize-finished", {
      done,
      total,
      review: review.length,
      applied,
      lowConfidence,
      applyErrors,
      autoApply,
      cancelled: this.jobCancel,
    });
    this.activeProgress = null;
  }

  private timers = new Map<string, number>();

  private scheduleInbox(file: TFile): void {
    // Never stack inbox work on top of a bulk ONNX/organize job.
    if (this.busy) return;
    // Ignore vault inventory `create` storms until an index exists.
    if (!this.index) return;
    // Only auto-watch the Inbox folder — never vault-root notes.
    // Obsidian emits `create` for existing root notes on plugin load; watching
    // them used to kick off a full-vault ONNX rebuild and freeze the app.
    if (!shouldWatchPath(file.path, this.settings)) return;
    if (isExcluded(file.path, this.settings)) return;
    const prev = this.timers.get(file.path);
    if (prev) window.clearTimeout(prev);
    const handle = window.setTimeout(() => {
      this.timers.delete(file.path);
      if (this.busy || !this.index) return;
      void this.handleInboxFile(file);
    }, this.settings.settleDelayMs);
    this.timers.set(file.path, handle);
  }

  private async handleInboxFile(file: TFile): Promise<void> {
    // Never kick off a full-vault ONNX rebuild from a single create/rename event.
    // Obsidian emits `create` for existing notes when the plugin loads — with
    // organizeRootNotes that previously started a 30+ minute freeze on every launch.
    if (!this.embed || !this.index) {
      if (!this.loggedSkipInboxNoIndex) {
        this.loggedSkipInboxNoIndex = true;
        this.appendLogcat(
          "warn",
          "skip inbox organize until index exists (rebuild index or run organize once)"
        );
      }
      return;
    }
    if (this.busy) {
      this.appendLogcat("warn", `skip inbox organize (busy ${this.busyLabel}): ${file.path}`);
      return;
    }
    const content = await this.app.vault.read(file);
    if (
      shouldSkipAutoOrganize(content, this.settings.processedFrontmatterKey)
    ) {
      return;
    }
    const suggestion = await this.suggestForFile(file, content, {
      networkLinks: true,
    });
    if (shouldAutoApply(file.path, this.settings)) {
      if (suggestion.confidence >= this.settings.confidenceThreshold) {
        await this.applyOne(suggestion, { folderIndex: 0, rename: false });
      } else {
        new PreviewOrganizeModal(this.app, suggestion, async (opts) => {
          await this.applyOne(suggestion, opts);
        }).open();
      }
    } else {
      new Notice(`Vault Organizer: Inbox suggestion ready for ${file.name}`);
    }
  }

  private automationTimer: number | null = null;

  private pluginRootAbs(): string {
    const base = (this.app.vault.adapter as { basePath?: string }).basePath;
    if (base) {
      return path.join(base, ".obsidian", "plugins", this.manifest.id);
    }
    return path.dirname(path.dirname(this.pluginModelsRoot()));
  }

  private scheduleAutomationPoll(): void {
    // Prove the poller is alive even before any request arrives.
    this.writeAutomationLog("poller-started");
    const tick = async () => {
      try {
        const root = this.pluginRootAbs();
        const cancelPath = path.join(root, "cancel-request.json");
        if (fs.existsSync(cancelPath)) {
          try {
            fs.unlinkSync(cancelPath);
          } catch {
            /* ignore */
          }
          this.requestCancel("cancel-request.json");
        }

        const reqPath = path.join(root, "run-request.json");
        if (!fs.existsSync(reqPath)) return;
        if (this.automationRunning || this.busy) {
          this.appendLogcat("warn", "run-request deferred — job already running");
          return;
        }
        this.automationRunning = true;
        try {
          const raw = fs.readFileSync(reqPath, "utf8");
          fs.unlinkSync(reqPath);
          const req = JSON.parse(raw || "{}") as {
            actions?: string[];
          };
          // Default: single organize pass (rebuilds once inside). Never chain two rebuilds.
          const actions = req.actions?.length
            ? req.actions
            : ["organize-uncategorized"];
          this.writeAutomationLog("request-accepted", { actions });
          const rebuiltInChain = actions.includes("rebuild-index");
          for (const action of actions) {
            if (this.jobCancel) break;
            if (action === "rebuild-index") await this.rebuildIndex(true);
            else if (action === "organize-vault") {
              await this.organizeMany(this.listMarkdownFiles(), false);
            } else if (action === "organize-uncategorized") {
              await this.organizeUncategorized(false, {
                skipRebuild: rebuiltInChain,
              });
            } else if (action === "organize-uncategorized-apply") {
              await this.organizeUncategorized(true, {
                skipRebuild: rebuiltInChain,
              });
            } else if (action === "reorganize-junk-folders") {
              await this.reorganizeJunkFolders(true);
            } else if (action === "retag-vault") {
              await this.retagVault();
            } else if (action === "recategorize-vault") {
              await this.recategorizeVault();
            } else if (action === "consolidate-themes") {
              await this.consolidateIntoThemes();
            } else if (action === "reload-embedder") {
              await this.reloadEmbedder();
            } else if (action === "cancel") {
              this.requestCancel("run-request");
            }
          }
          this.writeAutomationLog(
            this.jobCancel ? "request-cancelled" : "request-complete",
            { actions }
          );
        } finally {
          this.automationRunning = false;
        }
      } catch (err) {
        this.automationRunning = false;
        this.writeAutomationLog("request-error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    this.automationTimer = window.setInterval(() => void tick(), 2000);
    this.register(() => {
      if (this.automationTimer != null) window.clearInterval(this.automationTimer);
    });
  }

  private async undoLast(): Promise<void> {
    const record = this.undo.pop();
    if (!record) {
      new Notice("Nothing to undo");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(record.toPath);
    if (file instanceof TFile && record.fromPath !== record.toPath) {
      await this.app.fileManager.renameFile(file, record.fromPath);
    }
    new Notice(`Undid move to ${record.toPath}`);
  }
}

// Satisfy unused import lint for PluginManifest in some TS configs
export type { App, PluginManifest, TFolder };
