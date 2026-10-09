@echo off
REM ==========================================================================
REM BAPS Jaipur Utara - Reception PC installer
REM Double-click this file to set everything up. It just launches the guided
REM PowerShell installer in scripts\install.ps1.
REM ==========================================================================
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\install.ps1"
