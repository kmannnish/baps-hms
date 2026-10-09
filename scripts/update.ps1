# ============================================================================
# BAPS Jaipur Utara — update to the latest version from GitHub
# ----------------------------------------------------------------------------
# Don't run this directly — double-click  update.bat  in the project folder.
# Your data is kept (it lives in Docker's volume; this never wipes it). Steps:
#   1. safety backup   (a copy, just in case)
#   2. git pull        (download the new code)
#   3. rebuild         (docker compose up -d --build)
#   4. migrations      (apply any new database changes - safe to re-run)
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path (Join-Path $PSScriptRoot '..')

function Stop-Here($msg) {
    Write-Host ""
    Write-Host $msg -ForegroundColor Yellow
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "==== BAPS Jaipur Utara  -  Update ====" -ForegroundColor Cyan

# Docker must be running.
$dockerOk = $false
try { docker version *>$null; if ($LASTEXITCODE -eq 0) { $dockerOk = $true } } catch { }
if (-not $dockerOk) { Stop-Here "Docker isn't ready. Open Docker Desktop (wait for 'Engine running') and try again." }

# 1. Safety backup (best effort — your live data is in the volume regardless).
Write-Host "[1/4] Taking a safety backup..." -ForegroundColor Cyan
docker exec baps-hms-backend-1 pg_dump -Fc --no-owner --no-privileges -f /app/backups/baps_hms_preupdate.dump *>$null
Write-Host "    Saved to backups\baps_hms_preupdate.dump (if the app was running)." -ForegroundColor Green

# 2. Download the new code.
Write-Host "[2/4] Downloading the update (git pull)..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) { Stop-Here "Could not download the update. Check the internet connection and that Git is signed in, then try again." }

# 3. Rebuild.
Write-Host "[3/4] Rebuilding the app (this can take a few minutes)..." -ForegroundColor Cyan
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Stop-Here "The rebuild failed above. Copy the last ~15 red lines and send them for help." }

# 4. Apply any new database changes. Every migration is written to be safe to
#    run again, so re-running them all is harmless.
Write-Host "[4/4] Applying database updates..." -ForegroundColor Cyan
Get-ChildItem 'backend/db/migrations/*.sql' | Sort-Object Name | ForEach-Object {
    Write-Host ("    - " + $_.Name)
    Get-Content $_.FullName -Raw | docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms *>$null
}

Write-Host ""
Write-Host "==== Update complete ====" -ForegroundColor Green
Write-Host "Open / refresh the app:  http://localhost:4000  (press Ctrl+Shift+R to hard-refresh)"
Read-Host "Press Enter to close"
