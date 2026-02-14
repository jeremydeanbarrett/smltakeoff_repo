# =========================
# SML TAKEOFF — START (NORMAL)
# =========================
# Run in *normal* PowerShell (NOT Admin).
# Opens 2 CMD windows: BACKEND + FRONTEND

$ErrorActionPreference = "Stop"

$base = "C:\smltakeoff"
$backend = Join-Path $base "backend"
$frontend = Join-Path $base "frontend"

function Assert-Path($path, $label) {
  if (!(Test-Path $path)) { throw "Missing ${label}: $path (did you extract the ZIP to C:\smltakeoff?)" }
}

function Run-InFolder($workdir, $commandLine) {
  Push-Location $workdir
  try {
    Write-Host "RUN: $commandLine (in $workdir)" -ForegroundColor Yellow
    cmd.exe /c $commandLine
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE : $commandLine" }
  } finally {
    Pop-Location
  }
}

function Start-CmdWindow($title, $workdir, $commandLine) {
  Write-Host "Starting $title..." -ForegroundColor Cyan
  Start-Process -FilePath "cmd.exe" -WorkingDirectory $workdir -ArgumentList @("/k", $commandLine) -WindowStyle Normal
}

Write-Host "=== START: Verifying folders ===" -ForegroundColor Cyan
Assert-Path $backend  "backend folder"
Assert-Path $frontend "frontend folder"
Assert-Path (Join-Path $backend "package.json")  "backend package.json"
Assert-Path (Join-Path $frontend "package.json") "frontend package.json"

Write-Host "=== START: Installing deps (only if needed) ===" -ForegroundColor Cyan
if (!(Test-Path (Join-Path $backend "node_modules")))  { Run-InFolder $backend  "npm install" }
if (!(Test-Path (Join-Path $frontend "node_modules"))) { Run-InFolder $frontend "npm install" }

Write-Host "=== START: Launching backend + frontend ===" -ForegroundColor Cyan
Start-CmdWindow "BACKEND"  $backend  "npm run dev"
Start-Sleep -Seconds 2
Start-CmdWindow "FRONTEND" $frontend "npm run dev"

Write-Host ""
Write-Host "Open: http://localhost:5173" -ForegroundColor Green
