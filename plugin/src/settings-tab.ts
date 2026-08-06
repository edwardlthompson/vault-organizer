import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultOrganizerPlugin from "./main";
import type { VaultOrganizerSettings } from "./types";

export class VaultOrganizerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: VaultOrganizerPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Vault Organizer" });
    containerEl.createEl("p", {
      text: "Offline embedding sorter. Models ship in the full Release zip — never auto-downloaded.",
    });

    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc("Folder watched for create/rename automation")
      .addText((t) =>
        t.setValue(s.inboxFolder).onChange(async (v) => {
          s.inboxFolder = v.trim() || "Inbox";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Comma-separated vault-relative paths")
      .addText((t) =>
        t.setValue(s.excludedFolders.join(", ")).onChange(async (v) => {
          s.excludedFolders = v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Apply mode")
      .setDesc("Suggest only is safest for bulk work")
      .addDropdown((d) =>
        d
          .addOption("suggest", "Suggest only")
          .addOption("auto-inbox", "Auto-apply Inbox")
          .addOption("auto-all", "Auto-apply everywhere")
          .setValue(s.applyMode)
          .onChange(async (v) => {
            s.applyMode = v as VaultOrganizerSettings["applyMode"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Batch size")
      .setDesc("Auto scales to CPU/WebGPU; or set manually")
      .addDropdown((d) =>
        d
          .addOption("auto", "Auto (device-scaled)")
          .addOption("manual", "Manual")
          .setValue(s.batchMode)
          .onChange(async (v) => {
            s.batchMode = v as VaultOrganizerSettings["batchMode"];
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (s.batchMode === "manual") {
      new Setting(containerEl)
        .setName("Manual batch size")
        .addSlider((sl) =>
          sl
            .setLimits(1, 16, 1)
            .setValue(s.manualBatchSize)
            .setDynamicTooltip()
            .onChange(async (v) => {
              s.manualBatchSize = v;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Confidence threshold")
      .setDesc(
        "Inbox auto-watch only applies above this score. Bulk auto-apply always moves to the best folder."
      )
      .addSlider((sl) =>
        sl
          .setLimits(0.1, 0.9, 0.05)
          .setValue(s.confidenceThreshold)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.confidenceThreshold = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max tags")
      .addSlider((sl) =>
        sl
          .setLimits(1, 15, 1)
          .setValue(s.maxTags)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.maxTags = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Allow new folders")
      .setDesc(
        "With theme catalog on, unknown topics go to Misc (or a Wikipedia-named theme). Off = only existing folders."
      )
      .addToggle((t) =>
        t.setValue(s.allowNewFolders).onChange(async (v) => {
          s.allowNewFolders = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("New-folder threshold")
      .setDesc(
        "Lower = consolidate more into existing folders. New folders only when best match is below this score."
      )
      .addSlider((sl) =>
        sl
          .setLimits(0.15, 0.8, 0.05)
          .setValue(s.newFolderThreshold)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.newFolderThreshold = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Topic folder prefix")
      .setDesc('Optional parent for generative folders (e.g. "Topics"). Leave blank for vault root.')
      .addText((t) =>
        t.setValue(s.topicFolderPrefix).onChange(async (v) => {
          s.topicFolderPrefix = v.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Organize vault-root notes")
      .setDesc(
        'Include notes in the vault base folder in "Organize uncategorized". Does not auto-watch root notes on vault load (that froze Obsidian).'
      )
      .addToggle((t) =>
        t.setValue(s.organizeRootNotes).onChange(async (v) => {
          s.organizeRootNotes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Organize Inbox as uncategorized")
      .setDesc('Include Inbox notes in "Organize uncategorized"')
      .addToggle((t) =>
        t.setValue(s.organizeInboxAsUncategorized).onChange(async (v) => {
          s.organizeInboxAsUncategorized = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Model pack")
      .setDesc("Must match a folder under models/ in the plugin directory")
      .addDropdown((d) =>
        d
          .addOption("arctic-embed-m", "arctic-embed-m (default)")
          .addOption("arctic-embed-s", "arctic-embed-s (low RAM)")
          .addOption("arctic-embed-l", "arctic-embed-l (max)")
          .setValue(s.modelPackId)
          .onChange(async (v) => {
            s.modelPackId = v as VaultOrganizerSettings["modelPackId"];
            await this.plugin.saveSettings();
            await this.plugin.reloadEmbedder();
          })
      );

    new Setting(containerEl)
      .setName("Settle delay (ms)")
      .setDesc("Wait after Inbox create/rename before organizing")
      .addSlider((sl) =>
        sl
          .setLimits(500, 5000, 100)
          .setValue(s.settleDelayMs)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.settleDelayMs = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Use links for context")
      .setDesc(
        "URL path tokens (always) and page titles (when reachable) improve categorization"
      )
      .addToggle((t) =>
        t.setValue(s.useLinkContext).onChange(async (v) => {
          s.useLinkContext = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Check dead links")
      .setDesc(
        "Probe links on single-note organize / dead-link scan (not during bulk recategorize). Results cached in link-cache.json"
      )
      .addToggle((t) =>
        t.setValue(s.checkDeadLinks).onChange(async (v) => {
          s.checkDeadLinks = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Max links per note")
      .setDesc("Cap network probes / path tokens per note")
      .addSlider((sl) =>
        sl
          .setLimits(1, 15, 1)
          .setValue(s.maxLinksPerNote)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.maxLinksPerNote = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Theme catalog")
      .setDesc(
        "Map synonyms to canonical folders (Bitcoin/Crypto → Cryptocurrency). Edit _VaultOrganizer/themes.json to customize."
      )
      .addToggle((t) =>
        t.setValue(s.useThemeCatalog).onChange(async (v) => {
          s.useThemeCatalog = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Online theme naming")
      .setDesc(
        "When a note matches no theme, look up Wikipedia/Wikidata (no API key) and remember the synonym. Manual moves are pinned (vault-organizer: manual + #manual-sort) and never auto-filed. Empty user-created folders are never deleted."
      )
      .addToggle((t) =>
        t.setValue(s.onlineThemeNaming).onChange(async (v) => {
          s.onlineThemeNaming = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
