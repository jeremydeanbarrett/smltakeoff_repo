# STOP.ps1 - SML Takeoff
$ErrorActionPreference = "SilentlyContinue"

Write-Host "=== SML TAKEOFF STOP BEGIN ===" -ForegroundColor Yellow

# Kill ports we use
$ports = @(10000,5173,4173,4000,3001)
foreach ($p in $ports) {
  try {
    netstat -ano | Select-String ":$p\s" | ForEach-Object {
      $pid = ($_ -split "\s+")[-1]
      if ($pid -match "^\d+$") { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}

# Kill node processes (best effort)
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "STOP complete." -ForegroundColor Green
