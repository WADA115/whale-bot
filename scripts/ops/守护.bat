@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
title QQ Bot Watchdog
echo Watchdog: checks every 30s and restarts bridge / ASR if down.
echo Close this window to stop the watchdog.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
echo.
echo Watchdog exited.
pause >nul