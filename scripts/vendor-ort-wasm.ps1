# Vendor onnxruntime-web WASM assets into plugin/wasm (offline, no CDN).
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginRoot = Join-Path $RepoRoot "plugin"
$OrtDist = Join-Path $PluginRoot "node_modules\onnxruntime-web\dist"
$Dest = Join-Path $PluginRoot "wasm"
if (-not (Test-Path $OrtDist)) {
  throw "onnxruntime-web not installed at $OrtDist - run npm install in plugin/"
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$files = @(
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs"
)
foreach ($f in $files) {
  $srcFile = Join-Path $OrtDist $f
  if (Test-Path $srcFile) {
    Copy-Item $srcFile (Join-Path $Dest $f) -Force
    Write-Host "vendored $f"
  } else {
    Write-Warning "missing $f"
  }
}

function Patch-OrtJs([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  $t = [IO.File]::ReadAllText($Path)
  $orig = $t
  $t = $t.Replace(
    'n="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type',
    'n=false'
  )
  $t = $t.Replace(
    'l="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node&&"renderer"!=process.type',
    'l=false'
  )
  $t = $t.Replace(
    "if (isNode) isPthread = (await import('worker_threads')).workerData === 'em-pthread';",
    "if (false) isPthread = false;"
  )
  $t = $t.Replace(
    'if(n){const {createRequire:a}=await import("module");var require=a(import.meta.url),fa=require("worker_threads");global.Worker=fa.Worker;q=(k=!fa.oc)&&"em-pthread"==fa.workerData}',
    'if(n){/* disabled */}'
  )
  $t = $t.Replace("await import('worker_threads')", "null")
  if ($t -ne $orig) {
    [IO.File]::WriteAllText($Path, $t)
    Write-Host "patched $(Split-Path $Path -Leaf) for Obsidian renderer"
  }
}

Patch-OrtJs (Join-Path $Dest "ort-wasm-simd-threaded.jsep.mjs")
Patch-OrtJs (Join-Path $Dest "ort-wasm-simd-threaded.mjs")
Write-Host "WASM pack at $Dest"
