# QA on the Kodi profile as it is (accounts stay connected): no build, no wipe, no fresh install.
# qa_all.ps1 deletes %APPDATA%\Kodi - never run it on a profile that holds a Telegram / Real-Debrid login.
$ErrorActionPreference = 'Continue'
$s = $PSScriptRoot
$log = "$env:APPDATA\Kodi\kodi.log"
function Section($t) { "`n########## $t  ($(Get-Date -Format 'HH:mm:ss'))" }
function Port-Ok { (python -c "import socket; s=socket.socket(); s.settimeout(3); print(s.connect_ex(('127.0.0.1',9090)))") -eq '0' }
# 6.5.1: the log from a byte offset, opened shared (Kodi holds it open). Get-Content of a 56 MB log took 37 s.
function Log-Since($off) {
    if (-not (Test-Path $log)) { return @() }
    $fs = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
    try {
        if ($off -gt $fs.Length) { $off = 0 }   # the log was rotated by a restart
        [void]$fs.Seek($off, 'Begin')
        $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
        ($sr.ReadToEnd()) -split "`r?`n"
    } finally { $fs.Dispose() }
}
$want = ([regex]'<addon id="plugin\.video\.nova"[^>]*?version="([^"]+)"').Match((Get-Content "$s\..\plugin.video.novaddon.xml" -Raw -Encoding UTF8)).Groups[1].Value
function Restart-Kodi {
    Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3
    Start-Process 'C:\Program Files\Kodi\kodi.exe'
    $t0 = Get-Date
    # 4.2.8: wait for a 'service ready' line of THIS start (the old log could still hold the previous one) and the port
    # 6.5.1: the hub writes its own line too ('[NovaTV] service ready <version>') - wait for both, then say which hub is up
    for ($i = 0; $i -lt 80; $i++) { Start-Sleep 3; if ((Test-Path $log) -and ((Get-Item $log).LastWriteTime -gt $t0) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet) -and (Select-String -Path $log -Pattern 'NovaTV\] service ready' -Quiet) -and (Port-Ok)) { break } }
    $hub = Select-String -Path $log -Pattern 'NovaTV\] service ready (\S+)' | Select-Object -Last 1
    if (-not $hub) { "WARN: no '[NovaTV] service ready' line after the restart - the hub service did not report" }
    elseif ($hub.Matches[0].Groups[1].Value -ne $want) { "WARN: hub service is $($hub.Matches[0].Groups[1].Value), the source is $want" }
    else { "hub service ready: $want" }
    Start-Sleep 25
}
if (-not (Get-Process kodi -ErrorAction SilentlyContinue) -or -not (Port-Ok)) { 'Kodi not answering - starting it'; Restart-Kodi }
$from = if (Test-Path $log) { (Get-Item $log).Length } else { 0 }
if ($from -gt 20MB) { "note: kodi.log is {0:N0} MB - restart Kodi when it is idle to rotate the log (this script does not do it)" -f ($from / 1MB) }

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
$lines = Log-Since $from
$audio = 'AESink|ActiveAE|WASAPI|DSERR_|audio renderer devices'
"audio-sink errors (no audio device, not the add-ons): " + @($lines | Select-String -Pattern $audio).Count
"python tracebacks: " + @($lines | Select-String -Pattern 'Traceback').Count
$lines | Select-String -Pattern '^\s+(\w+Error|\w+Exception): |EXCEPTION:| (error|fatal) <general>: (?!.*(Misplaced|parsing boolean|AESink|ActiveAE|WASAPI|DSERR_|audio renderer devices))' |
    ForEach-Object { ($_.Line -replace '^\S+ \S+ T:\d+\s+', '').Trim() } |
    ForEach-Object { $_.Substring(0, [Math]::Min(170, $_.Length)) } | Group-Object | Sort-Object Count -Descending |
    Select-Object -First 40 | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }
Section 'done'
