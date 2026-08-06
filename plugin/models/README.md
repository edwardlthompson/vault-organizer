# Vendored model packs

ONNX weights are **not** committed to git (too large).

```powershell
pwsh scripts/vendor-model.ps1 -Pack arctic-embed-m
```

Copies into `plugin/models/<pack>/` for local deploy and `vault-organizer-full-*.zip` packaging.

See `models/MANIFEST.json` and `models/LEADERBOARD.md`.
