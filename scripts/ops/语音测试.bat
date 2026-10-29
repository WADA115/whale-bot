@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tts-sapi.ps1"
echo.
echo done. this window closes in 20 seconds.
timeout /t 20 >nul
