# ============================================================================
# BAPS Jaipur Utara — Reception kiosk launcher
# ----------------------------------------------------------------------------
# Waits for the app to be ready, then opens it FULL-SCREEN (kiosk) in Edge.
# Runs automatically at login via "BAPS Reception.bat" in the Startup folder
# (the installer puts it there).
#
#   • To EXIT the full-screen app:            press  Alt + F4
#   • To STOP it opening automatically:       press  Win + R, type  shell:startup,
#                                             delete "BAPS Reception.bat"
# ============================================================================

$url = 'http://localhost:4000'

# Docker may still be starting right after login — wait up to ~3 minutes for the
# app to answer before opening the browser.
for ($i = 0; $i -lt 90; $i++) {
    try {
        if ((Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { break }
    } catch { }
    Start-Sleep -Seconds 2
}

# Microsoft Edge ships with Windows — open the app in kiosk (full-screen) mode.
$edge = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
    Start-Process $edge -ArgumentList "--kiosk `"$url`" --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check"
} else {
    # Fallback: open in the default browser (not guaranteed full-screen).
    Start-Process $url
}
