param(
  [Parameter(Mandatory = $true)][string]$Target,
  [switch]$NoStart,
  [switch]$KeepOld
)

# 迁移脚本：把整套程序搬到新目录，并自动修正路径。
#
# 为什么要脚本：手工搬容易漏三件事——绝对路径、桌面快捷方式、旧进程没停。
# 这个脚本按顺序做完，最后自检"还有没有指向旧目录的绝对路径"。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File 迁移.ps1 -Target "D:\我的机器人"
#   powershell ... -NoStart        只搬不启动
#   powershell ... -KeepOld        保留旧目录（默认搬完会提示你手动删）
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcRoot = Split-Path -Parent $src          # 上一级（包含 qq-bridge 和 qq-bridge-adapt）
$target = $Target.TrimEnd('\')

if (-not (Test-Path $target)) { New-Item -ItemType Directory -Force -Path $target | Out-Null }

Write-Host "源: $srcRoot"
Write-Host "目标: $target"
Write-Host ''

# ── 1. 停服务（避免文件被占用）────────────────────────────────────────────
Write-Host '[1/5] 停止正在运行的服务…'
foreach ($port in 3000, 3100, 3199, 3200) {
  try {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  } catch {}
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$($src.Replace('\','\\'))*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# ── 2. 复制 ────────────────────────────────────────────────────────────────
Write-Host '[2/5] 复制文件…'
foreach ($dir in 'qq-bridge', 'qq-bridge-adapt') {
  $from = Join-Path $srcRoot $dir
  $to = Join-Path $target $dir
  if (-not (Test-Path $from)) { continue }
  $r = robocopy $from $to /E /NFL /NDL /NJH /NJS /R:1 /W:1
  Write-Host ("  {0} → {1}（退出码 {2}）" -f $from, $to, $LASTEXITCODE)
}

# ── 3. 修路径（相对路径已覆盖大部分，这里兜底替换残留绝对路径）───────────
Write-Host '[3/5] 检查并修正路径…'
$newBridge = Join-Path $target 'qq-bridge'
$patterns = @('*.json', '*.ps1', '*.bat', '*.vbs', '*.js')
$fixed = 0
Get-ChildItem $newBridge -Recurse -Include $patterns -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|tools\\ffmpeg' } |
  ForEach-Object {
    $text = Get-Content $_.FullName -Raw -Encoding UTF8
    if ($text -and $text.Contains($src)) {
      $text = $text.Replace($src, $newBridge)
      [System.IO.File]::WriteAllText($_.FullName, $text, (New-Object System.Text.UTF8Encoding($false)))
      $fixed += 1
      Write-Host ("  修正 {0}" -f $_.FullName.Replace($target, '.'))
    }
  }
Write-Host ("  共修正 {0} 个文件" -f $fixed)

# ── 4. 快捷方式 ────────────────────────────────────────────────────────────
Write-Host '[4/5] 更新桌面快捷方式…'
$desk = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desk '小鲸鱼.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $newBridge '静默启动.vbs'
$lnk.WorkingDirectory = $newBridge
$lnk.Description = '小鲸鱼控制台'
$lnk.IconLocation = 'C:\Windows\System32\imageres.dll,109'
$lnk.Save()
Write-Host ("  → {0}" -f $lnk.TargetPath)

# ── 5. 自检 + 启动 ─────────────────────────────────────────────────────────
Write-Host '[5/5] 自检…'
$bad = @()
Get-ChildItem $newBridge -Recurse -Include $patterns -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|tools\\ffmpeg' } |
  ForEach-Object {
    $t = Get-Content $_.FullName -Raw -Encoding UTF8
    if ($t -and $t.Contains($src)) { $bad += $_.FullName.Replace($target, '.') }
  }
if ($bad.Count -gt 0) {
  Write-Host '  ⚠ 还有文件引用旧路径：' -ForegroundColor Yellow
  $bad | ForEach-Object { Write-Host ("    " + $_) }
} else {
  Write-Host '  ✓ 没有残留旧路径' -ForegroundColor Green
}

if (-not $NoStart) {
  Write-Host '  启动新位置…'
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + (Join-Path $newBridge '静默启动.vbs') + '"')
}

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
Write-Host ("新位置: {0}" -f $newBridge)
Write-Host '账号、记忆、日志都在 state\ 里，已经一起搬过去了 —— 密码不用重设。'
if (-not $KeepOld) {
  Write-Host ("旧的 {0} 确认没问题后可以手动删掉。" -f $srcRoot)
}
