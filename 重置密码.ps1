<#
.SYNOPSIS
  重置普通账户密码为临时密码 00000，并提示用户登录后自己改。

.DESCRIPTION
  可用的前提（二选一，避免随便重置别人的号）：
    · 这个账户最近 15 分钟内有过一次登录失败；或者
    · 你是开发者，直接在面板「本地管理」里点「重置密码」
  （面板那边改，不需要失败记录 —— 这就是防死锁的出口）

  重置后密码固定为 00000，用户登录时面板会强制弹窗让他设新密码。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File 重置密码.ps1
  powershell -ExecutionPolicy Bypass -File 重置密码.ps1 -User zhangsan
#>
param(
  [string]$User = ''
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = 'http://127.0.0.1:3200'

Write-Host '=== 重置普通账户密码（临时密码 00000） ==='
Write-Host ''

try {
  $null = Invoke-WebRequest -Uri "$base/api/auth/status" -UseBasicParsing -TimeoutSec 5
} catch {
  Write-Host '✗ 面板没在运行（3200 连不上）' -ForegroundColor Red
  Write-Host '  先双击桌面「小鲸鱼」把面板起来' -ForegroundColor Yellow
  exit 1
}

if (-not $User) { $User = Read-Host '要重置哪个用户名' }
if (-not $User) { Write-Host '没填用户名，退出'; exit 1 }

# 本地先看一眼失败记录，只做提示
$ticketsPath = Join-Path $repo 'state\reset-tickets.json'
$hasTicket = $false
if (Test-Path $ticketsPath) {
  try {
    $tickets = Get-Content $ticketsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $rec = $tickets.$User
    if ($rec) {
      $mins = [math]::Round(((Get-Date) - [datetimeoffset]::FromUnixTimeMilliseconds([int64]$rec.at).LocalDateTime).TotalMinutes, 1)
      Write-Host ("  失败记录：" + $rec.count + ' 次，最近 ' + $mins + ' 分钟前')
      if ($mins -le 15) { $hasTicket = $true }
    }
  } catch {}
}

if (-not $hasTicket) {
  Write-Host ''
  Write-Host '✗ 这个账户最近没有登录失败记录，按规则不能重置。' -ForegroundColor Red
  Write-Host '  两个办法：' -ForegroundColor Yellow
  Write-Host '    1) 让他去登录页用错误密码试一次，再回来跑本脚本'
  Write-Host '    2) 开发者登录面板 → 设置 → 本地管理 → 对应账户「重置密码」（无需失败记录）'
  exit 1
}

try {
  $body = @{ user = $User } | ConvertTo-Json
  $res = Invoke-WebRequest -Uri "$base/api/auth/reset" -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
  $json = $res.Content | ConvertFrom-Json
  if ($json.ok) {
    Write-Host ''
    Write-Host ('✓ ' + $json.msg) -ForegroundColor Green
    Write-Host ("  用户名：" + $User)
    Write-Host ("  临时密码：" + $json.tempPassword) -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  下一步：让他用这个临时密码登录，面板会强制他设置新密码。'
    Write-Host '  没改之前，他进不去主界面（不会卡死：随时可以退出重登或再次重置）。'
  } else {
    Write-Host ('✗ ' + $json.msg) -ForegroundColor Red
  }
} catch {
  $msg = $_.Exception.Message
  try {
    $stream = $_.Exception.Response.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $detail = $reader.ReadToEnd() | ConvertFrom-Json
    if ($detail.msg) { $msg = $detail.msg }
  } catch {}
  Write-Host ('✗ ' + $msg) -ForegroundColor Red
}
