# =========================
# SML TAKEOFF — STOP (NORMAL)
# =========================
# Run in *normal* PowerShell (Admin not required)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Stopping node/npm/vite..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process npm  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

function Kill-Port($port) {
  $pids = netstat -ano | Select-String ":$port\s" | ForEach-Object {
    ($_ -split "\s+")[-1]
  } | Where-Object { $_ -match '^\d+$' } | Select-Object -Unique
  foreach ($pid in $pids) {
    Write-Host "Killing PID $pid on port $port" -ForegroundColor Yellow
    taskkill /PID $pid /F | Out-Null
  }
}
Kill-Port 10000
Kill-Port 5173

Write-Host "Stopped." -ForegroundColor Green
