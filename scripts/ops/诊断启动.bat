@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo ==== %date% %time% ==== > "运行日志.txt"
echo [cwd] %CD% >> "运行日志.txt"
echo [node] >> "运行日志.txt"
where node >> "运行日志.txt" 2>&1
node -v >> "运行日志.txt" 2>&1
echo [bridge] >> "运行日志.txt"
node src\bridge.js >> "运行日志.txt" 2>&1
echo [exit] %errorlevel% >> "运行日志.txt"
echo.
echo 已完成，日志写入 运行日志.txt
echo 窗口会保持 30 秒。
timeout /t 30 >nul
