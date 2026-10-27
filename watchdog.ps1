param(
  [int]$IntervalSec = 30,
  [switch]$Once
)

# 桥接守护：每 30 秒探一次 3100 端口，挂了就自动拉起。
#
# 设计要点：
#   · 单实例靠 state\watchdog.pid，内容为 "PID|安装目录"——迁移/多安装时不会互相误判；
#   · 存活状态靠 state\watchdog.beat（心跳），状态面板直接看文件时间，不查进程；
#   · 同一分钟内最多拉起一次，防止反复失败刷屏；
#   · DSH 端口变了不用管：桥接自己会探测并改写 config。
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$state = Join-Path $repo 'state'
$logDir = Join-Path $state 'logs'; if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }; $logFile = Join-Path $logDir 'watchdog.log'
$pidFile = Join-Path $state 'watchdog.pid'
$beatFile = Join-Path $state 'watchdog.beat'
$port = 3100

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
      if ($alive) {
        Write-Host ('已有守护进程在跑（PID ' + $oldPid + '），本实例退出')
        exit 0
      }
    }
  }
}
Set-Content -Path $pidFile -Value ($PID.ToString() + '|' + $repo) -Encoding UTF8
Write-Heartbeat
W ('守护启动（PID ' + $PID + '，间隔 ' + $IntervalSec + ' 秒）')

$restarts = 0
$lastRestartAt = $null

try {
  while ($true) {
    $up = Test-Port $port

    if (-not $up) {
      Start-Sleep -Seconds 3
      if (Test-Port $port) {
        W '端口短暂不通后恢复，不处理'
      } else {
        if ($lastRestartAt -and ((Get-Date) - $lastRestartAt).TotalSeconds -lt 60) {
          W '刚重启过，等待下一轮'
        } else {
          $restarts += 1
          $lastRestartAt = Get-Date
          W ('检测到桥接未运行，第 ' + $restarts + ' 次拉起')
          try {
            $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
            Start-Process -FilePath 'node' -ArgumentList 'src\bridge.js' `
              -WorkingDirectory $repo -WindowStyle Hidden -ErrorAction Stop
            Start-Sleep -Seconds 10
            if (Test-Port $port) { W '✓ 桥接已恢复' } else { W '✗ 拉起后仍不通（看 bridge.log）' }
          } catch {
            W ('✗ 拉起失败：' + $_.Exception.Message)
          }
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
