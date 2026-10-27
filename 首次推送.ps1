param(
  [string]$Remote = '',
  [switch]$CommitOnly
)

# 第一次把项目推上 GitHub。
#
# 你还没有 GitHub 账号也没关系：这个脚本只做本地准备工作（git init / 提交），
# 等你注册好、建了仓库，再跑一次带 -Remote 的版本就能推上去。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File 首次推送.ps1
#   powershell -ExecutionPolicy Bypass -File 首次推送.ps1 -Remote "https://github.com/你的名字/deepseek_qq.bot.git"
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host '=== 1. 检查 git ==='
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Host '✗ 没装 git' -ForegroundColor Red
  Write-Host '  去 https://git-scm.com/download/win 下载安装，装完重开一个窗口再跑本脚本' -ForegroundColor Yellow
  exit 1
}
Write-Host ('  ✓ ' + (& git --version))

Set-Location $repo

Write-Host ''
Write-Host '=== 2. 本地仓库 ==='
if (Test-Path (Join-Path $repo '.git')) {
  Write-Host '  已经有 .git，跳过 init'
} else {
  & git init | Out-Null
  Write-Host '  ✓ git init'
}

# 确认 .gitignore 挡住了不该进仓库的东西
$ignore = Get-Content (Join-Path $repo '.gitignore') -Raw -Encoding UTF8
foreach ($need in 'state/', 'config.json', 'node_modules/') {
  if ($ignore -notmatch [regex]::Escape($need)) {
    Add-Content (Join-Path $repo '.gitignore') $need -Encoding UTF8
    Write-Host ('  + .gitignore 补了 ' + $need)
  }
}

Write-Host ''
Write-Host '=== 3. 提交 ==='
& git add -A
$status = & git status --porcelain
if (-not $status) {
  Write-Host '  没有改动，跳过提交'
} else {
  & git -c user.name='deepseek_qq.bot' -c user.email='bot@localhost' commit -m '初始化：小鲸鱼 QQ 机器人' | Out-Null
  Write-Host ('  ✓ 已提交 ' + (@($status).Count) + ' 个文件')
}

if ($CommitOnly) {
  Write-Host ''
  Write-Host '完成（只提交，不推送）。' -ForegroundColor Green
  exit 0
}

Write-Host ''
Write-Host '=== 4. 推送到 GitHub ==='
if (-not $Remote) {
  Write-Host '还没给远程地址，先看下面：' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  ① 注册 GitHub：https://github.com/signup'
  Write-Host '  ② 建仓库：https://github.com/new'
  Write-Host '     - Repository name 填 deepseek_qq.bot'
  Write-Host '     - 选 Public（要开源）'
  Write-Host '     - 不要勾 Add README / .gitignore / license（本地已有）'
  Write-Host '  ③ 复制仓库地址，重新跑：'
  Write-Host '     powershell -ExecutionPolicy Bypass -File 首次推送.ps1 -Remote "https://github.com/你的名字/deepseek_qq.bot.git"'
  Write-Host ''
  Write-Host '  首次推送会弹窗让你登录 GitHub（浏览器授权），跟着点就行。'
  exit 0
}

& git branch -M main
if (-not (& git remote)) { & git remote add origin $Remote }
else { & git remote set-url origin $Remote }
Write-Host ('  远程: ' + $Remote)

& git push -u origin main
if ($LASTEXITCODE -eq 0) {
  Write-Host ''
  Write-Host '✓ 推上去了。打开仓库页确认一下：' -ForegroundColor Green
  Write-Host ('  ' + ($Remote -replace '\.git$', ''))
  Write-Host ''
  Write-Host '顺手检查：'
  Write-Host '  - 首页 README 有没有正常显示（含截图）'
  Write-Host '  - 仓库里没有 state/ 和 config.json'
  Write-Host '  - LICENSE 里两行 Copyright 都在'
} else {
  Write-Host '✗ 推送失败，常见原因：' -ForegroundColor Red
  Write-Host '  - 仓库地址写错'
  Write-Host '  - 没登录（再跑一次会弹授权窗口）'
  Write-Host '  - 远程已有内容（建仓库时勾了 README），先 git pull --rebase origin main'
}
