# churn_run.ps1 "<label>" [setting=value ...]  - fresh Kodi start, optional settings, rapid zapping, verdict
param([string]$Label = 'as is', [string[]]$Set = @(), [int]$Rounds = 2)
$s = $PSScriptRoot
$log = Join-Path $env:APPDATA 'Kodi\kodi.log'
Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
Start-Sleep 3
Start-Process (Join-Path $env:ProgramFiles 'Kodi\kodi.exe')
Start-Sleep 8
for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
Start-Sleep 25
"=== $Label"
python (Join-Path $s 'churn.py') $Rounds @Set 2>&1 | Select-Object -Last 4
$p = Get-Process kodi -ErrorAction SilentlyContinue
if ($p) { "kodi responding: $($p.Responding)" } else { 'kodi process gone' }
