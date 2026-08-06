# Automate Obsidian Vault Organizer via UI SendKeys (reload -> rebuild -> organize).
# Requires Obsidian focused on the target vault. Launches with CDP flags if not running.
param(
  [string]$VaultUri = "obsidian://open?path=C:/Users/edwar/Documents/My%20Notes",
  [int]$ReloadWaitSec = 10,
  [int]$RebuildWaitSec = 30,
  [int]$OrganizeWaitSec = 60
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class VoWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$exe = Join-Path $env:LOCALAPPDATA "Programs\obsidian\Obsidian.exe"
$obs = Get-Process Obsidian -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match "Obsidian" } | Select-Object -First 1
if (-not $obs) {
  Write-Host "Launching Obsidian..."
  Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=9222","--remote-allow-origins=*"
  Start-Sleep -Seconds 8
  Start-Process $VaultUri
  Start-Sleep -Seconds 10
  $obs = Get-Process Obsidian | Where-Object { $_.MainWindowTitle -match "Obsidian" } | Select-Object -First 1
}
if (-not $obs) { throw "Obsidian window not found" }

function Focus-Obsidian {
  $p = Get-Process Obsidian | Where-Object { $_.MainWindowTitle -match "Obsidian" } | Select-Object -First 1
  [VoWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [VoWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 400
}

function Invoke-CommandPalette([string]$Query) {
  Focus-Obsidian
  [System.Windows.Forms.SendKeys]::SendWait("^p")
  Start-Sleep -Milliseconds 700
  [System.Windows.Forms.SendKeys]::SendWait($Query)
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

Write-Host "Ctrl+R reload..."
Focus-Obsidian
[System.Windows.Forms.SendKeys]::SendWait("^r")
Start-Sleep -Seconds $ReloadWaitSec

Write-Host "Rebuild vault embedding index..."
Invoke-CommandPalette "Rebuild vault embedding index"
Start-Sleep -Seconds $RebuildWaitSec

Write-Host "Organize entire vault (review)..."
Invoke-CommandPalette "Organize entire vault (review)"
Start-Sleep -Seconds $OrganizeWaitSec

$log = Join-Path $env:USERPROFILE "Documents\My Notes\.obsidian\plugins\vault-organizer\last-run.json"
if (Test-Path $log) {
  Write-Host "last-run.json:"
  Get-Content $log -Raw
} else {
  Write-Host "No last-run.json yet (plugin may still be running, or older build without logging)."
}
Write-Host "Done."
