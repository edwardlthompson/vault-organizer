# Agent Memory

> Centralized index of tech stack, threat models, persistent context, and retrospectives.

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Platform | Obsidian plugin (TypeScript) | 0.1.0 | Desktop-only (`isDesktopOnly: true`; Node fs + ONNX) |
| Sorter | Snowflake arctic-embed-m ONNX via Transformers.js | Apache-2.0 | Vendored in full Release zip |
| Build | esbuild + Vitest | - | `plugin/` |
| License | MIT (code) + Apache-2.0 (model weights) | - | See THIRD_PARTY_LICENSES.md |
| Distribution | GitHub Releases full zip (primary) | - | Community directory optional slim |

## Active Modules

- ✅ Node / TypeScript tooling (`modules/node/MODULE.md`) — Obsidian plugin under `plugin/`
- Deliverable: `plugin/` (not the Hono `examples/node` stub)

## Threat Model Checklist

- ✅ Local-only inference; no runtime HF/Ollama downloads
- ✅ No telemetry
- ✅ Secrets excluded from VCS
- ✅ Model weights gitignored (`*.onnx`); vendored via script/Release
- ✅ Community policy: no self-installing dependencies

## Persistent Context

### Project Purpose

Vault Organizer — offline Obsidian plugin that auto-tags, categorizes, and folders notes using a baked-in FOSS embedding sorter.

### Key Constraints

- Marketplace installs only `main.js` / `manifest.json` / `styles.css`
- Keep `main.js` under ~5 MB Sync soft limit
- Pin model changes are human-approved (weekly leaderboard CI)

### Open [HUMAN] items

- Create/push GitHub repo `edwardlthompson/vault-organizer`
- Enable Dependabot alerts
- Publish first Release with full zip
