param(
  [int]$IntervalSec = 30,
  [switch]$Once
)

# 守护：每 30 秒探一次 3100（桥接）和 3199（语音识别），挂了自动拉起。
#
# 设计要点（和旧版一致，只是多管一个服务）：
#   · 单实例靠 state\watchdog.pid，内容为 "PID|安装目录"
#   · 存活状态靠 state\watchdog.beat（心跳），面板直接看文件时间
#   · 每个服务独立退避：同一服务 60 秒内最多拉起一次，每小时最多 5 次
#   · 语音识别用 start-asr.bat /silent 拉起，脚本自己会找 Python 和依赖
#   · 失败原因写 state\logs\watchdog.log，不再静默

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$state = Join-Path $repo 'state'
$logDir = Join-Path $state 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'watchdog.log'
$pidFile = Join-Path $state 'watchdog.pid'
$beatFile = Join-Path $state 'watchdog.beat'

# SnowLuma 目录从 config.json 读；没配就跳过（不写死本机路径）
$snowDir = ''
try {
  $cfgPath = Join-Path $repo 'config.json'
  if (Test-Path $cfgPath) { $snowDir = (Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).snowluma.homeDir }
} catch {}
$lastSnowNote = [datetime]::MinValue
$snowProcPattern = '*index.mjs*'

New-Item -ItemType Directory -Force -Path $state | Out-Null

function W($msg) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'MM-dd HH:mm:ss'), $msg)
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Test-Port([int]$p) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $task = $client.ConnectAsync('127.0.0.1', $p)
    $ok = $task.Wait(800) -and $client.Connected
    $client.Close()
    return $ok
  } catch { return $false }
}

function Test-AsrHealth {
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3199/health' -TimeoutSec 2
    return ($r -and $r.ok -eq $true)
  } catch { return $false }
}

function Write-Heartbeat {
  try { Set-Content -Path $beatFile -Value (Get-Date -Format 'o') -Encoding ASCII } catch {}
}

# ── 单实例守卫（只认同一个安装目录 + 进程还活着）────────────────────────────
if (Test-Path $pidFile) {
  $raw = Get-Content $pidFile -Raw -ErrorAction SilentlyContinue
  if ($raw) {
    $parts = $raw.Trim() -split '\|'
    $oldPid = $parts[0]
    $oldRepo = ''
    if ($parts.Count -gt 1) { $oldRepo = $parts[1] }
    if ($oldPid -match '^\d+$' -and $oldRepo -eq $repo) {
      $alive = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
      $isWatchdog = $false
      if ($alive) {
        # PID 会被系统复用：必须确认命令行里真的有 watchdog.ps1，或心跳还很新
        try {
          $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$oldPid) -ErrorAction Stop
          if ($proc -and $proc.CommandLine -and $proc.CommandLine -like '*watchdog.ps1*') { $isWatchdog = $true }
        } catch {
          try {
            $age = (Get-Date) - (Get-Item $beatFile).LastWriteTime
            if ($age.TotalSeconds -lt 120) { $isWatchdog = $true }
          } catch {}
        }
      }
      if ($isWatchdog) {
        Write-Host ('已有守护进程在跑（PID ' + $oldPid + '），本实例退出')
        exit 0
      }
    }
  }
}
Set-Content -Path $pidFile -Value ($PID.ToString() + '|' + $repo) -Encoding UTF8
Write-Heartbeat
W ('守护启动（PID ' + $PID + '，间隔 ' + $IntervalSec + ' 秒）')

$services = @(
  @{ Name = 'bridge'; Port = 3100; Kind = 'bridge' },
  @{ Name = 'asr'; Port = 3199; Kind = 'asr' }
)
$restarts = @{}
$lastRestartAt = @{}
$hourWindow = @{}

function Can-Restart($name) {
  $now = Get-Date
  if ($lastRestartAt[$name] -and ($now - $lastRestartAt[$name]).TotalSeconds -lt 60) {
    return $false
  }
  $window = $hourWindow[$name]
  if (-not $window -or ($now - $window.Start).TotalHours -ge 1) {
    $hourWindow[$name] = @{ Start = $now; Count = 0 }
  }
  if ($hourWindow[$name].Count -ge 5) { return $false }
  return $true
}

function Start-ServiceByName($svc) {
  $name = $svc.Name
  $restarts[$name] = 1 + [int]($restarts[$name])
  $lastRestartAt[$name] = Get-Date
  if (-not $hourWindow[$name]) { $hourWindow[$name] = @{ Start = Get-Date; Count = 0 } }
  $hourWindow[$name].Count = 1 + [int]($hourWindow[$name].Count)

  W ('[' + $name + '] 检测到未运行，第 ' + $restarts[$name] + ' 次拉起')
  try {
    if ($svc.Kind -eq 'bridge') {
      $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
      Start-Process -FilePath 'node' -ArgumentList 'src\bridge.js' -WorkingDirectory $repo -WindowStyle Hidden -ErrorAction Stop
    } else {
      $bat = Join-Path $repo 'scripts\\ops\\start-asr.bat'
      if (-not (Test-Path $bat)) { throw '找不到 start-asr.bat' }
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"' + $bat + '" /silent') -WorkingDirectory $repo -WindowStyle Hidden -ErrorAction Stop
    }
    Start-Sleep -Seconds 10
    $ok = Test-Port $svc.Port
    if ($svc.Kind -eq 'asr' -and $ok) { $ok = Test-AsrHealth }
    if ($ok) { W ('[' + $name + '] ✓ 已恢复') }
    else { W ('[' + $name + '] ✗ 拉起后仍不通（看 state\logs\' + $name + '.log）') }
  } catch {
    W ('[' + $name + '] ✗ 拉起失败：' + $_.Exception.Message)
  }
}

function Get-SnowProc {
  if (-not $snowDir) { return @() }
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -eq (Join-Path $snowDir 'node.exe') -or
      ($_.CommandLine -and $_.CommandLine -like ('*' + $snowDir + '\index.mjs*'))
    })
}

function Start-SnowLuma {
  if (-not $snowDir) { W '[snowluma] 未配置 snowluma.homeDir，跳过'; return }
  $exe = Join-Path $snowDir 'node.exe'
  $main = Join-Path $snowDir 'index.mjs'
  if (-not (Test-Path $exe) -or -not (Test-Path $main)) { W ('[snowluma] 找不到 ' + $snowDir); return }
  try {
    Start-Process -FilePath $exe -ArgumentList 'index.mjs' -WorkingDirectory $snowDir -WindowStyle Hidden -ErrorAction Stop
    W '[snowluma] 检测到未运行，已拉起'
    Start-Sleep -Seconds 8
  } catch {
    W ('[snowluma] 拉起失败：' + $_.Exception.Message)
  }
}

try {
  while ($true) {
    # SnowLuma：进程不存在才拉起；进程在但 3000 不开，多半是 QQ 掉线，不重复启动
    if (-not (Test-Port 3000)) {
      $snowProcs = @(Get-SnowProc)
      if (-not $snowProcs.Count) {
        Start-SnowLuma
      } elseif (((Get-Date) - $lastSnowNote).TotalMinutes -ge 10) {
        $lastSnowNote = Get-Date
        W ('[snowluma] 进程在（' + $snowProcs.Count + ' 个）但 3000 未开，可能需要扫码')
      }
    }

    foreach ($svc in $services) {
      $name = $svc.Name
      $up = Test-Port $svc.Port
      if ($up -and $svc.Kind -eq 'asr') { $up = Test-AsrHealth }

      if (-not $up) {
        Start-Sleep -Seconds 3
        $up2 = Test-Port $svc.Port
        if ($up2 -and $svc.Kind -eq 'asr') { $up2 = Test-AsrHealth }
        if ($up2) {
          W ('[' + $name + '] 短暂不通后恢复，不处理')
        } elseif (-not (Can-Restart $name)) {
          W ('[' + $name + '] 刚重启过或超过每小时 5 次，等待下一轮')
        } else {
          Start-ServiceByName $svc
        }
      }
    }

    Write-Heartbeat
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSec
  }
} finally {
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
