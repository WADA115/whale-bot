@echo off
cd /d "%~dp0"
start "" /min node scripts\watchdog.mjs
