param(
  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Plugin = Join-Path $Root "plugin"
$Dist = Join-Path $Root "dist\release"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

Push-Location $Plugin
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }
Pop-Location

# Ensure ORT WASM + model tokenizer exist for full package (gitignored large binaries)
& (Join-Path $Root "scripts\vendor-ort-wasm.ps1")
if (-not (Test-Path (Join-Path $Plugin "models\arctic-embed-m\onnx\model_quantized.onnx"))) {
  Write-Host "ONNX missing — run scripts/vendor-model.ps1 for a complete full zip" -ForegroundColor Yellow
}

$slim = Join-Path $Dist "slim"
$full = Join-Path $Dist "full"
Remove-Item $slim, $full -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $slim, $full | Out-Null

Copy-Item (Join-Path $Plugin "main.js") $slim
Copy-Item (Join-Path $Plugin "manifest.json") $slim
Copy-Item (Join-Path $Plugin "styles.css") $slim
Copy-Item (Join-Path $Plugin "main.js") $full
Copy-Item (Join-Path $Plugin "manifest.json") $full
Copy-Item (Join-Path $Plugin "styles.css") $full

if (Test-Path (Join-Path $Plugin "models")) {
  Copy-Item (Join-Path $Plugin "models") (Join-Path $full "models") -Recurse -Force
}

$slimZip = Join-Path $Dist "vault-organizer-$Version-slim.zip"
$fullZip = Join-Path $Dist "vault-organizer-full-$Version.zip"
$modelsZip = Join-Path $Dist "vault-organizer-models-only-$Version.zip"
Remove-Item $slimZip, $fullZip, $modelsZip -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $slim "*") -DestinationPath $slimZip
Compress-Archive -Path (Join-Path $full "*") -DestinationPath $fullZip
if (Test-Path (Join-Path $full "models")) {
  Compress-Archive -Path (Join-Path $full "models") -DestinationPath $modelsZip
}

Copy-Item (Join-Path $Plugin "main.js") $Dist -Force
Copy-Item (Join-Path $Plugin "manifest.json") $Dist -Force
Copy-Item (Join-Path $Plugin "styles.css") $Dist -Force

# Keep repo-root marketplace files in sync with plugin/ (Community directory reads HEAD)
Copy-Item (Join-Path $Plugin "manifest.json") (Join-Path $Root "manifest.json") -Force
if (Test-Path (Join-Path $Plugin "versions.json")) {
  Copy-Item (Join-Path $Plugin "versions.json") (Join-Path $Root "versions.json") -Force
}

Write-Host "Release artifacts in $Dist" -ForegroundColor Green
Get-ChildItem $Dist | Format-Table Name, Length
