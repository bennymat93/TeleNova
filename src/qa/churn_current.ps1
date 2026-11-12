# packages the current sources and runs the zapping test N times on a fresh install of that package
param([int]$Runs = 4, [string[]]$Mode = @())
$s = $PSScriptRoot
$R = 'C:\My Projects\novaTV Addon'
Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='python.exe' OR Name='python3.13.exe'" | Where-Object { $_.CommandLine -match 'churn_build|churn\.py' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
& (Join-Path $s 'Clean-Build.ps1') -Root (Join-Path $s 'stage') -Src (Join-Path $R 'src') | Select-Object -Last 2 | Select-Object -First 1
python (Join-Path $R 'src\tools\build_config.py') (Join-Path $s 'stage')
python (Join-Path $s 'addonsdb.py') (Join-Path $s 'stage') --fix | Select-Object -Last 1
python (Join-Path $R 'src\tools\package.py') (Join-Path $s 'stage') | Select-Object -Last 1
$info = Get-Content (Join-Path $R 'build.json') -Raw | ConvertFrom-Json
$zip = Join-Path $s 'final-build.zip'
Copy-Item (Join-Path $R ('build\' + ($info.parts[0] -split '/')[-1])) $zip -Force
$K = Join-Path $env:APPDATA 'Kodi'
$log = Join-Path $K 'kodi.log'
$exe = Join-Path $env:ProgramFiles 'Kodi\kodi.exe'
function Stop-K { Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force; for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }; Start-Sleep 3 }
function Start-K {
    if (Test-Path $log) { Clear-Content $log }
    Start-Process $exe; Start-Sleep 8
    for ($i = 0; $i -lt 70; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
    Start-Sleep 25
}
Stop-K
for ($n = 0; $n -lt 10 -and (Test-Path $K); $n++) { Remove-Item -LiteralPath $K -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path $K) { Start-Sleep 2 } }
New-Item -ItemType Directory -Force $K | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($zip, $K)
"##### current build $(Get-Content (Join-Path $K 'userdata\novatv_build.txt'))  mode: $($Mode -join ' ')"
Start-K
Start-Sleep 50
$hang = 0
for ($r = 1; $r -le $Runs; $r++) {
    if ($r -gt 1) { Stop-K; Start-K }
    $out = python (Join-Path $s 'churn.py') 2 @Mode 2>&1 | Select-Object -Last 1
    "run $r : $out"
    if ("$out" -match 'STOPPED') { $hang++ }
}
"RESULT: $hang of $Runs runs froze"
