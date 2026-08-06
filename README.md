# Vault Organizer

Offline Obsidian plugin that **auto-tags, categorizes, and folders** notes using a baked-in FOSS embedding sorter (**Snowflake arctic-embed-m**, Apache-2.0).

No Ollama. No API keys. No cloud LLM. No Hugging Face downloads at runtime. **Desktop only** (local ONNX + Node filesystem).

## Install (recommended — full offline)

1. Download `vault-organizer-full-*.zip` from [Releases](https://github.com/edwardlthompson/vault-organizer/releases).
2. Unzip into `{vault}/.obsidian/plugins/vault-organizer/` (folder name must match plugin id).
3. In Obsidian: **Settings → Community plugins → Turn on community plugins** (disable Restricted mode).
4. Stay on that screen — open the **Installed plugins** section (do **not** use Browse until the plugin is in the public directory).
5. Enable **Vault Organizer**.

Or from this repo:

```powershell
pwsh scripts/vendor-model.ps1          # once — vendors ~105 MB ONNX into plugin/models/
# Dev vault (default):
pwsh scripts/deploy-to-vault.ps1
# Or your current vault:
pwsh scripts/deploy-to-vault.ps1 -VaultPath "$env:USERPROFILE\Documents\My Notes"
```

Then reload Obsidian (Ctrl+R) and enable it under **Installed plugins**.

## Community directory / BRAT caveat

Obsidian only installs `main.js`, `manifest.json`, and `styles.css`. Model weights are **not** included. After a slim install, manually extract `vault-organizer-models-only-*.zip` into the plugin folder. The plugin never auto-downloads models ([developer policy](https://docs.obsidian.md/Developer+policies)).

See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) and [docs/PRIVACY.md](docs/PRIVACY.md).

## Usage

Command palette:

- **Organize current note** — preview folder/tags/title → Apply / Skip
- **Rebuild vault embedding index** — incremental ONNX cache (`index-cache.json`)
- **Organize entire vault** / **Organize uncategorized notes** (review or auto-apply)
- **Consolidate vault into themes** — map free-form folders into a small builtin theme set (editable `_VaultOrganizer/themes.json`)
- **Scan vault for dead links** — tags notes with `#has-dead-links` + frontmatter list
- **Process Inbox** / **Undo last organize action** / **Cancel current job**

Settings: Inbox path, apply mode (suggest / auto-inbox / auto-all), batch size, confidence threshold.

### Manual pin

If you move a note yourself (outside plugin applies), Vault Organizer marks it with `vault-organizer: manual` and `#manual-sort` and will not auto-reorganize it.

### Generated vs your folders

Empty folders the plugin created may be pruned. Folders you created are left alone.

## Develop

```powershell
cd plugin
npm install
npm test
npm run build
pwsh ../scripts/deploy-to-vault.ps1
```

## Model pin & leapfrog CI

Pinned pack: `models/MANIFEST.json` → `arctic-embed-m`. Weekly workflow refreshes `models/LEADERBOARD.md` and opens an issue if another FOSS model leapfrogs the pin.

## License

- Plugin code: MIT
- Default model weights: Apache-2.0 (Snowflake arctic-embed-m) — see `THIRD_PARTY_LICENSES.md`

Inspired by patterns in [Note Companion](https://github.com/nexus-jpf/note-companion) (MIT); this is a rewrite, not a fork.
