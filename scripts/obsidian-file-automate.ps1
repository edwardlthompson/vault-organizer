# Trigger Vault Organizer jobs by dropping run-request.json (plugin polls every 2s).
# Then wait for last-run.json event=request-complete.
param(
  [string]$PluginDir = "$env:USERPROFILE\Documents\My Notes\.obsidian\plugins\vault-organizer",
  [string[]]$Actions = @("rebuild-index", "organize-vault"),
  [int]$TimeoutSec = 3600
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $PluginDir)) { throw "Plugin dir not found: $PluginDir" }

$req = Join-Path $PluginDir "run-request.json"
$log = Join-Path $PluginDir "last-run.json"
if (Test-Path $log) { Remove-Item $log -Force }

$payload = @{ actions = @($Actions); ts = (Get-Date).ToString("o") } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($req, $payload)
Write-Host "Wrote $req"
Write-Host "Waiting for last-run.json (request-complete) up to ${TimeoutSec}s..."

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $log) {
    $txt = Get-Content $log -Raw
    Write-Host $txt
    if ($txt -match '"event"\s*:\s*"request-complete"' -or $txt -match '"event"\s*:\s*"request-error"') {
      exit 0
    }
  }
  Start-Sleep -Seconds 3
}
Write-Host "Timed out waiting for completion"
exit 1
