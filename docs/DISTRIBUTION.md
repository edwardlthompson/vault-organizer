# Distribution

## Full offline package (recommended)

GitHub Release asset `vault-organizer-full.zip` includes:

- `main.js`, `manifest.json`, `styles.css`
- `models/arctic-embed-m/` (vendored ONNX + tokenizer)

Install:

```powershell
pwsh scripts/deploy-to-vault.ps1 -VaultPath "C:\path\to\VaultOrganizer-Dev"
```

Or unzip into `{vault}/.obsidian/plugins/vault-organizer/`.

## Community directory (optional)

Obsidian only installs `main.js`, `manifest.json`, `styles.css` from the GitHub release whose tag matches `manifest.json` `version`.

1. Install the slim plugin from Community Plugins (or BRAT).
2. Manually download `vault-organizer-models-only.zip` from Releases.
3. Extract into `{vault}/.obsidian/plugins/vault-organizer/models/`.
4. Reload the plugin.

The plugin **never** auto-downloads model packs.

### Submit / update listing

1. Keep root `manifest.json` + `versions.json` in sync with `plugin/` (see `scripts/package-release.ps1`).
2. Publish a GitHub Release tagged `x.y.z` with release assets: `main.js`, `manifest.json`, `styles.css` (plus optional full/models zips for README install).
3. Sign in at [community.obsidian.md](https://community.obsidian.md), link GitHub, **Plugins → New plugin**, paste the repo URL.
4. Address automated review feedback; bump version + new release as needed.

Official guide: [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).

## BRAT

BRAT fetches the same three files as Community Plugins. Use the full zip or add the model pack manually for AI features.
