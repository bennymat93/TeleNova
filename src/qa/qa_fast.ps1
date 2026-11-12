# Focused pass after a small change: build -> fresh install -> acceptance, crawl (depth 2), playback, subtitles, live timing
$ErrorActionPreference = 'Continue'
$s = $PSScriptRoot
$R = 'C:\My Projects\novaTV Addon'
$K = "$env:APPDATA\Kodi"
$log = "$K\kodi.log"
function Section($t) { "`n########## $t  ($(Get-Date -Format 'HH:mm:ss'))" }
function Stop-KodiFully {
    Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
    for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
    Start-Sleep 3
}
Section 'static + unit tests'
"system CPU load: " + [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average + "%"
python -c "import ast,glob; fs=glob.glob(r'C:\My Projects\novaTV Addon\src\**\*.py',recursive=True); [ast.parse(open(f,encoding='utf-8').read(),f,feature_version=(3,8)) for f in fs]; print('py3.8 syntax ok:',len(fs))"
python "$s\undef.py" "$R\src"
python "$s\t_profiles.py" "$R\src\plugin.video.nova\resources\lib" | Select-Object -Last 1
python "$s\agentA\t.py" 2>&1 | Select-Object -Last 1
Push-Location "$R\src\qa\agentC"; python test_all.py 2>&1 | Select-Object -Last 1
foreach ($t in 'test_bots.py', 'test_rd.py') { "$t : " + ((python $t 2>&1 | Select-String '^(OK|FAILED)' | ForEach-Object { $_.Line }) -join ' ') }
Pop-Location
python "$R\src\qa\t_config.py" | Select-Object -Last 1
python "$R\src\qa\t_clip.py" | Select-Object -Last 1

Section 'stage + package'
& "$s\Clean-Build.ps1" -Root "$s\stage" -Src "$R\src" | Select-Object -Last 2
python "$R\src\tools\build_config.py" "$s\stage"
python "$s\addonsdb.py" "$s\stage" --fix | Select-Object -Last 1
python "$R\src\tools\package.py" "$s\stage"
"v14 guard inside the staged All_Subs: " + [bool](Select-String -Path "$s\stage\addons\service.subtitles.All_Subs\autosub.py" -Pattern 'BN guard v14' -Quiet)

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
for ($i = 0; $i -lt 80; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
"services ready after {0:N0}s" -f ((Get-Date) - $t0).TotalSeconds
Start-Sleep 40
Select-String -Path $log -Pattern 'device (detection|profile)|All_Subs guards|Loaded \d+ channels\.' | ForEach-Object { $_.Line.Substring(11, [Math]::Min(150, $_.Line.Length - 11)) } | Select-Object -First 5

Section 'acceptance'
python "$s\final_checks.py" 2>&1

Section 'crawl depth 2'
python "$s\crawl.py" 2 2 'plugin://plugin.video.nova/' 'plugin://plugin.video.telescope/' 2>&1 | Select-Object -Last 7

Section 'live channel timing'
python "$s\livetime.py" 2>&1

Section 'menu speed while a live stream plays (was 3-4 s)'
$n0 = (Get-Content $log).Count
python "$s\afterstop.py" 2>&1
Get-Content $log | Select-Object -Skip $n0 | Select-String -Pattern 'live stream - no|DarkSubs' | ForEach-Object { $_.Line.Substring(11, [Math]::Min(150, $_.Line.Length - 11)) } | Group-Object { $_ -replace '^\S+ T:\d+\s+', '' } | Select-Object -First 6 | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }

Section 'subtitle decisions on the three test videos'
foreach ($f in 'A_heb_code', 'B_und_named_hebrew', 'C_english_only') {
    $n0 = (Get-Content $log).Count
    "== $f"
    python "$s\play.py" "$s\vid\$f.mkv"
    Get-Content $log | Select-Object -Skip $n0 | Select-String -Pattern 'NovaTV\] subtitles|BN guard' | ForEach-Object { '   ' + $_.Line.Substring(11, [Math]::Min(150, $_.Line.Length - 11)) } | Select-Object -First 4
}

Section 'playback'
python "$s\playtest.py" 2>&1 | Select-Object -Last 16

Section 'log summary'
Select-String -Path $log -Pattern '^\s+(\w+Error|\w+Exception): |EXCEPTION:| (error|fatal) <general>: (?!.*(Misplaced|parsing boolean|unmatched parentheses|Control \d+ in window))' |
    ForEach-Object { ($_.Line -replace '^\S+ \S+ T:\d+\s+', '').Trim() -replace 'https?://\S+', '<url>' } |
    ForEach-Object { $_.Substring(0, [Math]::Min(150, $_.Length)) } | Group-Object | Sort-Object Count -Descending |
    Select-Object -First 20 | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }
Section 'done'
