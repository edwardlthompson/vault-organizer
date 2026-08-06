#!/usr/bin/env python3
"""Score FOSS embedder candidates for Vault Organizer leapfrog detection.

Uses public metric table + local hash-embedder fixture proxy when ONNX absent.
Writes models/LEADERBOARD.md and models/leaderboard.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "models" / "MANIFEST.json").read_text(encoding="utf-8"))

# Curated public retrieval scores (MTEB NDCG@10) — update when cards change.
PUBLIC = {
    "arctic-embed-m": 54.90,
    "arctic-embed-l": 55.98,
    "arctic-embed-s": 51.98,
    "bge-base-en-v1.5": 53.25,
    "bge-small-en-v1.5": 51.68,
    "all-MiniLM-L6-v2": 41.95,
}

FIXTURES = [
    ("Project quarterly planning meeting client roadmap", "Work"),
    ("Grocery list milk eggs bread", "Life"),
    ("Workout plan strength training legs", "Life"),
    ("API design notes for payment service", "Work"),
]


def hash_embed(text: str, dims: int = 64) -> list[float]:
    v = [0.0] * dims
    for tok in re.split(r"[^a-z0-9#/]+", text.lower()):
        if not tok:
            continue
        h = 2166136261
        for ch in tok:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        v[h % dims] += 1.0
        v[(h >> 8) % dims] += 0.5
    n = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / n for x in v]


def cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def fixture_score() -> float:
    """Proxy accuracy: hash embedder nearest-label match on fixtures."""
    labels = sorted({lab for _, lab in FIXTURES})
    protos = {lab: hash_embed(lab) for lab in labels}
    correct = 0
    for text, lab in FIXTURES:
        vec = hash_embed(text)
        pred = max(protos.items(), key=lambda kv: cos(vec, kv[1]))[0]
        if pred == lab:
            correct += 1
    return correct / len(FIXTURES)


def main() -> None:
    pinned = MANIFEST["defaultPack"]
    pinned_score = PUBLIC.get(pinned, 0.0)
    fx = fixture_score()
    rows = []
    for name, score in sorted(PUBLIC.items(), key=lambda x: -x[1]):
        rows.append(
            {
                "id": name,
                "public_ndcg10": score,
                "fixture_proxy": round(fx, 4) if name == pinned else None,
                "pinned": name == pinned,
                "delta_vs_pin": round(score - pinned_score, 2),
            }
        )

    leapfrogs = [
        r
        for r in rows
        if (not r["pinned"]) and r["delta_vs_pin"] >= 1.0
    ]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pinned": pinned,
        "fixture_proxy_accuracy": round(fx, 4),
        "candidates": rows,
        "leapfrog_candidates": [r["id"] for r in leapfrogs],
    }
    (ROOT / "models" / "leaderboard.json").write_text(
        json.dumps(out, indent=2) + "\n", encoding="utf-8"
    )

    lines = [
        "# Model leaderboard",
        "",
        f"Generated: `{out['generated_at']}`",
        "",
        f"Pinned default: **{pinned}**",
        "",
        f"Fixture proxy accuracy (hash embedder smoke): **{fx:.0%}**",
        "",
        "| Model | Public NDCG@10 | Δ vs pin | Pinned |",
        "|-------|----------------|----------|--------|",
    ]
    for r in rows:
        lines.append(
            f"| {r['id']} | {r['public_ndcg10']:.2f} | {r['delta_vs_pin']:+.2f} | {'yes' if r['pinned'] else ''} |"
        )
    lines += [
        "",
        "## Leapfrog alerts",
        "",
    ]
    if leapfrogs:
        lines.append(
            "Challengers ≥ +1.0 NDCG vs pin: "
            + ", ".join(r["id"] for r in leapfrogs)
            + ". If this persists 2 consecutive weeks, open a human pin-change issue."
        )
    else:
        lines.append("No leapfrog challengers this run.")
    lines.append("")
    (ROOT / "models" / "LEADERBOARD.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
