# churn_n.ps1 -Runs 4 [-Mode raw]   - the zapping test N times on the installed build, fresh Kodi start each time;
# the log of a run that froze is kept as kodi_frozen.log
param([int]$Runs = 4, [string[]]$Mode = @())
$s = $PSScriptRoot
$log = Join-Path $env:APPDATA 'Kodi\kodi.log'
$exe = Join-Path $env:ProgramFiles 'Kodi\kodi.exe'
$hang = 0
for ($r = 1; $r -le $Runs; $r++) {
    Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
    for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
    Start-Sleep 3
    if (Test-Path $log) { Clear-Content $log }
    Start-Process $exe; Start-Sleep 8
    for ($i = 0; $i -lt 70; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
    Start-Sleep 25
    $out = python (Join-Path $s 'churn.py') 2 @Mode 2>&1 | Select-Object -Last 1
    "run $r : $out"
    if ("$out" -match 'STOPPED') { $hang++; Copy-Item $log (Join-Path $s 'kodi_frozen.log') -Force }
}
"RESULT ($($Mode -join ' ')): $hang of $Runs runs froze"
