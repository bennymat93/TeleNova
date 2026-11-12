# churn_addon.ps1 "<label>" -Disable id1,id2   - fresh Kodi, switch add-ons off, rapid zapping, switch them back on
param([string]$Label = '', [string[]]$Disable = @(), [int]$Rounds = 2)
$s = $PSScriptRoot
$log = Join-Path $env:APPDATA 'Kodi\kodi.log'
function Toggle($ids, $on) {
    foreach ($a in $ids) {
        $env:TN_AID = $a; $env:TN_ON = [string]$on
        python -c "import os,sys; sys.argv=['x','0','0']; exec(open(os.path.join(r'$s','crawl.py'),encoding='utf-8').read().split('# listing actions')[0]); print(os.environ['TN_AID'], '->', os.environ['TN_ON'], rpc('Addons.SetAddonEnabled',{'addonid':os.environ['TN_AID'],'enabled':os.environ['TN_ON']=='True'},20).get('result'))"
    }
}
Get-Process kodi -ErrorAction SilentlyContinue | Stop-Process -Force
for ($n = 0; $n -lt 30 -and (Get-Process kodi -ErrorAction SilentlyContinue); $n++) { Start-Sleep 1 }
Start-Sleep 3
Start-Process (Join-Path $env:ProgramFiles 'Kodi\kodi.exe')
Start-Sleep 8
for ($i = 0; $i -lt 60; $i++) { Start-Sleep 3; if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'telescope\] service ready' -Quiet)) { break } }
Start-Sleep 20
"=== $Label"
Toggle $Disable $false
Start-Sleep 5
python (Join-Path $s 'churn.py') $Rounds 2>&1 | Select-Object -Last 2
$p = Get-Process kodi -ErrorAction SilentlyContinue
"kodi responding: $($p.Responding)"
if ($p.Responding) { Toggle $Disable $true } else {
    # a hung Kodi cannot switch them back: restart and re-enable
    $p | Stop-Process -Force; Start-Sleep 4
    Start-Process (Join-Path $env:ProgramFiles 'Kodi\kodi.exe'); Start-Sleep 60
    Toggle $Disable $true
}
