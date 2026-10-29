@echo off
cd /d "%~dp0"
wscript.exe "scripts\ops\start-hidden.vbs"
wscript.exe "scripts\ops\start-watchdog.vbs"
