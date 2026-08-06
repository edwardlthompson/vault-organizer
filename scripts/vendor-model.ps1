param(
  [string]$Pack = "arctic-embed-m",
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $Root "plugin\models\$Pack" }

$manifestPath = Join-Path $Root "models\MANIFEST.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$packInfo = $manifest.packs.$Pack
if (-not $packInfo) { throw "Unknown pack $Pack" }

$repo = $packInfo.hfRepo
Write-Host "Vendoring $repo -> $OutDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "onnx") | Out-Null

$files = @(
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "vocab.txt",
  "onnx/model_quantized.onnx",
  "onnx/model_int8.onnx"
)

foreach ($f in $files) {
  $url = "https://huggingface.co/$repo/resolve/main/$f"
  $dest = Join-Path $OutDir ($f -replace "/", [IO.Path]::DirectorySeparatorChar)
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  if (Test-Path $dest) {
    Write-Host "exists: $f"
    continue
  }
  Write-Host "GET $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  } catch {
    Write-Host "skip $f ($($_.Exception.Message))"
  }
}

# Prefer quantized; if only int8 downloaded, copy as quantized name for loader
$q = Join-Path $OutDir "onnx\model_quantized.onnx"
$i8 = Join-Path $OutDir "onnx\model_int8.onnx"
if (-not (Test-Path $q) -and (Test-Path $i8)) {
  Copy-Item $i8 $q
}

Copy-Item $manifestPath (Join-Path $OutDir "MANIFEST.json") -Force
Write-Host "Done. Remember Apache-2.0 attribution in THIRD_PARTY_LICENSES.md" -ForegroundColor Green
