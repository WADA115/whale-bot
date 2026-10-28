@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Local ASR service (sherpa-onnx + paraformer-zh-small)
rem   start-asr.bat            run in foreground, pause on exit
rem   start-asr.bat /silent    background/watchdog mode, log to state\logs\asr.log
rem
rem Paths are auto-detected (env vars can override):
rem   QQB_PYTHON     python.exe
rem   QQB_ONNX_LIBS  folder with onnxruntime / sherpa_onnx / numpy

set "SILENT="
if /i "%~1"=="/silent" set "SILENT=1"

set "ROOT=%~dp0"
set "LOGDIR=%ROOT%state\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>nul
set "LOG=%LOGDIR%\asr.log"

set "PY="
if defined QQB_PYTHON if exist "%QQB_PYTHON%" set "PY=%QQB_PYTHON%"
if defined PY goto have_py
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" set "PY=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if defined PY goto have_py
for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY set "PY=%%p"
if defined PY goto have_py
for /f "delims=" %%p in ('where py 2^>nul') do if not defined PY set "PY=%%p"
if defined PY goto have_py

echo [!] Python not found. Install Python 3.10+ or set QQB_PYTHON.
echo [%date% %time%] start failed: python not found>>"%LOG%"
if not defined SILENT pause
exit /b 1

:have_py
if not defined QQB_ONNX_LIBS if exist "%ROOT%tools\onnxlibs" set "QQB_ONNX_LIBS=%ROOT%tools\onnxlibs"
if not defined QQB_ONNX_LIBS if exist "%USERPROFILE%\onnx-libs" set "QQB_ONNX_LIBS=%USERPROFILE%\onnx-libs"
if defined QQB_ONNX_LIBS goto have_libs

echo [!] onnx libs not found (tools\onnxlibs or %USERPROFILE%\onnx-libs)
echo [%date% %time%] start failed: onnxlibs not found>>"%LOG%"
if not defined SILENT pause
exit /b 1

:have_libs
set "PYTHONPATH=%QQB_ONNX_LIBS%"

if exist "%ROOT%src\asr-server.py" goto have_server
echo [!] src\asr-server.py not found
echo [%date% %time%] start failed: asr-server.py missing>>"%LOG%"
if not defined SILENT pause
exit /b 1

:have_server
"%PY%" -c "import sherpa_onnx, numpy, onnxruntime" >>"%LOG%" 2>&1
if not errorlevel 1 goto run

echo [!] Python deps missing (sherpa_onnx / onnxruntime / numpy), see %LOG%
echo [%date% %time%] deps check failed PY=%PY% ONNX=%QQB_ONNX_LIBS%>>"%LOG%"
if not defined SILENT pause
exit /b 1

:run
echo [%date% %time%] starting ASR: %PY%>>"%LOG%"
echo [ASR] Python: %PY%
echo [ASR] Libs:   %QQB_ONNX_LIBS%
echo [ASR] Log:    %LOG%
"%PY%" "%ROOT%src\asr-server.py" --port 3199 >>"%LOG%" 2>&1
set "CODE=%errorlevel%"
echo [%date% %time%] ASR exited (code=%CODE%)>>"%LOG%"
echo.
echo [ASR] exited (code=%CODE%), log: %LOG%
if not defined SILENT pause >nul
exit /b %CODE%
