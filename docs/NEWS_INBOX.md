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

- [ ] Audit the repo for wfx-loot IOCs — Checks for the wfx-docs branch/PR, .ci-*.sh files, build-audit-*.yml workflows and new npm lifecycle hooks, since the campaign steals CI secrets and Cursor credentials. Label: `[AGENT]` · Priority: P1 · https://blog.gitguardian.com/wfx-loot-a-ci-secret-stealer-pushed-with-stolen-github-credentials/
- [ ] Plan the transformers.js 3.x to 4.x bump to pick up ONNX Runtime 1.32 — The plugin is a major behind; faster session start helps embedding indexing. Label: `[AGENT]` · Priority: P3 · https://github.com/microsoft/onnxruntime/releases/tag/v1.32.0
