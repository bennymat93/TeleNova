# Runs the stress suite on a freshly started Kodi and keeps the session's log for analysis
$s = $PSScriptRoot
$K = Join-Path $env:APPDATA 'Kodi'
$log = Join-Path $K 'kodi.log'
& (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe') emu kill 2>&1 | Out-Null
Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
Start-Sleep 3
Start-Process (Join-Path $env:ProgramFiles 'Kodi\kodi.exe')
for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
Start-Sleep 30
"stress started $(Get-Date -Format 'HH:mm:ss')"
python (Join-Path $s 'stress.py') 2>&1 | Select-Object -Last 14
"stress ended $(Get-Date -Format 'HH:mm:ss') | kodi process: $([bool](Get-Process kodi -ErrorAction SilentlyContinue))"
Copy-Item $log (Join-Path $s 'kodi_stress.log') -Force
$c = Get-Content $log
"--- silent gaps over 8 s"
$prev = $null
foreach ($l in $c) {
    if ($l -match '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+') {
        $t = [datetime]$Matches[1]
        if ($prev -and ($t - $prev).TotalSeconds -gt 8) { "{0:HH:mm:ss} -> {1:HH:mm:ss}  ({2:N0}s)" -f $prev, $t, ($t - $prev).TotalSeconds }
        $prev = $t
    }
}
"--- dialogs opened"
$c | Select-String -Pattern 'Loading skin file: Dialog(OK|Confirm|Select|Busy|YesNo|Progress|Keyboard)' | ForEach-Object { $_.Line.Substring(11, [Math]::Min(120, $_.Line.Length - 11)) } | Group-Object { $_ -replace '^\S+ T:\d+\s+', '' } | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }
