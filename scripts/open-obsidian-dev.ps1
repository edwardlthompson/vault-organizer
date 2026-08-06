param([string]$VaultPath = "$env:USERPROFILE\Documents\VaultOrganizer-Dev")
$exe = Join-Path $env:LOCALAPPDATA "Programs\obsidian\Obsidian.exe"
if (-not (Test-Path $exe)) { throw "Obsidian not found" }
Start-Process $exe
Write-Host "Open vault via Obsidian: Open folder as vault -> $VaultPath"
