# regression tests -> package -> update Kodi on this PC -> smoke test of the Telegram engine
$s = $PSScriptRoot
$R = 'C:\My Projects\novaTV Addon'
$K = Join-Path $env:APPDATA 'Kodi'
$log = Join-Path $K 'kodi.log'
$kodiExe = Join-Path $env:ProgramFiles 'Kodi\kodi.exe'
Push-Location (Join-Path $s 'agentC'); python test_all.py 2>&1 | Select-Object -Last 2; Pop-Location
python (Join-Path $s 'ige_test.py') | Select-Object -First 2
python -c "import ast,glob; [ast.parse(open(f,encoding='utf-8').read(),f,feature_version=(3,8)) for f in glob.glob(r'C:\My Projects\novaTV Addon\src\**\*.py',recursive=True)]; print('syntax ok')"
python (Join-Path $s 'undef.py') (Join-Path $R 'src')
& (Join-Path $s 'Clean-Build.ps1') -Root (Join-Path $s 'stage') -Src (Join-Path $R 'src') | Out-Null
python (Join-Path $R 'src\tools\build_config.py') (Join-Path $s 'stage')
python (Join-Path $s 'addonsdb.py') (Join-Path $s 'stage') --fix | Select-Object -Last 1
python (Join-Path $R 'src\tools\package.py') (Join-Path $s 'stage')
Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
Start-Sleep 3
& (Join-Path $s 'Clean-Build.ps1') -Root $K -Src (Join-Path $R 'src') | Out-Null
if (Test-Path $log) { Clear-Content $log }
Start-Process $kodiExe
for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
Start-Sleep 15
Select-String -Path $log -Pattern 'plugin\.video\.telescope' | ForEach-Object { $_.Line.Substring(11, [Math]::Min(150, $_.Line.Length - 11)) } | Select-Object -Last 3
python (Join-Path $s 'crawl.py') 1 2 'plugin://plugin.video.telescope/' 2>&1 | Select-Object -Last 5 | Select-Object -First 2
"windows errors: " + @(Select-String -Path $log -Pattern 'Traceback|EXCEPTION| error <general>: \[plugin').Count
