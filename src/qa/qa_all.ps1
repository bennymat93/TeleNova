# One pass: static checks -> stage -> package -> fresh install -> every QA suite -> log summary
$ErrorActionPreference = 'Continue'
$s = $PSScriptRoot
$R = 'C:\My Projects\novaTV Addon'
$K = "$env:APPDATA\Kodi"
$log = "$K\kodi.log"
function Section($t) { "`n########## $t  ($(Get-Date -Format 'HH:mm:ss'))" }
function Wait-Kodi {
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep 3
        if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break }
    }
}
function Stop-KodiFully {
    Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
    for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
    Start-Sleep 3
}
function Port-Ok { (python -c "import socket; s=socket.socket(); s.settimeout(3); print(s.connect_ex(('127.0.0.1',9090)))") -eq '0' }
function Restart-Kodi {
    Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep 3
    Start-Process 'C:\Program Files\Kodi\kodi.exe'
    Start-Sleep 5
    Wait-Kodi
    Start-Sleep 25
}

if (-not $env:QA_SKIP_BUILD) {
Section 'static'
python -c "import ast,glob; fs=glob.glob(r'C:\My Projects\novaTV Addon\src\**\*.py',recursive=True); [ast.parse(open(f,encoding='utf-8').read(),f,feature_version=(3,8)) for f in fs]; print('py3.8 syntax ok:',len(fs))"
python "$s\undef.py" "$R\src"
python "$s\t_profiles.py" "$R\src\plugin.video.nova\resources\lib" | Select-Object -Last 1
python "$s\agentA\t.py" 2>&1 | Select-Object -Last 1
python "$s\agentB\test_preset.py" "$R\src\plugin.video.nova" 2>&1 | Select-Object -Last 1
Push-Location "$s\agentC"; python test_all.py 2>&1 | Select-Object -Last 4; Pop-Location

Section 'stage + package'
& "$s\Clean-Build.ps1" -Root "$s\stage" -Src "$R\src" | Select-Object -Last 2
python "$R\src\tools\build_config.py" "$s\stage"
python "$s\addonsdb.py" "$s\stage" --fix | Select-Object -Last 1
python "$R\src\tools\package.py" "$s\stage"
python "$s\wizard_test.py" $R $s 2>&1 | Select-Object -Last 1

}
Section 'fresh install'
Stop-KodiFully
for ($n = 0; $n -lt 10 -and (Test-Path $K); $n++) { Remove-Item -LiteralPath $K -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path $K) { Start-Sleep 2 } }
if (Test-Path $K) { throw 'could not remove the old Kodi profile' }
$info = Get-Content "$R\build.json" -Raw | ConvertFrom-Json
$zip = "$s\final-build.zip"
$out = [IO.File]::Create($zip)
foreach ($u in $info.parts) { $in = [IO.File]::OpenRead("$R\build\" + ($u -split '/')[-1]); $in.CopyTo($out); $in.Close() }
$out.Close()
"sha256 matches build.json: " + ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -eq $info.sha256)
New-Item -ItemType Directory -Force $K | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($zip, $K)
$t0 = Get-Date
Start-Process 'C:\Program Files\Kodi\kodi.exe'
Wait-Kodi
"services ready after {0:N0}s" -f ((Get-Date) - $t0).TotalSeconds
Start-Sleep 40
Select-String -Path $log -Pattern '\[NovaTV\]|\[plugin\.video\.telescope\]|Loaded \d+ channels\.' | ForEach-Object { $_.Line.Substring(11, [Math]::Min(190, $_.Line.Length - 11)) } | Select-Object -First 25
"control port answering: $(Port-Ok)"

Section 'acceptance checks'
python "$s\final_checks.py" 2>&1

Section 'crawl depth 3'
python "$s\crawl.py" 3 2 'plugin://plugin.video.nova/' 'plugin://plugin.video.telescope/' 2>&1 | Select-Object -Last 14

Section 'playback'
if (-not (Port-Ok)) { 'port dead - restarting Kodi'; Restart-Kodi }
python "$s\playtest.py" 2>&1 | Select-Object -Last 16

Section 'stress'
if (-not (Port-Ok)) { 'port dead - restarting Kodi'; Restart-Kodi }
python "$s\stress.py" 2>&1 | Select-Object -Last 30
"kodi process alive: " + [bool](Get-Process kodi -ErrorAction SilentlyContinue) + " | port: $(Port-Ok)"

Section 'log summary'
"python tracebacks: " + @(Select-String -Path $log -Pattern 'Traceback').Count
Select-String -Path $log -Pattern '^\s+(\w+Error|\w+Exception): |EXCEPTION:| (error|fatal) <general>: (?!.*(Misplaced|parsing boolean))' |
    ForEach-Object { ($_.Line -replace '^\S+ \S+ T:\d+\s+', '').Trim() } |
    ForEach-Object { $_.Substring(0, [Math]::Min(170, $_.Length)) } | Group-Object | Sort-Object Count -Descending |
    Select-Object -First 40 | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }
Section 'idle 11.5 min + clean exit'
Stop-KodiFully
if (Test-Path $log) { Move-Item -LiteralPath $log -Destination (Join-Path $s 'kodi_stress.log') -Force }   # kept: the stress session's log
Start-Process 'C:\Program Files\Kodi\kodi.exe'
Start-Sleep 690
$p = Get-Process kodi -ErrorAction SilentlyContinue
if ($p) { "after idle: mem {0} MB, cpu {1:N0}s, threads {2}" -f [int]($p.WorkingSet64 / 1MB), $p.CPU, $p.Threads.Count } else { 'KODI DIED DURING IDLE' }
"errors / warnings while idle (deduped):"
Select-String -Path $log -Pattern ' (error|warning|fatal) <|Traceback|EXCEPTION' |
    ForEach-Object { ($_.Line -replace '^\S+ \S+ T:\d+\s+', '') } |
    Where-Object { $_ -notmatch 'Misplaced|parsing boolean|xbmc_context_ui|OutputControlPort|SettingList|inputstream\.(rtmp|ffmpegdirect)' } |
    Group-Object | Sort-Object Count -Descending | Select-Object -First 15 |
    ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name.Substring(0, [Math]::Min(180, $_.Name.Length)) }
Select-String -Path $log -Pattern '\[NovaTV\]|\[plugin\.video\.telescope\]' | ForEach-Object { $_.Line.Substring(11, [Math]::Min(150, $_.Line.Length - 11)) } | Select-Object -First 20
$q = Get-Date
python "$s\quit.py"
for ($i = 0; $i -lt 60; $i++) { if (-not (Get-Process kodi -ErrorAction SilentlyContinue)) { break }; Start-Sleep 1 }
"kodi exited after {0:N0}s (still running: {1})" -f ((Get-Date) - $q).TotalSeconds, [bool](Get-Process kodi -ErrorAction SilentlyContinue)
Start-Process 'C:\Program Files\Kodi\kodi.exe'
Section 'done'
