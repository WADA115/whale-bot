@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 小鲸鱼 守护
echo 守护模式：每 30 秒检查一次，桥接挂了自动拉起。
echo 关掉这个窗口就停止守护。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
echo.
echo 守护已退出，按任意键关闭
pause >nul
