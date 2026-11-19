# Build Plan — Vault Organizer

<!-- remaining-tally -->
**Remaining:** (tally on next sync)
<!-- /remaining-tally -->


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

## Child Repo Playbook

### Sprint News — News Bot follow-ups

<!-- parallel_exception: independent news follow-ups; run sequentially -->

1. 🔲 [AGENT] Audit the repo for wfx-loot IOCs — scope: .github/ (news P1, 2026-11-14) https://blog.gitguardian.com/wfx-loot-a-ci-secret-stealer-pushed-with-stolen-github-credentials/
2. 🔲 [AGENT] Install the official Obsidian Skills pack from the Cursor Marketplace (user-level, not vendored into `.cursor/skills/`) and document the dev reload loop: run `scripts/deploy-to-vault.ps1`, then `obsidian plugin:reload id=vault-organizer`, then check `dev:errors` / `dev:console` / `dev:screenshot` — scope: AGENTS.md, docs/CURSOR_INTEGRATIONS.md (news P2, 2026-11-16) https://github.com/obsidianmd/obsidian-skills/releases/tag/1.1.0
3. 🔲 [AGENT] Add an agent convention so Obsidian skills never clobber plugin frontmatter or bypass link-safe moves: preserve `vault-organizer`, `vault-organizer-dead-links`, `#manual-sort`, `#has-dead-links`; move/rename via `obsidian move`/`rename` or the plugin apply path, never filesystem `mv`; note headless, defuddle, knap and json-canvas as out of scope — scope: AGENTS.md or .cursor/rules/ (news P2, 2026-11-16) https://github.com/edwardlthompson/vault-organizer/blob/main/plugin/src/apply.ts


## Archived Sprints

| Sprint | Complete | Notes |
|--------|----------|-------|
| Review 2026-08-05 | 2026-08-05 | COMPLETED_TASKS.md @ `828f776` |
| Sprints 0–3 product build | 2026-08-05 | Features shipped; HUMAN release/listing remain |
### Local agent (This Computer)

Standing queue for This Computer. Rows: `🔲 [AGENT][LOCAL] … — scope: path`.

<!-- local-agent-lane:begin -->
_No local agent items._
<!-- local-agent-lane:end -->

### Cloud agent (Cursor Cloud)

Standing queue for Cursor Cloud. Rows: `🔲 [AGENT][CLOUD] … — scope: path`.

<!-- cloud-agent-lane:begin -->
_No cloud agent items._
<!-- cloud-agent-lane:end -->

### Open PRs (synced)

> Auto-managed. Do not hand-edit inside the markers.

<!-- open-prs-sync:begin -->
_No open Dependabot or Release Please PRs._
<!-- open-prs-sync:end -->

### Template gaps (synced)

> Auto-managed. Do not hand-edit inside the markers.

<!-- template-gaps-sync:begin -->
_No template gaps._
<!-- template-gaps-sync:end -->

<!-- argus-portfolio-chores:start -->
## Argus portfolio chores

Synced from argus-runner (2026-11-18). Prefer YOLO maintain on the runner; keep these until cleared.

| Status | Venue | Task |
|--------|-------|------|
| 🔲 | `[AUTO][CLOUD]` | Clear open Dependabot alerts |

```text
Repo: edwardlthompson/vault-organizer
Squash-merge green Dependabot PRs.
Gate: Dependabot alert count 0.
```
<!-- argus-portfolio-chores:end -->
