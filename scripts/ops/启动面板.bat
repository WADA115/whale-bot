@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
title 小鲸鱼控制台

rem 一键入口：起面板 → 自动拉起三个服务 → 打开界面
echo ============================================
echo   小鲸鱼控制台
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

rem 面板已在跑就不重复起
powershell -NoProfile -Command "try { $c=New-Object System.Net.Sockets.TcpClient; $t=$c.ConnectAsync('127.0.0.1',3200); if($t.Wait(600) -and $c.Connected){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto panel_ready

echo [1/2] 启动控制台面板...
start "" /min cmd /c "node app.js"
echo       等待面板就绪...
:wait_panel
powershell -NoProfile -Command "try { $c=New-Object System.Net.Sockets.TcpClient; $t=$c.ConnectAsync('127.0.0.1',3200); if($t.Wait(600) -and $c.Connected){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto panel_ready
ping -n 2 127.0.0.1 >nul
goto wait_panel

:panel_ready
echo [2/2] 启动服务（已在跑的会跳过）...
powershell -NoProfile -Command "try { Invoke-WebRequest -Method POST -Uri 'http://127.0.0.1:3200/api/start?target=all' -TimeoutSec 90 -UseBasicParsing | Out-Null } catch {}" >nul 2>nul

start "" "http://127.0.0.1:3200"
echo.
echo 界面已打开：http://127.0.0.1:3200
echo 关掉这个窗口不影响运行。
ping -n 4 127.0.0.1 >nul
exit /b 0

:no_node
echo [!] PATH 里找不到 node，无法启动控制台
pause
exit /b 1
