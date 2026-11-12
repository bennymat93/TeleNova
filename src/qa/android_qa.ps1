# First-run QA of the packaged build inside the official Kodi for Android, on an emulator (cold boot: correct clock).
#   android_qa.ps1 -Avd Medium_Tablet -Apk <kodi arm64 apk> [-Minutes 6]
param([string]$Avd = 'Medium_Tablet', [Parameter(Mandatory)][string]$Apk, [int]$Minutes = 6)
$ErrorActionPreference = 'Continue'
$s = $PSScriptRoot
$R = 'C:\My Projects\novaTV Addon'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$D = '/sdcard/Download/tn'
$H = "$D/.kodi"
function Section($t) { "`n########## $t  ($(Get-Date -Format 'HH:mm:ss'))" }

Section "boot $Avd (cold)"
& $adb emu kill 2>&1 | Out-Null
for ($i = 0; $i -lt 20 -and (Get-Process | Where-Object Name -match 'qemu-system'); $i++) { Start-Sleep 2 }
Start-Process (Join-Path $sdk 'emulator\emulator.exe') -ArgumentList '-avd', $Avd, '-no-window', '-no-audio', '-no-snapshot-load', '-no-snapshot-save', '-no-boot-anim', '-gpu', 'swiftshader_indirect' -WindowStyle Hidden
Start-Sleep 25
for ($i = 0; $i -lt 90; $i++) { $b = (& $adb shell getprop sys.boot_completed 2>$null); if ("$b".Trim() -eq '1') { break }; Start-Sleep 5 }
"booted: " + ("$b".Trim() -eq '1') + " | device date: " + (& $adb shell date) + " | abis: " + (& $adb shell getprop ro.product.cpu.abilist)
Start-Sleep 15

Section 'install Kodi + build'
(& $adb install -r $Apk 2>&1 | Select-Object -Last 1)
& $adb shell "am force-stop org.xbmc.kodi; appops set org.xbmc.kodi MANAGE_EXTERNAL_STORAGE allow; pm grant org.xbmc.kodi android.permission.POST_NOTIFICATIONS 2>/dev/null; pm grant org.xbmc.kodi android.permission.READ_EXTERNAL_STORAGE 2>/dev/null; pm grant org.xbmc.kodi android.permission.WRITE_EXTERNAL_STORAGE 2>/dev/null" | Out-Null
$info = Get-Content (Join-Path $R 'build.json') -Raw | ConvertFrom-Json
$part = Join-Path $R ('build\' + ($info.parts[0] -split '/')[-1])
(& $adb push $part /data/local/tmp/build.zip 2>&1 | Select-Object -Last 1)
& $adb shell "rm -rf $D; mkdir -p $H && cd $H && unzip -o -q /data/local/tmp/build.zip; ls addons | wc -l; cat userdata/novatv_build.txt; echo 'xbmc.data=$D' > /sdcard/xbmc_env.properties"

Section "first start, $Minutes minutes"
& $adb shell monkey -p org.xbmc.kodi -c android.intent.category.LAUNCHER 1 2>&1 | Out-Null
$t0 = Get-Date
$ready = $null
for ($i = 0; $i -lt ($Minutes * 10); $i++) {
    Start-Sleep 6
    if (-not $ready) {
        $r = (& $adb shell "grep -c 'telescope\] service ready' $H/temp/kodi.log 2>/dev/null")
        if ("$r".Trim() -match '^[1-9]') { $ready = [int]((Get-Date) - $t0).TotalSeconds }
    }
}
"telegram engine ready after: $ready s | kodi pid: " + (& $adb shell pidof org.xbmc.kodi)
& $adb pull "$H/temp/kodi.log" (Join-Path $s 'android_kodi.log') 2>&1 | Select-Object -Last 1
$log = Join-Path $s 'android_kodi.log'

Section 'what the build did'
Select-String -Path $log -Pattern '\[NovaTV\]|\[plugin\.video\.telescope\]|Loaded \d+ channels\.|Creating PVR client' |
    Where-Object { $_.Line -notmatch 'Traceback' } |
    ForEach-Object { $_.Line.Substring(11, [Math]::Min(205, $_.Line.Length - 11)) } | Select-Object -First 45

Section 'errors and warnings (deduped)'
Select-String -Path $log -Pattern '^\s+(\w+\.)*(\w+Error|\w+Exception): |EXCEPTION:| (error|fatal) <general>: (?!.*(Misplaced|parsing boolean|unmatched parentheses|Control \d+ in window))| warning <general>: \[' |
    ForEach-Object { ($_.Line -replace '^\S+ \S+ T:\d+\s+', '').Trim() -replace 'https?://\S+', '<url>' } |
    ForEach-Object { $_.Substring(0, [Math]::Min(170, $_.Length)) } | Group-Object | Sort-Object Count -Descending |
    Select-Object -First 30 | ForEach-Object { "{0,3}x {1}" -f $_.Count, $_.Name }

Section 'memory'
& $adb shell "dumpsys meminfo org.xbmc.kodi | grep -E 'TOTAL PSS|TOTAL RSS|Native Heap' | head -3"
& $adb exec-out screencap -p > (Join-Path $s 'android_screen.png')
Section 'done'
