<#
.SYNOPSIS
  同步 SnowLuma 的令牌到桥接配置，并重启桥接。

.DESCRIPTION
  SnowLuma 的 HTTP 服务器（3000）和 WebSocket 服务器（3001）用的是**两个不同的令牌**。
  以前桥接只存了一个，拿 HTTP 令牌去连 WS，会被拒：
      rejected unauthorized WebSocket upgrade
  这个脚本从 SnowLuma 的 onebot_<QQ>.json 里读出两个令牌，写进 config.json 的
  snowluma.accessToken（HTTP）和 snowluma.wsAccessToken（WS），再重启桥接。

  什么时候要跑：重装 SnowLuma、换 QQ 号、SnowLuma 重新生成令牌、或日志里又出现
  上面那行 rejected 的时候。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File 同步令牌.ps1
  powershell -ExecutionPolicy Bypass -File 同步令牌.ps1 -NoRestart
#>
param(
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $repo 'config.json'

if (-not (Test-Path $cfgPath)) { Write-Host '找不到 config.json' -ForegroundColor Red; exit 1 }

$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$snowDir = $cfg.snowluma.homeDir
if (-not $snowDir -or -not (Test-Path $snowDir)) {
  Write-Host ("SnowLuma 目录不存在：" + $snowDir) -ForegroundColor Red
  Write-Host '请先在 config.json 里改 snowluma.homeDir' -ForegroundColor Yellow
  exit 1
}

# 找 onebot_*.json（优先匹配 ownerQQ）
$ownerQQ = [string]$cfg.ownerQQ
$files = Get-ChildItem (Join-Path $snowDir 'config') -Filter 'onebot_*.json' -File -ErrorAction SilentlyContinue
if (-not $files) { Write-Host '没找到 SnowLuma 的 onebot_*.json' -ForegroundColor Red; exit 1 }

$pick = $files | Where-Object { $_.Name -like "*$ownerQQ*" } | Select-Object -First 1
if (-not $pick) { $pick = $files | Select-Object -First 1 }
Write-Host ("读取：" + $pick.FullName) -ForegroundColor DarkGray

$snow = Get-Content $pick.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
$httpTok = $snow.networks.httpServers[0].accessToken
$wsTok = $snow.networks.wsServers[0].accessToken

if (-not $httpTok -or -not $wsTok) {
  Write-Host 'SnowLuma 配置里没读到令牌（可能端口配置结构不同）' -ForegroundColor Red
  exit 1
}

$oldHttp = [string]$cfg.snowluma.accessToken
$oldWs = [string]$cfg.snowluma.wsAccessToken

Write-Host ''
Write-Host ("HTTP 令牌：" + $httpTok.Substring(0, [Math]::Min(8, $httpTok.Length)) + '…')
Write-Host ("WS   令牌：" + $wsTok.Substring(0, [Math]::Min(8, $wsTok.Length)) + '…')

$changed = ($oldHttp -ne $httpTok) -or ($oldWs -ne $wsTok)
if ($changed) {
  $cfg.snowluma.accessToken = $httpTok
  $cfg.snowluma.wsAccessToken = $wsTok
  $json = $cfg | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($cfgPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
  Write-Host '已写入 config.json（accessToken / wsAccessToken）' -ForegroundColor Green
} else {
  Write-Host '配置里的令牌已经一致，无需修改' -ForegroundColor DarkGray
}

if ($NoRestart) {
  Write-Host '跳过重启（-NoRestart）'
  exit 0
}

Write-Host '重启桥接…' -NoNewline
try {
  Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
  Start-Process -FilePath 'node' -ArgumentList 'src\bridge.js' -WorkingDirectory $repo -WindowStyle Hidden
  Start-Sleep -Seconds 8
  $log = Get-Content (Join-Path $repo 'state\logs\bridge.log') -Encoding UTF8 -Tail 12
  $ok = $log | Where-Object { $_ -like '*SnowLuma 已连接*' }
  if ($ok) { Write-Host ' ✓ 已连接' -ForegroundColor Green }
  else {
    Write-Host ' ✗ 还没连上' -ForegroundColor Red
    $log | Select-Object -Last 5 | ForEach-Object { Write-Host ('   ' + $_) -ForegroundColor DarkGray }
  }
} catch {
  Write-Host (' ✗ ' + $_.Exception.Message) -ForegroundColor Red
}
