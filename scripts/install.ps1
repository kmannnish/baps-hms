# ============================================================================
# BAPS Jaipur Utara — Reception PC installer (guided)
# ----------------------------------------------------------------------------
# Don't run this directly — double-click  install-reception.bat  in the project
# folder. It will:
#   1. check Docker is running
#   2. set a private secret key
#   3. build & start the app  (first time: a few minutes)
#   4. wait for it to come up
#   5. make it open full-screen when you log in
#
# If anything fails, SETUP-RECEPTION-PC.md has the same steps to do by hand.
# ============================================================================

$ErrorActionPreference = 'Stop'
# This script lives in <project>\scripts — move to the project root.
Set-Location -Path (Join-Path $PSScriptRoot '..')

function Stop-Here($msg) {
    Write-Host ""
    Write-Host $msg -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "==== BAPS Jaipur Utara  -  Reception PC setup ====" -ForegroundColor Cyan
Write-Host ""
Read-Host "Make sure Docker Desktop is open and says 'Engine running', then press Enter to begin"

# --- 1. Docker check --------------------------------------------------------
Write-Host "[1/5] Checking Docker..." -ForegroundColor Cyan
$dockerOk = $false
try { docker version *>$null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true } } catch { }
if (-not $dockerOk) {
    Stop-Here "Docker isn't ready. Open Docker Desktop, wait for 'Engine running', then run install-reception.bat again. (If Docker isn't installed, see SETUP-RECEPTION-PC.md step 1.)"
}
Write-Host "    Docker is running." -ForegroundColor Green

# --- 2. Secret key (stored in .env, never committed) -----------------------
Write-Host "[2/5] Setting a private secret key..." -ForegroundColor Cyan
if (Test-Path '.env') {
    Write-Host "    .env already exists - keeping this PC's existing key." -ForegroundColor Green
} else {
    $secret = -join (1..48 | ForEach-Object { '{0:x2}' -f (Get-Random -Minimum 0 -Maximum 256) })
    "JWT_SECRET=$secret" | Set-Content -Path '.env' -Encoding ASCII
    Write-Host "    Created .env with a unique key for this PC." -ForegroundColor Green
}

# --- 3. Build & start -------------------------------------------------------
Write-Host "[3/5] Building and starting the app. First time takes a few minutes - please wait..." -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Stop-Here "The build failed above. Copy the last ~15 red lines and send them for help."
}
Write-Host "    Built and started." -ForegroundColor Green

# --- 4. Wait for the app ----------------------------------------------------
Write-Host "[4/5] Waiting for the app to come up..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest 'http://localhost:4000/health' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { $ok = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if ($ok) { Write-Host "    App is up:  http://localhost:4000" -ForegroundColor Green }
else { Write-Host "    Not confirmed yet - give it another minute, then open http://localhost:4000" -ForegroundColor Yellow }

# --- 5. Open full-screen at login ------------------------------------------
Write-Host "[5/5] Making the app open full-screen when you log in..." -ForegroundColor Cyan
$startup  = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $PSScriptRoot 'start-reception.ps1'
$batPath  = Join-Path $startup 'BAPS Reception.bat'
"@echo off`r`npowershell -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"" | Set-Content -Path $batPath -Encoding ASCII
Write-Host "    Done." -ForegroundColor Green

Write-Host ""
Write-Host "============== Setup complete ==============" -ForegroundColor Green
Write-Host "Open the app now:   http://localhost:4000"
Write-Host "It will open full-screen by itself next time you log in."
Write-Host ""
Write-Host "DO THESE ONCE (see SETUP-RECEPTION-PC.md):" -ForegroundColor Yellow
Write-Host "  * Docker Desktop -> Settings -> General -> tick 'Start Docker Desktop when you log in'"
Write-Host "  * Sign in as Admin (9000000001 / password123) and change ALL demo passwords (Users tab)"
Write-Host "  * Optional: put it online with Tailscale, and turn on daily email reports"
Write-Host ""
Read-Host "Press Enter to close"
