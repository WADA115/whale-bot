# 让 config.json 的 dsh.baseUrl 跟随「当前正在运行的 DSH」。
#
# 为什么要这一步：桌面版 DSH 每次启动会随机挑一个 127.0.0.1 端口（本机实测
# 0.2.1-rc.3 是 63554，而不是仓库默认假设的 3080），而桥接的会话 Cookie 名与
# 签名载荷都绑定 host:port（src/dsh-client.js 的 mintBrowserSessionCookie）——
# 端口对不上就是 401。所以在启动桥接前先把 baseUrl 对齐到实际端口。
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $repo 'config.json'

function Get-LiveDshUrl {
    if ($env:DSH_WEB_URL) { return $env:DSH_WEB_URL.TrimEnd('/') }

    foreach ($name in @('DeepSeek Harness', 'dsh')) {
        $ids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        if (-not $ids) { continue }
        $ports = @()
        foreach ($line in (& netstat -ano 2>$null | Select-String -Pattern 'LISTENING')) {
            $parts = ($line.ToString().Trim() -split '\s+')
            if ($parts.Count -lt 5) { continue }
            if ($ids -notcontains [int]$parts[4]) { continue }
            if ($parts[1] -notmatch '^(127\.0\.0\.1|0\.0\.0\.0):(\d+)$') { continue }
            $port = [int]$Matches[2]
            # 3000/3001 是 SnowLuma OneBot，3100 是桥接控制台，跳过
            if ($port -lt 1024 -or $port -eq 3000 -or $port -eq 3001 -or $port -eq 3100) { continue }
            $ports += $port
        }
        if ($ports.Count -gt 0) {
            $port = ($ports | Sort-Object -Unique | Select-Object -First 1)
            return "http://127.0.0.1:$port"
        }
    }
    return $null
}

$url = Get-LiveDshUrl
if (-not $url) {
    if (-not $Quiet) { Write-Warning '[sync-dsh-url] 未能探测到运行中的 DSH，config.json 保持不变（请确认 DSH 已启动）。' }
    exit 1
}

$text = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
$old = if ($text -match '"baseUrl"\s*:\s*"([^"]*)"') { $Matches[1] } else { '' }
if ($old -ne $url) {
    $text = $text -replace '("baseUrl"\s*:\s*")[^"]*(")', ('${1}' + $url + '${2}')
    [System.IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding($false)))
    if (-not $Quiet) { Write-Host "[sync-dsh-url] dsh.baseUrl: $old -> $url" }
} else {
    if (-not $Quiet) { Write-Host "[sync-dsh-url] dsh.baseUrl 已是最新: $url" }
}
exit 0
