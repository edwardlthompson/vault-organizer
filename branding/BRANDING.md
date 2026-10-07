# Vault Organizer branding

Concept kit for logo review. **No concept is production-final until one is chosen and vectorized.**

## Palette

| Token | Hex       | Role                                      |
|-------|-----------|-------------------------------------------|
| Slate | `#1C2B33` | Primary mark / dark surfaces              |
| Teal  | `#0D9488` | Accent (organize / live action)           |
| Mist  | `#E8EEF0` | Light ground (cool paper, not warm cream) |
| Amber | `#D97706` | Optional offline/local highlight          |

Wordmark (not drawn inside the icon mark): **Vault Organizer** — slate weight with a teal accent on “Organizer”, or a single teal bar under the icon.

## Concepts (pick one)

| # | File | Metaphor | Best for |
|---|------|----------|----------|
| 1 | [concepts/01-sorted-vault.png](concepts/01-sorted-vault.png) | Vault door + note stacks; teal hinges/latch | README hero, “local + secure” story |
| 2 | [concepts/02-cluster-tree.png](concepts/02-cluster-tree.png) | Embedding nodes consolidating into folders | Product explanation, “sorts into structure” |
| 3 | [concepts/03-vo-monogram.png](concepts/03-vo-monogram.png) | Nested folder chevrons forming a VO-like mark | Obsidian ribbon, favicon, small UI |
| 4 | [concepts/04-shelf-lattice.png](concepts/04-shelf-lattice.png) | Shelf/grid into aligned columns; amber tip | Knowledge-management / library feel |

Current plugin ribbon still uses Lucide `folder-tree` until a winner is wired via `addIcon`.

## Usage rules

**Do**

- Use the mark alone at square sizes; pair with the wordmark horizontally for README headers.
- Prefer a **monochrome SVG** (currentColor) for Obsidian ribbon / dark themes after vectorization.
- Keep clear space ≈ 1/8 of the icon edge around the mark.
- Minimum practical size: ~24px for concept 3; ~32px for concepts 1, 2, and 4.

**Don’t**

- Add robot, brain, sparkle, or purple-glow AI clichés.
- Put product name, version, or telemetry badges inside the icon.
- Stretch, recolor outside the palette, or add drop shadows for the official lockup.
- Commit Git LFS or oversized binaries; production path is SVG + small PNG exports.

## License

Brand assets in this folder are MIT, same as the repository (`LICENSE`).

## Next step after selection

1. Vectorize the winner to SVG (color + mono).
2. Register with Obsidian `addIcon` and replace the Lucide ribbon.
3. Drop a small PNG into the README header / GitHub social preview if needed.
