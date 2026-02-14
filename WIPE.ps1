# ==========================
# SML TAKEOFF — WIPE (ADMIN)
# ==========================
# Run in *Admin* PowerShell.
# Deletes ONLY:
#   C:\smltakeoff\backend
#   C:\smltakeoff\frontend
# Does NOT delete C:\smltakeoff itself.

$ErrorActionPreference = "SilentlyContinue"

$base = "C:\smltakeoff"
$backend = Join-Path $base "backend"
$frontend = Join-Path $base "frontend"

Write-Host "=== STOP: killing node/npm/vite processes ===" -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process npm  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process cmd  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

function Kill-Port($port) {
  $pids = netstat -ano | Select-String ":$port\s" | ForEach-Object {
    ($_ -split "\s+")[-1]
  } | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique
  foreach ($pid in $pids) {
    Write-Host "Killing PID $pid on port $port" -ForegroundColor Yellow
    taskkill /PID $pid /F | Out-Null
  }
}

Write-Host "=== STOP: freeing ports 10000 + 5173 ===" -ForegroundColor Yellow
Kill-Port 10000
Kill-Port 5173

Write-Host "=== WIPE: deleting backend + frontend folders ===" -ForegroundColor Cyan
if (Test-Path $backend) { Remove-Item $backend -Recurse -Force }
if (Test-Path $frontend) { Remove-Item $frontend -Recurse -Force }

Write-Host "DONE. Now extract the full-replacement ZIP to C:\smltakeoff" -ForegroundColor Green
