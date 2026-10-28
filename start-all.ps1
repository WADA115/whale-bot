param(
  [int]$TimeoutSec = 120
)

# 启动全部服务。
#
# 分工（踩过坑之后的结论）：
#   · SnowLuma 和 ASR 由这个脚本直接用 Start-Process -WindowStyle Hidden 起
#     —— 从 PowerShell 启动是稳的；而面板进程（无控制台）里 spawn 它们会失败。
#   · 桥接交给面板接口起（带启动令牌），这样发送链路和面板状态一致。
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$state = Join-Path $repo 'state'
$logFile = Join-Path $state 'launcher.log'
# SnowLuma 目录从 config.json 读（迁移时只改配置，不用改脚本）
$cfgSnow = ''
try {
  $cfgPath = Join-Path $repo 'config.json'
  if (Test-Path $cfgPath) { $cfgSnow = (Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).snowluma.homeDir }
} catch {}
if (-not $cfgSnow) { $cfgSnow = '' }  # 不写死本机路径：没配就让下面的提示告诉用户去填
$snowDir = $cfgSnow

New-Item -ItemType Directory -Force -Path $state | Out-Null
function Say($msg) {
  Add-Content -Path $logFile -Value ('[{0}] {1}' -f (Get-Date -Format 'MM-dd HH:mm:ss'), $msg) -Encoding UTF8
}

function Test-Port([int]$p) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $task = $client.ConnectAsync('127.0.0.1', $p)
    $ok = $task.Wait(600) -and $client.Connected
    $client.Close()
    return $ok
  } catch { return $false }
}

# ── 1. SnowLuma ────────────────────────────────────────────────────────────
# 先看进程：SnowLuma 没登录 QQ 时 3000 不开，但进程是活的。只看端口会重复启动。
$snowProc = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*index.mjs*" })
if ($snowProc.Count -gt 0 -and -not (Test-Port 3000)) {
  Say ("SnowLuma 进程已在跑（" + $snowProc.Count + " 个）但 3000 未开 —— 多半是 QQ 掉线，去控制台扫码")
} elseif (-not (Test-Port 3000)) {
  $exe = Join-Path $snowDir 'node.exe'
  $main = Join-Path $snowDir 'index.mjs'
  if ((Test-Path $exe) -and (Test-Path $main)) {
    try {
      Start-Process -FilePath $exe -ArgumentList 'index.mjs' -WorkingDirectory $snowDir -WindowStyle Hidden -ErrorAction Stop
      Say '已启动 SnowLuma'
    } catch {
      Say ('SnowLuma 启动失败：' + $_.Exception.Message)
    }
  } else {
    Say ('找不到 SnowLuma：请先在 config.json 里填 snowluma.homeDir（当前值：' + $cfgSnow + '）')
  }
} else {
  Say 'SnowLuma 已在运行'
}

# ── 2. 语音识别 ────────────────────────────────────────────────────────────
if (-not (Test-Port 3199)) {
  $asrBat = Join-Path $repo 'start-asr.bat'
  if (Test-Path $asrBat) {
    try {
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"' + $asrBat + '"') -WorkingDirectory $repo -WindowStyle Hidden -ErrorAction Stop
      Say '已启动 语音识别'
    } catch {
      Say ('语音识别启动失败：' + $_.Exception.Message)
    }
  }
} else {
  Say '语音识别 已在运行'
}

# ── 3. 等面板起来 ──────────────────────────────────────────────────────────
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $res = Invoke-WebRequest -Uri 'http://127.0.0.1:3200/api/auth/status' -TimeoutSec 3 -UseBasicParsing
    if ($res.StatusCode -eq 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $ready) {
  Say '面板未就绪，桥接没起（先确认 3200 能打开）'
  exit 1
}

# ── 4. 桥接（走面板接口，带启动令牌）─────────────────────────────────────
$tok = ''
$tokFile = Join-Path $state 'panel-launch-token'
if (Test-Path $tokFile) { $tok = (Get-Content $tokFile -Raw).Trim() }
$headers = @{}
if ($tok) { $headers['x-launch-token'] = $tok }

if (-not (Test-Port 3100)) {
  try {
    $r = Invoke-WebRequest -Method POST -Uri 'http://127.0.0.1:3200/api/start?target=bridge' `
      -TimeoutSec 60 -UseBasicParsing -Headers $headers
    Say ('桥接：' + (($r.Content | ConvertFrom-Json).msg))
  } catch {
    Say ('桥接启动失败：' + $_.Exception.Message)
  }
} else {
  Say '桥接已在运行'
}

# ── 5. 汇总 ────────────────────────────────────────────────────────────────
Start-Sleep -Seconds 2
$status = @()
foreach ($p in @(@{ Port = 3000; Name = 'SnowLuma' }, @{ Port = 3100; Name = '桥接' }, @{ Port = 3199; Name = '语音识别' })) {
  if (Test-Port $p.Port) { $status += ($p.Name + '✅') } else { $status += ($p.Name + '❌') }
}
Say ('检查结果：' + ($status -join ' '))
