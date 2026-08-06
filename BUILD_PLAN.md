# Build Plan — Vault Organizer

> Owner labels: `AGENT` / `HUMAN` / `ADB` / `AUTO`. Status: 🔲 open · ✅ done · ❌ blocked
>
> **Review sprint — 2026-08-05 audit** archived in COMPLETED_TASKS.md @ `828f776`.

## Sprint 0 — Bootstrap & scaffold

### Sequential

| Status | Task |
|--------|------|
| 🔲 | _(playbook template — product bootstrap archived)_ |

### Parallel

| Task | Owner | Scope |
|------|-------|-------|
| Core sorter modules + Vitest | AGENT | `plugin/**` |
| vendor/package/leaderboard scripts | AGENT | `scripts/**` |

## Sprint 4 — Ship (open HUMAN)

### Sequential

| Status | Task |
|--------|------|
| ✅ | [AGENT] Publish GitHub Release `0.1.0` with slim + full + models zips |
| 🔲 | [HUMAN] Submit plugin at [community.obsidian.md](https://community.obsidian.md) |
| 🔲 | [HUMAN] Enable Actions setting: allow GITHUB_TOKEN to create/approve PRs (Release Please) |

### Parallel

<!-- parallel_exception: remaining ship work is HUMAN-only -->

| Task | Owner | Scope |
|------|-------|-------|
| Community plugin submission | HUMAN | `manifest.json` |
| Enable Release Please PR permission | HUMAN | `.github/workflows/release-please.yml` |

## Model leaderboard

| Status | Task |
|--------|------|
| ✅ | [AUTO] Weekly score job + leapfrog issues |
| 🔲 | [HUMAN] Approve any pin change in MANIFEST.json |

## Archived Sprints

| Sprint | Complete | Notes |
|--------|----------|-------|
| Review 2026-08-05 | 2026-08-05 | COMPLETED_TASKS.md @ `828f776` |
| Sprints 0–3 product build | 2026-08-05 | Features shipped; HUMAN release/listing remain |
