param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$Voice = 'zh-CN-XiaoyiNeural',
  [int]$Rate = 0,
  [string]$Pitch = ''
)

# 语音合成三级回退：Edge 神经语音（最自然） -> Piper（离线，偏成熟） -> Windows SAPI（老式拼接音）。
# 由 MCP 工具 qq_say 以用户权限调用。成功时打印一行： OK <engine> <最终文件路径> <字节数>
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot

$base = $OutFile
if ($base -match '\.(wav|mp3|ogg)$') { $base = ($base -replace '\.(wav|mp3|ogg)$', '') }
$dir = Split-Path -Parent $base
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$rateClamped = [Math]::Max(-10, [Math]::Min(10, $Rate))
# 实测选出来的"像正常人说话"的基准（用户 A/B 选定 D 方案）：
#   语速 -5%、音调 -3Hz —— 比原速松一点、低一点，不那么像播报。
$rateOffset = -5
$pitchHz = if ($Pitch) { $Pitch } else { '-3Hz' }
$rateValue = $rateOffset + ($rateClamped * 3)
$ratePct = '{0}{1}%' -f $(if ($rateValue -ge 0) { '+' } else { '-' }), ([Math]::Abs($rateValue))

# 1. Edge TTS（微软神经语音）
$edgeScript = Join-Path $repo 'src\tts-edge.mjs'
$tokenScript = Join-Path $repo 'tools\edge\edge_token.py'
if ((Test-Path $edgeScript) -and (Test-Path $tokenScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  # 由 PowerShell 自己调 python 算 token：比让 node 再 spawn python 稳（本机 node 的 spawn 偶发 EPERM）
  # 注意：不能用 `??`（PowerShell 7 才有），本脚本跑在 Windows PowerShell 5.1 下。
  $dshHome = $env:DSH_HOME
  if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
  $bundledPy = Join-Path $dshHome 'dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
  $pyCandidates = @($env:DSH_PYTHON, $bundledPy, 'python') | Where-Object { $_ }
  $py = $null
  foreach ($c in $pyCandidates) {
    try { & $c --version *> $null; if ($LASTEXITCODE -eq 0) { $py = $c; break } } catch {}
  }
  if ($py) {
    try {
      $token = (& $py $tokenScript 2>$null | Select-Object -Last 1).Trim()
      $ver = (& $py $tokenScript --version 2>$null | Select-Object -Last 1).Trim()
      if ($token -and $ver) {
        $mp3 = "$base.mp3"
        $null = & node $edgeScript --voice $Voice --out $mp3 --text $Text --rate $ratePct --pitch $pitchHz --token $token --version $ver 2>&1
        if ((Test-Path $mp3) -and ((Get-Item $mp3).Length -gt 1000)) {
          Write-Output ("OK edge {0} {1}" -f $mp3, (Get-Item $mp3).Length)
          exit 0
        }
      }
      Write-Output 'edge: no valid audio, fallback'
    } catch {
      Write-Output ("edge failed: {0}" -f $_.Exception.Message)
    }
  } else {
    Write-Output 'edge skipped: python not found'
  }
}

# 2. Piper 分支已移除（2026-10-25 精简）：Edge 不可用时直接退到 SAPI。
#    理由：Piper 占 60MB 模型 + 97MB 目录，实际只在断网时才会用到，声音还偏成熟。

# 3. Windows SAPI
$wav2 = "$base.wav"
try {
  Add-Type -AssemblyName System.Speech
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    24000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $s.SelectVoice('Microsoft Huihui Desktop') } catch {}
  $s.Rate = $rateClamped
  $s.SetOutputToWaveFile($wav2, $fmt)
  $s.Speak($Text)
  $s.Dispose()
  $f = Get-Item $wav2
  if ($f.Length -lt 1000) { throw "output too small: $($f.Length) bytes" }
  Write-Output ("OK sapi {0} {1}" -f $wav2, $f.Length)
  exit 0
} catch {
  Write-Error ("TTS failed: {0}" -f $_.Exception.Message)
  exit 1
}
