@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 本地中文 ASR 服务（sherpa-onnx + paraformer-zh-small）
rem 依赖与 Python 路径：优先用环境变量，没设就在本目录找（开源版不要写死本机路径）
if not defined QQB_ONNX_LIBS set "QQB_ONNX_LIBS=%~dp0tools\onnxlibs"
set "PYTHONPATH=%QQB_ONNX_LIBS%"
if not defined QQB_PYTHON set "QQB_PYTHON=python"
set "PY=%QQB_PYTHON%"
if not exist "%PY%" (
  echo [!] 找不到 python: %PY%
  pause
  exit /b 1
)
if not exist "src\asr-server.py" (
  echo [!] 找不到 src\asr-server.py
  pause
  exit /b 1
)
"%PY%" src\asr-server.py --port 3199
echo.
echo [ASR] 服务已退出，按任意键关闭
pause >nul
