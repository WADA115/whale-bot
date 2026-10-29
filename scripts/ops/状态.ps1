param(
  [switch]$Logs,
  [int]$LogLines = 8
)

# 一站式状态检查：端口 / DSH 对齐 / 记忆 / 语境 / 配置开关 / 备份与守护 / 最近日志。
#
# 为什么单独做一个：功能多了以后，想确认"现在到底什么状态"要翻四五处
# （端口、config、memory.json、context.json、bridge.log）。这里一次打印完。
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$state = Join-Path $repo 'state'

function Line($label, $value, $ok) {
  $mark = if ($null -eq $ok) { '  ' } elseif ($ok) { '✅' } else { '❌' }
  Write-Host ("{0} {1,-14} {2}" -f $mark, $label, $value)
}

Write-Host "`n=== 服务 ===" -ForegroundColor Cyan
$ports = @(
  @{ Port = 3000; Name = 'SnowLuma' },
  @{ Port = 3100; Name = '桥接' },
  @{ Port = 3199; Name = '语音识别' }
)
foreach ($p in $ports) {
  $alive = $false
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $task = $client.ConnectAsync('127.0.0.1', $p.Port)
    $alive = $task.Wait(800) -and $client.Connected
    $client.Close()
  } catch {}
  Line $p.Name ("127.0.0.1:" + $p.Port) $alive
}

Write-Host "`n=== DSH 对齐 ===" -ForegroundColor Cyan
$cfgPath = Join-Path $repo 'config.json'
$cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$live = (node -e "console.log(require(process.argv[1]).dsh.baseUrl)" $cfgPath) 2>$null
Line 'config.dsh' $live ($null -ne $live)
$dshPort = ($live -replace '^https?://[^:]+:', '')
Line '端口' $dshPort $null

Write-Host "`n=== 记忆 ===" -ForegroundColor Cyan
$memPath = Join-Path $state 'memory.json'
if (Test-Path $memPath) {
  $m = Get-Content $memPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Line '设定' (($m.long.settings | Measure-Object).Count) $null
  Line '长期事实' (($m.long.facts | Measure-Object).Count) $null
  Line '短期事实' (($m.short.facts | Measure-Object).Count) $null
  Line '关键词' ((($m.long.keywords | Measure-Object).Count) + (($m.short.keywords | Measure-Object).Count)) $null
  Line '会话摘要' (($m.summaries.PSObject.Properties | Measure-Object).Count) $null
} else {
  Line 'memory.json' '不存在' $false
}

Write-Host "`n=== 语境 ===" -ForegroundColor Cyan
$ctxPath = Join-Path $state 'context.json'
if (Test-Path $ctxPath) {
  $c = Get-Content $ctxPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $convs = $c.convs.PSObject.Properties
  Line '会话数' ($convs | Measure-Object).Count $null
  foreach ($conv in $convs) {
    $topic = $conv.Value.topic
    if (-not $topic) { $topic = '（无）' }
    $turnCount = ($conv.Value.turns | Measure-Object).Count
    Line ('  ' + $conv.Name) (('{0} 条发言 / 话题：{1}' -f $turnCount, $topic)) $null
  }
} else {
  Line 'context.json' '不存在' $false
}

Write-Host "`n=== 配置开关 ===" -ForegroundColor Cyan
Line '群触发' $cfg.role.groupTrigger $null
Line '随机插话' ('{0:P0}' -f [double]$cfg.role.randomChimeProbability) $null
$expr = $cfg.role.expression
if ($expr -and $expr.enabled) {
  $exprText = '开（表情包 {0:P0} / 小黄脸 {1:P0}）' -f [double]$expr.stickerChance, [double]$expr.faceChance
  Line '表达层' $exprText $true
} else {
  Line '表达层' '关' $false
}
$safeText = '关'
if ($cfg.safety.enabled) { $safeText = '开' }
Line '内容审核' $safeText ([bool]$cfg.safety.enabled)
$memCfg = $cfg.role.memory
if ($memCfg.compress -ne $false) {
  Line '记忆压缩' ('开（超 ' + $memCfg.compressAfterTurns + ' 条触发）') $true
} else {
  Line '记忆压缩' '关' $false
}
$voiceText = '关'
if ($cfg.socialV2.voice.enabled) { $voiceText = '开' }
Line '语音' $voiceText $null

Write-Host "`n=== 备份与守护 ===" -ForegroundColor Cyan
$bkDir = Join-Path $state 'backup'
if (Test-Path $bkDir) {
  $days = Get-ChildItem $bkDir -Directory | Sort-Object Name -Descending
  $dayCount = ($days | Measure-Object).Count
  if ($dayCount -gt 0) {
    $latest = $days[0]
    $bkFiles = (Get-ChildItem $latest.FullName -File | Measure-Object).Count
    $bkSize = [math]::Round(((Get-ChildItem $latest.FullName -File | Measure-Object Length -Sum).Sum) / 1KB)
    Line '最近备份' ('{0}（{1} 个文件 / {2} KB）' -f $latest.Name, $bkFiles, $bkSize) $true
    Line '备份份数' $dayCount $null
  } else {
    Line '备份' '目录空' $false
  }
} else {
  Line '备份' '还没有（清理器首次运行后生成）' $null
}

# 守护存活靠心跳文件判断：watchdog.ps1 每轮刷新 state/watchdog.beat
$beatPath = Join-Path $state 'watchdog.beat'
$wdRunning = $false
$wdAge = -1
if (Test-Path $beatPath) {
  $wdAge = [int]((Get-Date) - (Get-Item $beatPath).LastWriteTime).TotalSeconds
  $wdRunning = $wdAge -lt 90
}
$wdStatus = '未运行（双击 守护.bat 启动）'
if ($wdRunning) { $wdStatus = '运行中（心跳 ' + $wdAge + ' 秒前）' }
elseif ($wdAge -ge 0) { $wdStatus = '疑似已停止（最后心跳 ' + $wdAge + ' 秒前）' }
Line '守护进程' $wdStatus $wdRunning

$wdLog = Join-Path $state 'watchdog.log'
if (Test-Path $wdLog) {
  $lastWd = Get-Content $wdLog -Encoding UTF8 -Tail 1
  if ($lastWd) { Line '  最近一次' $lastWd $null }
}

Write-Host "`n=== 最近日志 ===" -ForegroundColor Cyan
$logPath = Join-Path $state 'logs\bridge.log'
if (Test-Path $logPath) {
  Get-Content $logPath -Encoding UTF8 -Tail $LogLines | ForEach-Object {
    Write-Host ('  ' + $_.Substring(0, [Math]::Min(110, $_.Length)))
  }
} else {
  Write-Host '  （没有 bridge.log）'
}
Write-Host ''
