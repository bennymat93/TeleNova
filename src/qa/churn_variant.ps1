# churn_variant.ps1 -Label x -Variant no15|no14|none  - edits the installed All_Subs autosub.py (Kodi stopped), runs the zapping test
param([string]$Label = '', [string]$Variant = 'none', [int]$Rounds = 2)
$s = $PSScriptRoot
$log = Join-Path $env:APPDATA 'Kodi\kodi.log'
$f = Join-Path $env:APPDATA 'Kodi\addons\service.subtitles.All_Subs\autosub.py'
$orig = Join-Path $s 'autosub_full_guards.py'
Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
Start-Sleep 3
if (-not (Test-Path $orig)) { Copy-Item $f $orig }
$t = [IO.File]::ReadAllText($orig)
if ($Variant -eq 'no15') {
    $t = $t.Replace('vidtime = _BN_PLAYER.getTime() if _BN_PLAYER.isPlayingVideo() else 0   # BN guard v15', 'vidtime = _BN_PLAYER.getTime()')
} elseif ($Variant -eq 'no14') {
    $t = $t.Replace('            if _bn_file and _bn_live():   # BN guard v14', '            if False:   # v14 call switched off for the test')
}
[IO.File]::WriteAllText($f, $t, (New-Object System.Text.UTF8Encoding($false)))
Get-ChildItem (Split-Path $f) -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Start-Process (Join-Path $env:ProgramFiles 'Kodi\kodi.exe')
Start-Sleep 8
for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
Start-Sleep 25
"=== $Label  (v15 lines: $(@(Select-String -Path $f -Pattern 'BN guard v15').Count), v14 call active: $([bool](Select-String -Path $f -Pattern 'if _bn_file and _bn_live\(\)' -Quiet)))"
python (Join-Path $s 'churn.py') $Rounds 2>&1 | Select-Object -Last 1
