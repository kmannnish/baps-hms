@echo off
REM ==========================================================================
REM BAPS Jaipur Utara - Update
REM Double-click to update the app to the latest version from GitHub.
REM Your bookings/data are kept. Make sure Docker Desktop is running first.
REM ==========================================================================
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\update.ps1"
