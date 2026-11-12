# QA on the Kodi profile as it is (accounts stay connected): no build, no wipe, no fresh install.
# qa_all.ps1 deletes %APPDATA%\Kodi - never run it on a profile that holds a Telegram / Real-Debrid login.
$ErrorActionPreference = 'Continue'
$s = $PSScriptRoot
$log = "$env:APPDATA\Kodi\kodi.log"
function Section($t) { "`n########## $t  ($(Get-Date -Format 'HH:mm:ss'))" }
function Port-Ok { (python -c "import socket; s=socket.socket(); s.settimeout(3); print(s.connect_ex(('127.0.0.1',9090)))") -eq '0' }
function Restart-Kodi {
    Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3
    Start-Process 'C:\Program Files\Kodi\kodi.exe'
    for ($i = 0; $i -lt 80; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
    Start-Sleep 25
}
if (-not (Get-Process kodi -ErrorAction SilentlyContinue) -or -not (Port-Ok)) { 'Kodi not answering - starting it'; Restart-Kodi }
$from = @(Get-Content $log).Count

Section 'acceptance checks'
python "$s\final_checks.py" 2>&1
Section 'crawl depth 3'
python "$s\crawl.py" 3 2 'plugin://plugin.video.nova/' 'plugin://plugin.video.telescope/' 2>&1 | Select-Object -Last 30
Section 'playback'
if (-not (Port-Ok)) { 'port dead - restarting Kodi'; Restart-Kodi; $from = 0 }
python "$s\playtest.py" 2>&1 | Select-Object -Last 16
Section 'stress'
if (-not (Port-Ok)) { 'port dead - restarting Kodi'; Restart-Kodi; $from = 0 }
python "$s\stress.py" 2>&1 | Select-Object -Last 30
"kodi process alive: " + [bool](Get-Process kodi -ErrorAction SilentlyContinue) + " | port: $(Port-Ok)"

Section 'log summary (this run only)'
$lines = Get-Content $log | Select-Object -Skip $from
"python tracebacks: " + @($lines | Select-String -Pattern 'Traceback').Count
$lines | Select-String -Pattern '^\s+(\w+Error|\w+Exception): |EXCEPTION:| (error|fatal) <general>: (?!.*(Misplaced|parsing boolean))' |
    ForEach-Object { ($_.Line -replace '^\S+ \S+ T:\d+\s+', '').Trim() } |
    ForEach-Object { $_.Substring(0, [Math]::Min(170, $_.Length)) } | Group-Object | Sort-Object Count -Descending |
    Select-Object -First 40 | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }
Section 'done'
