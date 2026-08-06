import { App, Modal, Setting, Notice } from "obsidian";
import type { OrganizeSuggestion } from "./types";
import { formatClock } from "./job";

export { formatClock } from "./job";

export class PreviewOrganizeModal extends Modal {
  private chosenFolder = 0;
  private rename = false;

  constructor(
    app: App,
    private suggestion: OrganizeSuggestion,
    private onApply: (opts: { folderIndex: number; rename: boolean }) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-organizer-preview");
    contentEl.createEl("h2", { text: "Organize note" });
    contentEl.createEl("p", { text: this.suggestion.summary || this.suggestion.path });
    contentEl.createEl("p", {
      text: `Confidence: ${(this.suggestion.confidence * 100).toFixed(0)}%`,
      cls: "vo-score",
    });

    contentEl.createEl("h3", { text: "Folder" });
    this.suggestion.folders.forEach((f, i) => {
      new Setting(contentEl)
        .setName(f.folder)
        .setDesc(`${f.reason} · score ${(f.score * 100).toFixed(0)}%${f.isNewFolder ? " · new" : ""}`)
        .addButton((btn) =>
          btn.setButtonText(i === this.chosenFolder ? "Selected" : "Select").onClick(() => {
            this.chosenFolder = i;
            this.onOpen();
          })
        );
    });

    contentEl.createEl("h3", { text: "Tags" });
    const tagLine =
      this.suggestion.tags.map((t) => t.tag).join(" ") || "(none)";
    contentEl.createEl("p", { text: tagLine });

    if (this.suggestion.deadLinks?.length) {
      contentEl.createEl("h3", { text: "Dead links" });
      contentEl.createEl("p", {
        text: this.suggestion.deadLinks.join("\n"),
        cls: "vo-dead-links",
      });
    }

    if (this.suggestion.titles[0]) {
      new Setting(contentEl)
        .setName("Rename to suggested title")
        .setDesc(this.suggestion.titles[0].title)
        .addToggle((t) =>
          t.setValue(this.rename).onChange((v) => {
            this.rename = v;
          })
        );
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Skip").onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText("Apply")
          .setCta()
          .onClick(async () => {
            await this.onApply({ folderIndex: this.chosenFolder, rename: this.rename });
            new Notice("Vault Organizer: applied");
            this.close();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class RepairModelModal extends Modal {
  constructor(
    app: App,
    private modelDir: string,
    private message: string
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-organizer-repair");
    contentEl.createEl("h2", { text: "Model pack required" });
    contentEl.createEl("p", { text: this.message });
    contentEl.createEl("p", {
      text: "Community Plugin installs do not include model weights. Use the full Release zip or copy the model pack manually.",
    });
    contentEl.createEl("p", { text: "Expected folder:" });
    contentEl.createEl("code", { text: this.modelDir });
    contentEl.createEl("p", {
      text: "See docs/DISTRIBUTION.md in the project repository.",
    });
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Close").setCta().onClick(() => this.close())
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export interface ProgressUpdate {
  phase: string;
  done: number;
  total: number;
  detail?: string;
}

/** Non-dismissible progress UI for long indexing / organize jobs. */
export class ProgressModal extends Modal {
  private phaseEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private barFill: HTMLElement | null = null;
  private etaEl: HTMLElement | null = null;
  private startedAt = Date.now();
  private cancelled = false;
  private lastUi = 0;

  constructor(
    app: App,
    private jobTitle: string,
    private onCancel?: () => void
  ) {
    super(app);
  }

  get wasCancelled(): boolean {
    return this.cancelled;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-organizer-progress");
    contentEl.createEl("h2", { text: this.jobTitle });
    this.phaseEl = contentEl.createEl("p", {
      text: "Starting…",
      cls: "vo-progress-phase",
    });
    this.detailEl = contentEl.createEl("p", {
      text: "",
      cls: "vo-progress-detail",
    });
    const track = contentEl.createDiv({ cls: "vo-progress-track" });
    this.barFill = track.createDiv({ cls: "vo-progress-fill" });
    this.countEl = contentEl.createEl("p", {
      text: "0 / 0 (0%)",
      cls: "vo-progress-count",
    });
    this.etaEl = contentEl.createEl("p", {
      text: "Elapsed 0:00",
      cls: "vo-progress-eta",
    });
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Cancel").onClick(() => {
        this.cancelled = true;
        this.onCancel?.();
        this.phaseEl?.setText("Cancelling…");
      })
    );
    this.modalEl.addClass("vo-progress-modal");
  }

  update(u: ProgressUpdate): void {
    const now = Date.now();
    const isEdge = u.done <= 1 || u.done >= u.total;
    if (!isEdge && now - this.lastUi < 80) return;
    this.lastUi = now;

    const total = Math.max(0, u.total);
    const done = Math.min(Math.max(0, u.done), total || u.done);
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    this.phaseEl?.setText(u.phase);
    if (u.detail !== undefined) this.detailEl?.setText(u.detail);
    this.countEl?.setText(`${done} / ${total} (${pct}%)`);
    if (this.barFill) this.barFill.style.width = `${pct}%`;

    const elapsedSec = Math.max(0, (now - this.startedAt) / 1000);
    let eta = `Elapsed ${formatClock(elapsedSec)}`;
    if (done > 0 && total > done) {
      const rate = done / Math.max(elapsedSec, 0.001);
      const remain = (total - done) / Math.max(rate, 0.01);
      eta += ` · ~${formatClock(remain)} left`;
    }
    this.etaEl?.setText(eta);
  }

  finish(message: string): void {
    this.phaseEl?.setText(message);
    this.detailEl?.setText("");
    if (this.barFill) this.barFill.style.width = "100%";
    window.setTimeout(() => this.close(), 900);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
