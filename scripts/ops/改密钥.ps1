param(
  [switch]$DryRun,
  [switch]$KeepPanel
)

# 一键换开发者密钥：生成新的、写进 app.js、重启面板。
#
# 为什么做成脚本：密钥是硬编码常量（第 63 行），手改容易改错引号；
# 这个脚本按正则精确替换那一行，顺手重启面板让新密钥立即生效。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$appPath = Join-Path $repo 'app.js'
$keyFile = Join-Path $repo 'state\dev-key.txt'

if (-not (Test-Path $appPath)) { Write-Host "找不到 app.js" -ForegroundColor Red; exit 1 }

# 生成 12 位：大写字母 + 数字，去掉了容易看错的 0/O/1/I
$chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$newKey = -join (1..12 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })

$text = Get-Content $appPath -Raw -Encoding UTF8
$pattern = "const DEV_KEY = process\.env\.QQB_DEV_KEY \|\| '[^']*';"
if ($text -notmatch $pattern) {
  Write-Host '没找到 DEV_KEY 那一行（可能被改过），请手动编辑 app.js 第 63 行附近' -ForegroundColor Yellow
  exit 1
}
$old = [regex]::Match($text, $pattern).Value

Write-Host ''
Write-Host '当前：' -NoNewline; Write-Host $old -ForegroundColor DarkGray
Write-Host '新密钥：' -NoNewline; Write-Host $newKey -ForegroundColor Cyan
Write-Host ''

if ($DryRun) {
  Write-Host '（试运行，没有改动）' -ForegroundColor Yellow
  exit 0
}

$replacement = "const DEV_KEY = process.env.QQB_DEV_KEY || '$newKey';"
$updated = [regex]::Replace($text, $pattern, $replacement)
[System.IO.File]::WriteAllText($appPath, $updated, (New-Object System.Text.UTF8Encoding($false)))

# 记一份到 state（方便你以后查；不想留就删掉这个文件）
New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
Set-Content -Path $keyFile -Value $newKey -Encoding ASCII

Write-Host ("已写入 {0}" -f $appPath)
Write-Host ("已备份到 {0}" -f $keyFile) -ForegroundColor DarkGray

if (-not $KeepPanel) {
  Write-Host '重启面板…' -NoNewline
  try {
    Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 1200
    $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
    Start-Process -FilePath 'node' -ArgumentList 'app.js' -WorkingDirectory $repo -WindowStyle Hidden
    Start-Sleep -Seconds 4
    $ok = $false
    try {
      $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3200/api/auth/status' -UseBasicParsing -TimeoutSec 5
      $ok = $r.StatusCode -eq 200
    } catch {}
    if ($ok) { Write-Host ' ✓ 面板已重启' -ForegroundColor Green } else { Write-Host ' ✗ 面板没起来，看 state\panel.log' -ForegroundColor Red }
  } catch {
    Write-Host (' ✗ ' + $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host ''
Write-Host ('新的开发者密钥：' + $newKey) -ForegroundColor Cyan
Write-Host '下次进「开发者模式」时填这一串。' -ForegroundColor DarkGray
