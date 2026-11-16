# News Inbox

Auto-collected inbox of news, upstream updates, security fixes, and ideas relevant to this repo, appended daily by News Bot.
A Cursor planning agent should review these items and fold the useful ones into BUILD_PLAN; entries are append-only, newest at the bottom.


## 2026-11-13

**News and updates**

- Obsidian 1.15.1: relevance sort, accent-insensitive search, faster search on large vaults. [source](https://obsidian.md/changelog/2026-11-12-desktop-v1.15.1/)

**Tasks for the planning agent**

- [ ] Verify plugin on Obsidian 1.15.1 and compare with native relevance search — Ensures compatibility and sets a baseline for embedding-based suggestions. Label: `[AGENT]` · Priority: P3 · https://obsidian.md/changelog/2026-11-12-desktop-v1.15.1/

## 2026-11-14

**News and updates**

- wfx-loot campaign pushed a CI secret stealer into 17,000+ public repos using stolen GitHub credentials since Nov 10; an npm postinstall hook slipped past GitHub's workflow hold. IOCs: wfx-docs branch, .ci-xxxxxx.sh files, build-audit-*.yml workflows. [source](https://blog.gitguardian.com/wfx-loot-a-ci-secret-stealer-pushed-with-stolen-github-credentials/)
- ONNX Runtime 1.32.0: ONNX 1.23.2 / opset 28, much faster session start on large graphs, WebGPU Plugin EP v0.6.0. [source](https://github.com/microsoft/onnxruntime/releases/tag/v1.32.0)

**Tasks for the planning agent**

- [x] Audit the repo for wfx-loot IOCs — Checks for the wfx-docs branch/PR, .ci-*.sh files, build-audit-*.yml workflows and new npm lifecycle hooks, since the campaign steals CI secrets and Cursor credentials. Label: `[AGENT]` · Priority: P1 · https://blog.gitguardian.com/wfx-loot-a-ci-secret-stealer-pushed-with-stolen-github-credentials/ (synced to BUILD_PLAN)
- [ ] Plan the transformers.js 3.x to 4.x bump to pick up ONNX Runtime 1.32 — The plugin is a major behind; faster session start helps embedding indexing. Label: `[AGENT]` · Priority: P3 · https://github.com/microsoft/onnxruntime/releases/tag/v1.32.0

## 2026-11-16

**News and updates**

- Obsidian Skills 1.1.0 (now obsidianmd/obsidian-skills) ships 7 agent skills as one plugin for Claude Code, Codex and Cursor, including obsidian-cli for plugin development against a running desktop app. [source](https://news.sulat.com/2026/11/15/obsidian-skills/) · [release](https://github.com/obsidianmd/obsidian-skills/releases/tag/1.1.0)
- Correction after review: the 1.1.0 release has 6 skills; the 7th (obsidian-headless) is on main as 1.2.0, unreleased. Adopt obsidian-cli and obsidian-markdown for dev agents only; skip headless, defuddle, knap and json-canvas. [commit](https://github.com/obsidianmd/obsidian-skills/commit/398127736bd4ba42d767b1419fee1a927508370b)

**Tasks for the planning agent**

- [x] Add the Obsidian Skills Cursor plugin (obsidian-cli + obsidian-markdown) to the agent setup — Lets agents reload and test the plugin against a dev vault through the Obsidian CLI. Label: `[AGENT]` · Priority: P3 · https://github.com/obsidianmd/obsidian-skills/releases/tag/1.1.0 (superseded by the P2 tasks below)
- [x] Install the official Obsidian Skills pack from the Cursor Marketplace and document the reload loop in AGENTS.md — User-level install, not vendored. Label: `[AGENT]` · Priority: P2 · https://github.com/obsidianmd/obsidian-skills/releases/tag/1.1.0 (synced to BUILD_PLAN)
- [x] Add an agent convention so skills don't clobber plugin frontmatter or bypass link-safe moves — Preserve plugin properties and tags; use Obsidian move/rename. Label: `[AGENT]` · Priority: P2 · https://github.com/edwardlthompson/vault-organizer/blob/main/plugin/src/apply.ts (synced to BUILD_PLAN)
