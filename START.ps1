# START.ps1 - SML Takeoff
$ErrorActionPreference = "Stop"

Write-Host "=== SML TAKEOFF START BEGIN ===" -ForegroundColor Yellow

$ROOT="C:\smltakeoff_repo"
$BACKEND="$ROOT\backend"
$FRONTEND="$ROOT\frontend"

if (!(Test-Path "$BACKEND\package.json"))  { throw "backend missing package.json -> extract the full zip into C:\smltakeoff_repo" }
if (!(Test-Path "$FRONTEND\package.json")) { throw "frontend missing package.json -> extract the full zip into C:\smltakeoff_repo" }

# Free ports (best effort)
$ports = @(10000,5173,4173,4000,3001)
foreach ($p in $ports) {
  try {
    netstat -ano | Select-String ":$p\s" | ForEach-Object {
      $pid = ($_ -split "\s+")[-1]
      if ($pid -match "^\d+$") { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}

Write-Host ""
Write-Host "Starting BACKEND (new cmd window)..." -ForegroundColor Green
Start-Process cmd.exe -WorkingDirectory $BACKEND -ArgumentList "/k","set NODE_ENV=development&& set PORT=10000&& if not exist node_modules npm install&& npm start"

Write-Host "Waiting for backend health..." -ForegroundColor Yellow
$ok = $false
for ($i=0; $i -lt 60; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:10000/api/health"
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}

if (-not $ok) {
  Write-Host ""
  Write-Host "Backend did NOT come up." -ForegroundColor Red
  Write-Host "Look at the BACKEND cmd window and tell me the FIRST red error line." -ForegroundColor Red
  throw "Backend health check failed: http://localhost:10000/api/health"
}

Write-Host ""
Write-Host "Starting FRONTEND (new PowerShell window)..." -ForegroundColor Green
Start-Process powershell.exe -WorkingDirectory $FRONTEND -ArgumentList "-NoExit","-Command","if (!(Test-Path node_modules)) { npm install }; npm run dev -- --host --port 5173"

Start-Sleep -Seconds 1
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "OPEN:   http://localhost:5173" -ForegroundColor Cyan
Write-Host "HEALTH: http://localhost:10000/api/health" -ForegroundColor Cyan
Write-Host "START complete." -ForegroundColor Green
