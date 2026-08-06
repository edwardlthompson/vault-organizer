# Privacy

Vault Organizer is local-first.

## What stays on your device

- Note contents are read and embedded **on your machine** using the vendored ONNX model.
- Suggestions (folders, tags, titles) are computed locally.
- No telemetry, analytics, or crash-reporting SDKs.

## Network

- **Default / full-zip install:** No network required for sorting after install.
- The plugin does **not** download models from Hugging Face or call cloud LLM APIs.
- The plugin does **not** auto-install or auto-update model dependencies (Obsidian Community directory policy).

## Third-party model weights

- Default model: Snowflake arctic-embed-m (Apache-2.0). See `THIRD_PARTY_LICENSES.md` and `models/MANIFEST.json`.

## Obsidian Sync

- Model files (~105 MB) exceed Sync Standard per-file limits. Install the model pack once per device.
