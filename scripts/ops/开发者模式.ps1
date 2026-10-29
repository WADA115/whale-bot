param(
  [switch]$Off
)

# 开发者模式开关（永久）。
#
# 面板里可以「永久停用」，但停用后开发者入口就进不去了，
# 所以恢复只能靠这个脚本（在电脑前、能打开文件夹的人才能操作）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File 开发者模式.ps1          激活
#   powershell -ExecutionPolicy Bypass -File 开发者模式.ps1 -Off     停用
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$file = Join-Path $repo 'state\dev-mode.json'
$activated = -not $Off

if (-not (Test-Path (Split-Path $file -Parent))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent) | Out-Null
}

$payload = [ordered]@{ activated = $activated; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$json = $payload | ConvertTo-Json
[System.IO.File]::WriteAllText($file, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))

if ($activated) {
  Write-Host '✓ 开发者模式已激活（永久）' -ForegroundColor Green
  Write-Host '  现在可以用密钥登录面板了'
} else {
  Write-Host '✓ 开发者模式已停用（永久）' -ForegroundColor Yellow
  Write-Host '  开发者入口将拒绝登录；再跑一次不带 -Off 即可恢复'
}
Write-Host ("  状态文件：" + $file)

# 顺手重启面板，让状态立刻生效
$pids = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique
if ($pids) {
  Write-Host '重启面板…' -NoNewline
  foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY', 'User')
  Start-Process -FilePath 'node' -ArgumentList 'app.js' -WorkingDirectory $repo -WindowStyle Hidden
  Start-Sleep -Seconds 4
  try {
    $null = Invoke-WebRequest -Uri 'http://127.0.0.1:3200/api/auth/status' -UseBasicParsing -TimeoutSec 5
    Write-Host ' ✓ 已生效'
  } catch {
    Write-Host ' ✗ 面板没起来，看 state\logs\panel.log'
  }
} else {
  Write-Host '  面板没在运行，下次启动时生效'
}
