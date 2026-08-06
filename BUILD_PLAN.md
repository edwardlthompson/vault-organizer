# Build Plan — Vault Organizer

> Owner labels: `AGENT` / `HUMAN` / `ADB` / `AUTO`. Status: 🔲 open · ✅ done · ❌ blocked

## Review sprint — 2026-08-05 audit

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] Index plugin-ci + model-leaderboard workflows in TEMPLATE_INDEX.json (F-003) |
| ✅ | [AGENT] Fix BUILD_PLAN Parallel structure for Sprints 0–4 (F-003) |
| ✅ | [AGENT] Set `isDesktopOnly: true` + root `manifest.json`/`versions.json` for marketplace (F-001) |
| ✅ | [AGENT] Update README for themes, manual pin, dead links, marketplace caveats (F-004) |
| 🔲 | [AGENT] Create GitHub repo + initial commit/push for ship (F-002) |
| 🔲 | [HUMAN] Publish GitHub Release `0.1.0` with slim assets + full/models zips |
| 🔲 | [HUMAN] Submit plugin at community.obsidian.md after release |

### Parallel

| Task | Owner | Scope |
|------|-------|-------|
| Index missing workflows | AGENT | `TEMPLATE_INDEX.json` |
| Board + docs + desktop-only manifest | AGENT | `BUILD_PLAN.md` |

## Sprint 0 — Bootstrap & scaffold

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] Bootstrap from agent-project-bootstrap (node stack, FOSS) |
| ✅ | [AGENT] DECISION_LOG / PRIVACY / DISTRIBUTION docs |
| ✅ | [AGENT] Scaffold `plugin/` Obsidian TypeScript project |
| ✅ | [AGENT] Deploy script + fixture vault path |
| 🔲 | [HUMAN] Create GitHub repo `edwardlthompson/vault-organizer`, push, Dependabot alerts |

### Parallel

| Task | Owner | Scope |
|------|-------|-------|
| Core sorter modules + Vitest | AGENT | `plugin/**` |
| vendor/package/leaderboard scripts | AGENT | `scripts/**` |

## Sprint 1 — Sorter + UI

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] Transformers.js local embedder + hash fallback |
| ✅ | [AGENT] Preview modal, repair modal, settings tab |
| ✅ | [AGENT] Apply tags/folders + undo stack |

### Parallel

<!-- parallel_exception: completed historical sprint; work was sequential-only UI wiring -->

| Task | Owner | Scope |
|------|-------|-------|
| Local embedder + sorter | AGENT | `plugin/src/embedder.ts` |
| Preview/repair UI + settings | AGENT | `plugin/src/settings-tab.ts` |

## Sprint 2 — Bulk & Inbox

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] Vault index + bulk organize + concurrency queue |
| ✅ | [AGENT] Inbox watchers with settle delay |

### Parallel

<!-- parallel_exception: completed historical sprint; bulk + inbox were sequential -->

| Task | Owner | Scope |
|------|-------|-------|
| Vault index + bulk organize | AGENT | `plugin/src/index-cache.ts` |
| Inbox watchers | AGENT | `plugin/src/main.ts` |

## Sprint 3 — Automation polish

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] Auto-apply modes + processed frontmatter skip |
| ✅ | [AGENT] Status bar progress |

### Parallel

<!-- parallel_exception: completed historical sprint; polish was sequential -->

| Task | Owner | Scope |
|------|-------|-------|
| Auto-apply + processed skip | AGENT | `plugin/src/apply.ts` |
| Status bar progress | AGENT | `plugin/src/main.ts` |

## Sprint 4 — Ship

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] package-release.ps1 (slim + full + models-only) |
| ✅ | [AGENT] model-leaderboard workflow |
| 🔲 | [HUMAN] Publish GitHub Release with full zip |
| 🔲 | [HUMAN] Optional Community Plugin submission (slim + manual model pack docs) |

### Parallel

<!-- parallel_exception: packaging + CI were sequential ship tasks -->

| Task | Owner | Scope |
|------|-------|-------|
| Slim/full/models release packaging | AGENT | `scripts/package-release.ps1` |
| Weekly model leaderboard workflow | AGENT | `.github/workflows/model-leaderboard.yml` |

## Model leaderboard

| Status | Task |
|--------|------|
| ✅ | [AUTO] Weekly score job + leapfrog issues |
| 🔲 | [HUMAN] Approve any pin change in MANIFEST.json |

## Archived Sprints

| Sprint | Complete | Notes |
|--------|----------|-------|
| — | — | Active product sprints 0–4 remain on board until HUMAN ship items clear |
