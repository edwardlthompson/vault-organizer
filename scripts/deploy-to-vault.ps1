param(
  [string]$VaultPath = "$env:USERPROFILE\Documents\VaultOrganizer-Dev",
  [switch]$OpenObsidian,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PluginSrc = Join-Path $Root "plugin"
$PluginId = "vault-organizer"

Write-Host "=== Vault Organizer deploy ===" -ForegroundColor Cyan

if (-not $SkipBuild) {
  Push-Location $PluginSrc
  if (-not (Test-Path "node_modules")) {
    npm install
  }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
  Pop-Location
}

# Large WASM/tokenizer files are gitignored — vendor when missing
$wasmProbe = Join-Path $PluginSrc "wasm\ort-wasm-simd-threaded.wasm"
if (-not (Test-Path $wasmProbe)) {
  & (Join-Path $Root "scripts\vendor-ort-wasm.ps1")
}

$dest = Join-Path $VaultPath ".obsidian\plugins\$PluginId"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $VaultPath "Inbox") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $VaultPath "Work") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $VaultPath "Life") | Out-Null

Copy-Item (Join-Path $PluginSrc "main.js") $dest -Force
Copy-Item (Join-Path $PluginSrc "manifest.json") $dest -Force
Copy-Item (Join-Path $PluginSrc "styles.css") $dest -Force
Copy-Item (Join-Path $PluginSrc ".hotreload") $dest -Force -ErrorAction SilentlyContinue

# Copy vendored models if present
$modelsSrc = Join-Path $PluginSrc "models"
if (Test-Path $modelsSrc) {
  New-Item -ItemType Directory -Force -Path (Join-Path $dest "models") | Out-Null
  Copy-Item -Path (Join-Path $modelsSrc "*") -Destination (Join-Path $dest "models") -Recurse -Force
}

# Copy ORT WASM runtime (required for ONNX in Obsidian Electron)
$wasmSrc = Join-Path $PluginSrc "wasm"
if (Test-Path $wasmSrc) {
  New-Item -ItemType Directory -Force -Path (Join-Path $dest "wasm") | Out-Null
  Copy-Item -Path (Join-Path $wasmSrc "*") -Destination (Join-Path $dest "wasm") -Recurse -Force
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

# Enable community plugins + this plugin
$obs = Join-Path $VaultPath ".obsidian"
New-Item -ItemType Directory -Force -Path $obs | Out-Null
$appJson = Join-Path $obs "app.json"
if (-not (Test-Path $appJson)) { Write-Utf8NoBom $appJson "{}" }
$community = Join-Path $obs "community-plugins.json"
$enabled = @($PluginId)
if (Test-Path $community) {
  try {
    $existing = Get-Content $community -Raw | ConvertFrom-Json
    if ($existing -is [array]) {
      $enabled = @($existing + $PluginId | Select-Object -Unique)
    }
  } catch {}
}
# Force JSON array even for a single plugin id
$json = ConvertTo-Json @($enabled) -Compress
if ($json -notmatch '^\[') { $json = "[$json]" }
Write-Utf8NoBom $community $json

# Fixture notes
$fixtures = Join-Path $Root "fixtures\notes"
if (Test-Path $fixtures) {
  Copy-Item (Join-Path $fixtures "*") $VaultPath -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Utf8NoBom (Join-Path $VaultPath "Inbox\kickoff.md") @"
# Project kickoff

Quarterly planning meeting for the client delivery roadmap.
"@
}

Write-Host "Deployed to $dest" -ForegroundColor Green
Write-Host ""
Write-Host "Next in Obsidian:" -ForegroundColor Cyan
Write-Host "  1. Open this vault: $VaultPath"
Write-Host "  2. Settings -> Community plugins -> Turn on community plugins"
Write-Host "  3. Under Installed plugins (NOT Browse), enable Vault Organizer"
Write-Host "  4. If missing, press Ctrl+R to reload, then check Installed again"

if ($OpenObsidian) {
  $exe = Join-Path $env:LOCALAPPDATA "Programs\obsidian\Obsidian.exe"
  if (Test-Path $exe) {
    Start-Process $exe
    Write-Host "Launched Obsidian - choose vault: $VaultPath" -ForegroundColor Green
  } else {
    Write-Warning "Obsidian.exe not found at $exe"
  }
}
