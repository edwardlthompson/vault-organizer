# Vault Organizer model manifest (pinned FOSS weights)

Do not download from Hugging Face at plugin runtime.
Release CI / `scripts/vendor-model.ps1` populates `plugin/models/arctic-embed-m/`.

```json
{
  "defaultPack": "arctic-embed-m",
  "packs": {
    "arctic-embed-m": {
      "id": "arctic-embed-m",
      "hfRepo": "Snowflake/snowflake-arctic-embed-m",
      "license": "Apache-2.0",
      "role": "default",
      "mtebRetrievalNdcg10": 54.9,
      "files": [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "onnx/model_quantized.onnx"
      ]
    },
    "arctic-embed-s": {
      "id": "arctic-embed-s",
      "hfRepo": "Snowflake/snowflake-arctic-embed-s",
      "license": "Apache-2.0",
      "role": "low-ram-fallback",
      "mtebRetrievalNdcg10": 51.98
    },
    "arctic-embed-l": {
      "id": "arctic-embed-l",
      "hfRepo": "Snowflake/snowflake-arctic-embed-l",
      "license": "Apache-2.0",
      "role": "max-accuracy-optional",
      "mtebRetrievalNdcg10": 55.98
    }
  },
  "policy": {
    "runtimeNetwork": false,
    "pinChanges": "human-approved-only",
    "leaderboard": "models/LEADERBOARD.md"
  }
}
```
