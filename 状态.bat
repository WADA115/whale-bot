@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 小鲸鱼 状态
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0状态.ps1"
echo.
pause