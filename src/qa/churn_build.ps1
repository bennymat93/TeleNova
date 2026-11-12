# churn_build.ps1 -Zip <build zip> -Label x -Runs 3   - fresh profile from a build zip, then the viewer-like zapping test N times
param([Parameter(Mandatory)][string]$Zip, [string]$Label = '', [int]$Runs = 3, [int]$Rounds = 2)
$s = $PSScriptRoot
$K = Join-Path $env:APPDATA 'Kodi'
$log = Join-Path $K 'kodi.log'
$exe = Join-Path $env:ProgramFiles 'Kodi\kodi.exe'
function Stop-K { Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force; for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }; Start-Sleep 3 }
function Start-K {
    if (Test-Path $log) { Clear-Content $log }
    Start-Process $exe; Start-Sleep 8
    for ($i = 0; $i -lt 70; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
    Start-Sleep 25
    python -c "import os,sys; sys.argv=['x','0','0']; exec(open(os.path.join(r'$s','crawl.py'),encoding='utf-8').read().split('# listing actions')[0]); rpc('Input.Back',None,10); rpc('Input.Back',None,10)" | Out-Null
    Start-Sleep 3
}
Stop-K
for ($n = 0; $n -lt 10 -and (Test-Path $K); $n++) { Remove-Item -LiteralPath $K -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path $K) { Start-Sleep 2 } }
New-Item -ItemType Directory -Force $K | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($Zip, $K)
"##### $Label  (build: $(Get-Content (Join-Path $K 'userdata\novatv_build.txt')))"
Start-K
Start-Sleep 70          # first start: the channel list has to be there
$hang = 0
for ($r = 1; $r -le $Runs; $r++) {
    if ($r -gt 1) { Stop-K; Start-K }
    $out = python (Join-Path $s 'churn.py') $Rounds 2>&1 | Select-Object -Last 1
    "run $r : $out"
    if ("$out" -match 'STOPPED') { $hang++ }
}
"RESULT $Label : $hang of $Runs runs froze"
