param(
  [string]$OutDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'audio'),
  [string]$LogFile = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'state\logs\tts-test.txt')
)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]
function Log($m) { $lines.Add($m); Write-Host $m }

Log ("==== 语音合成测试 {0} ====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Log ("PowerShell: {0}" -f $PSVersionTable.PSVersion)
Log ("用户: {0}" -f [System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
try {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object System.Security.Principal.WindowsPrincipal($id)
  Log ("是否管理员: {0}" -f $pr.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator))
} catch {}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Log ''
Log '--- 1. 已安装语音 ---'
try {
  Add-Type -AssemblyName System.Speech
  $probe = New-Object System.Speech.Synthesis.SpeechSynthesizer
  foreach ($v in $probe.GetInstalledVoices()) {
    $i = $v.VoiceInfo
    Log ("  {0} | {1} | {2} | enabled={3}" -f $i.Name, $i.Culture, $i.Gender, $v.Enabled)
  }
  $probe.Dispose()
} catch {
  Log ("  枚举失败: {0}" -f $_.Exception.Message)
}

Log ''
Log '--- 2. 合成测试（Huihui 中文女声，24kHz 16bit 单声道）---'
$clips = [ordered]@{
  '在的-说吧'    = '在的，说吧。'
  '行-搞定了'    = '行，搞定了。'
  '这个我得想想' = '这个我得想想。'
}
foreach ($name in $clips.Keys) {
  $path = Join-Path $OutDir ($name + '.wav')
  try {
    $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
      24000,
      [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
      [System.Speech.AudioFormat.AudioChannel]::Mono)
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoice('Microsoft Huihui Desktop')
    $s.Rate = 2
    $s.SetOutputToWaveFile($path, $fmt)
    $s.Speak($clips[$name])
    $s.Dispose()
    $f = Get-Item $path
    Log ("  OK {0}  {1:N1} KB" -f $f.Name, ($f.Length / 1KB))
  } catch {
    Log ("  FAIL {0}: {1}" -f $name, $_.Exception.Message)
  }
}

Log ''
Log '--- 3. 结果 ---'
$ok = @(Get-ChildItem $OutDir -Filter '*.wav' -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 1000 })
if ($ok.Count -gt 0) {
  Log ("成功生成 {0} 个音频 => 本地 TTS 可用，可以接入桥接发语音。" -f $ok.Count)
} else {
  Log '没有生成任何有效音频 => 本机 TTS 在这套权限下不可用，需要换方案（外部音频文件 / 云端 TTS）。'
}

[System.IO.File]::WriteAllLines($LogFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Log ''
Log ("日志已写入: {0}" -f $LogFile)
