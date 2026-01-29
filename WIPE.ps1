# WIPE.ps1 - SML Takeoff (does NOT delete C:\smltakeoff_repo itself)
$ErrorActionPreference = "Stop"

Write-Host "=== SML TAKEOFF WIPE BEGIN ===" -ForegroundColor Yellow

$ROOT="C:\smltakeoff_repo"
$BACKEND="$ROOT\backend"
$FRONTEND="$ROOT\frontend"

# Stop anything running first
if (Test-Path "$ROOT\STOP.ps1") { & "$ROOT\STOP.ps1" | Out-Null }

# Delete ONLY these folders
if (Test-Path $BACKEND)  { Remove-Item $BACKEND  -Recurse -Force }
if (Test-Path $FRONTEND) { Remove-Item $FRONTEND -Recurse -Force }

Write-Host ""
Write-Host "WIPE complete." -ForegroundColor Green
Write-Host "NOW extract the FULL REPLACEMENT ZIP into: C:\smltakeoff_repo" -ForegroundColor Cyan
Write-Host "After extracting, run START.ps1" -ForegroundColor Cyan
