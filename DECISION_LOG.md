# Decision Log

## ADR-001: Embedder-only sorter (no Ollama / no chat LLM)

- **Date:** 2026-08-05
- **Status:** Accepted
- **Context:** Users want offline, one-click note filing without BYOK or Ollama.
- **Decision:** Use a FOSS ONNX embedding model via Transformers.js for folder/tag similarity and clustering. No generative chat path in MVP.
- **Consequences:** Excellent at assign-to-structure; weak at creative rename/format. Optional larger model packs later.

## ADR-002: Default model Snowflake arctic-embed-m

- **Date:** 2026-08-05
- **Status:** Accepted
- **Context:** Accuracy prioritized over tiny size; marketplace cannot inline 100MB into `main.js`.
- **Decision:** Vendor `Snowflake/snowflake-arctic-embed-m` quantized ONNX (~105 MB) in full Release zip. Optional s/l packs later.
- **Consequences:** Full zip required for AI; Community directory install needs manual model pack.

## ADR-003: Dual distribution (full zip vs marketplace)

- **Date:** 2026-08-05
- **Status:** Accepted
- **Context:** Obsidian Community installer only fetches `main.js` / `manifest.json` / `styles.css`; policies forbid self-installing dependencies.
- **Decision:** Primary channel is `vault-organizer-full.zip`. Marketplace listing (later) ships slim JS; README requires manual model pack placement; plugin never auto-fetches models.
- **Consequences:** Sync Standard will not carry model files; per-device model install.

## ADR-004: Note Companion inspiration, not fork

- **Date:** 2026-08-05
- **Status:** Accepted
- **Context:** Note Companion (MIT) has strong inbox/organizer UX but cloud-coupled AI.
- **Decision:** Rewrite; lift queue/suggestion shapes under MIT attribution; no monorepo fork.
- **Consequences:** Own surface; credit in THIRD_PARTY_LICENSES.md.

## ADR-005: Continuous model leaderboard

- **Date:** 2026-08-05
- **Status:** Accepted
- **Decision:** Weekly CI scores FOSS embedder candidates; human-approved pin changes only.
- **Consequences:** `models/LEADERBOARD.md` + issues when leapfrog detected.
