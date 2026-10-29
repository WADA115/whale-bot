<#
.SYNOPSIS
  打包一份可以开源 / 交给别人部署的源码目录。

.DESCRIPTION
  只复制源码与文档，排除：node_modules、tools 里的二进制、state、日志、音频、备份。
  同时把 config.json 脱敏成 config.example.json（去掉 QQ 号、密钥、绝对路径）。
  产物在 ..\release\qq-bridge-<日期>\，可以直接 git init 推上去。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File 开源打包.ps1
  powershell -ExecutionPolicy Bypass -File 开源打包.ps1 -Out "D:\publish"
#>
param(
  [string]$Out = '',
  [switch]$IncludeTools
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format 'yyyyMMdd'
if (-not $Out) { $Out = Join-Path (Split-Path -Parent $repo) "release\qq-bridge-$stamp" }
$Out = $Out.TrimEnd('\')

Write-Host "源: $repo"
Write-Host "输出: $Out"
Write-Host ''

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# ── 1. 复制源码（排除运行时产物）────────────────────────────────────────
Write-Host '[1/4] 复制源码…'
$excludeDirs = @('node_modules', '.git', 'state', 'audio', '.npm-cache', 'release')
if (-not $IncludeTools) { $excludeDirs += 'tools' }

$xd = $excludeDirs | ForEach-Object { "/XD"; $_ }
$xf = @('/XF', 'config.json', '*.log', '*.bak', '*.bak-*', '.env', 'dev-key.txt',
        '开源打包.ps1', '*.docx', '小鲸鱼报告.*', '会话时间线报告.*', '功能报告.*',
        '语音测试结果.txt', '语音测试-沙箱结果.txt', '_snowluma-catalog.json', '项目报告.*', '历史报告*', '*报告*.md', '*报告*.docx', '*报告*.html')

$args = @($repo, $Out, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1') + $xd + $xf
$null = robocopy @args
Write-Host ("  完成（robocopy 退出码 $LASTEXITCODE）")
if (-not $IncludeTools) { Write-Host '  已排除 tools\（ffmpeg / ASR 模型，部署时另行下载）' }

# ── 2. 生成脱敏的 config.example.json ───────────────────────────────────
Write-Host '[2/4] 生成 config.example.json…'
$cfgPath = Join-Path $repo 'config.json'
if (Test-Path $cfgPath) {
  $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  # 抹掉身份信息与密钥
  $cfg.ownerQQ = 0
  $cfg.allow.private = @()
  $cfg.allow.groups = @()
  if ($cfg.role) { $cfg.role.developers = @() }
  if ($cfg.webSearch) { $cfg.webSearch.apiKey = '' }
  if ($cfg.snowluma) {
    $cfg.snowluma.homeDir = ''
    $cfg.snowluma.launcherPath = ''
    $cfg.snowluma.accessToken = ''
  if ($cfg.snowluma.PSObject.Properties['wsAccessToken']) { $cfg.snowluma.wsAccessToken = '' }
  }
  if ($cfg.socialV2.voice) { $cfg.socialV2.voice.ffmpegPath = 'tools/ffmpeg/ffmpeg.exe' }
  if ($cfg.socialV2.video) { $cfg.socialV2.video.ffmpegPath = 'tools/ffmpeg/ffmpeg.exe' }
  $cfg.dsh.baseUrl = 'http://127.0.0.1:3000'

  $json = $cfg | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText((Join-Path $Out 'config.example.json'), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
  Write-Host '  已生成（QQ 号/群号/令牌/密钥已清空）'
} else {
  Write-Host '  ⚠ 没找到 config.json，跳过'
}

# ── 3. 附带开源说明 ─────────────────────────────────────────────────────
Write-Host '[3/4] 写开源说明…'
if (Test-Path (Join-Path $repo 'README.md')) {
  Write-Host '  已有 README.md，跳过生成 README.opensource.md'
} else {
$readme = @'
# 小鲸鱼 QQ 机器人（deepseek_qq.bot）

QQ 机器人 + 本地/服务器控制台。基于 Node.js、DSH（DeepSeek Harness）与 OneBot v11。

## 组成

| 模块 | 文件 | 作用 |
| --- | --- | --- |
| 控制台 | `app.js` + `public/` | 网页面板（3200）+ SnowLuma 内嵌反代（5098） |
| 桥接 | `src/bridge.js` | QQ ↔ DSH，负责收发、记忆、语境、表达 |
| 记忆 | `src/memory-core.js` | 长期/短期/摘要，去重与晋升 |
| 语境 | `src/context-engine.js` | 在场人、话题、待回应 |
| 表达 | `src/expression.js` | 润色、情绪、挑表情 |
| 审核 | `src/content-filter.js` | 出站内容过滤 |
| 画图 | `src/sketch.py` | 简笔画渲染（Pillow） |

## 快速开始

1. 装 Node.js ≥ 20
2. `npm install`
3. 复制 `config.example.json` 为 `config.json`，填：
   - `ownerQQ`（你的 QQ）
   - `allow.private` / `allow.groups`（谁能用）
   - `snowluma.homeDir`（SnowLuma 安装目录）
   - `dsh.baseUrl`（DSH 地址）
4. 准备 `tools/`：ffmpeg、ASR 模型（见 `docs/服务器部署.md`）
5. 启动：`node app.js`（面板）与 `node src/bridge.js`（桥接）
6. 打开 `http://127.0.0.1:3200` → 注册开发者账户

## 开发者密钥

不写在代码里。优先级：环境变量 `QQB_DEV_KEY` → `state/dev-key.txt` → 首次运行自动生成。

## 安全默认

- 面板只监听 `127.0.0.1`，来源 IP 白名单
- 未登录只能看登录页，写接口要求开发者会话
- 密码 scrypt + 随机盐，登录限速 5 次/分钟
- 日志 IP 脱敏
- 出站内容审核

## 依赖与版权

本项目 MIT。依赖：SnowLuma（QQ 网关，Windows only）、OneBot v11 实现、ffmpeg（LGPL/GPL）、
sherpa-onnx（Apache-2.0）、Edge TTS、Pillow。再分发请遵守各自许可证。

## 免责声明

见 `免责声明.md`：AI 内容不保证正确、聊天记录明文存本机、API 费用自付、第三方组件版权归各自作者。
'@
[System.IO.File]::WriteAllText((Join-Path $Out 'README.opensource.md'), $readme, (New-Object System.Text.UTF8Encoding($false)))
Write-Host '  已写 README.opensource.md'
}

# ── 4. 检查有没有漏网的敏感信息 ─────────────────────────────────────────
Write-Host '[4/4] 扫描敏感信息…'
$bad = @()
Get-ChildItem $Out -Recurse -Include *.json, *.js, *.md, *.ps1, *.bat -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    $t = Get-Content $_.FullName -Raw -Encoding UTF8
    # 扫描规则从 config 里取 ownerQQ，不把号码写死在脚本里
    $ownerQQ = ''
    $cfgScan = Join-Path $repo 'config.json'
    if (Test-Path $cfgScan) {
      try { $ownerQQ = [string](Get-Content $cfgScan -Raw -Encoding UTF8 | ConvertFrom-Json).ownerQQ } catch {}
    }
    $ownerHit = $ownerQQ -and $ownerQQ.Length -ge 5 -and $t.Contains($ownerQQ)
    if ($t -match 'sk-[a-f0-9]{20,}' -or $ownerHit) {
      $bad += $_.FullName.Replace($Out, '.')
    }
  }
if ($bad.Count) {
  Write-Host '  ⚠ 这些文件里还有敏感串，发之前处理掉：' -ForegroundColor Yellow
  $bad | ForEach-Object { Write-Host ('    ' + $_) }
} else {
  Write-Host '  ✓ 没发现 API key / QQ 号 / 开发者密钥' -ForegroundColor Green
}

Write-Host ''
Write-Host '完成。' -ForegroundColor Green
Write-Host "产物: $Out"
Write-Host '下一步：'
Write-Host ('  cd "' + $Out + '"')
Write-Host '  git init && git add . && git commit -m "init"'
