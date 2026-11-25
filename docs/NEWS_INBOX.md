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

## 2026-11-18

Catch-up for Nov 17–18 (the daily brief did not run those mornings).

**News and updates**

- Obsidian Skills 1.2.0 is now released: it adds the Headless skill (Sync/Publish CLI; skip unless you have a paid subscription) and a Gemini CLI install path. The existing P2 to install the Cursor pack and keep plugin markers intact still applies. [source](https://github.com/obsidianmd/obsidian-skills/releases/tag/1.2.0)

**Tasks for the planning agent**

_No new tasks. See the news items above._

## 2026-11-19

**News and updates**

- Microsoft made microsoft/onnxruntime and about 7 related repos private on Nov 17 "while we investigate malicious content", linked in time to the agent-framework PyPI compromise; the repo, tags and release downloads now return 404. PyPI/NuGet 1.32.0 and npm onnxruntime-web 1.31.1 still install, and no malicious code has been reported in them. A read-only check found this repo unaffected today (vendor-ort-wasm.ps1 copies from node_modules; no workflow downloads GitHub release assets). The ORT 1.32 link in the 11-14 entry now 404s; use https://pypi.org/project/onnxruntime/ or https://www.npmjs.com/package/onnxruntime-web instead. [source](https://www.theregister.com/security/2026/11/18/microsofts-official-python-agent-framework-hijacked-to-distribute-malware/5310858) · [impact rundown](https://codingislove.com/onnx-runtime-github-removed/)

**Tasks for the planning agent**

- [x] Freeze ONNX Runtime at the versions in plugin/package-lock.json (`npm ci` only) and hold the transformers.js 3→4 / ORT 1.32 bump until Microsoft clears the repos — an unexplained malicious-content investigation over the ORT source makes new ORT builds untrustworthy for now. Label: `[AGENT]` · Priority: P2 · https://www.theregister.com/security/2026/11/18/microsofts-official-python-agent-framework-hijacked-to-distribute-malware/5310858 (synced to BUILD_PLAN)

## 2026-11-25

**News and updates**

- Obsidian Skills 1.2.1 (Nov 20, after that morning's brief) declared the `skills/` folder in the Cursor manifest so the pack loads in Grok Bot, and 1.2.2 (Nov 25) makes Obsidian an official Claude plugin plus two skill tweaks: Headless now asks before a vault's first sync, and Defuddle treats extracted pages as data, not instructions. The existing Marketplace-install and frontmatter-convention rows on the board still cover the work; this is a version note. [1.2.1](https://github.com/obsidianmd/obsidian-skills/releases/tag/1.2.1) · [1.2.2](https://github.com/obsidianmd/obsidian-skills/releases/tag/1.2.2)
