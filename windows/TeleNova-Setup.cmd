@echo off
rem TeleNova V3.0 - Windows installer. Double-click to run.
rem Installs Kodi (if missing), the TeleNova build and NovaTV 3.0.0 with the TeleScope AI Telegram engine.
title TeleNova V3.0 Setup
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $s=(Get-Content -LiteralPath $f -Raw) -split '(?m)^#PSBEGIN\r?$',2; Invoke-Expression $s[1]"
echo.
pause
exit /b
#PSBEGIN
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Site     = 'https://bennymat93.github.io/TeleNova/'
$KodiUrl  = 'https://mirrors.kodi.tv/releases/windows/win64/kodi-21.3-Omega-x64.exe'
$Home2    = Join-Path $env:APPDATA 'Kodi'
$Tmp      = Join-Path $env:TEMP 'TeleNovaSetup'

function Say($t, $c = 'Cyan') { Write-Host $t -ForegroundColor $c }
function Get-File($url, $dest) {
    for ($i = 1; $i -le 3; $i++) {
        try {
            if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
                & curl.exe -L --fail --retry 3 -# -o $dest $url
                if ($LASTEXITCODE -ne 0) { throw "curl exit code $LASTEXITCODE" }
            } else {
                Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
            }
            return
        } catch {
            if ($i -eq 3) { throw "Download failed: $url ($_)" }
            Start-Sleep -Seconds 3
        }
    }
}
function Find-Kodi {
    foreach ($p in @("$env:ProgramFiles\Kodi\kodi.exe", "${env:ProgramFiles(x86)}\Kodi\kodi.exe", "$env:LOCALAPPDATA\Programs\Kodi\kodi.exe")) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

try {
    Say '=== TeleNova V3.0 Setup ==='
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit Windows is required.' }
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

    # ---- 1. Kodi itself
    $kodi = Find-Kodi
    if (-not $kodi) {
        Say '[1/5] Kodi is not installed - downloading Kodi 21 (about 70 MB)...'
        $setup = Join-Path $Tmp 'kodi-setup.exe'
        Get-File $KodiUrl $setup
        Say '      Installing Kodi (approve the Windows prompt if one appears)...'
        Start-Process -FilePath $setup -ArgumentList '/S' -Wait -Verb RunAs
        $kodi = Find-Kodi
        if (-not $kodi) { throw 'Kodi was not installed. Install Kodi 21 from https://kodi.tv/download and run this file again.' }
    } else {
        Say "[1/5] Kodi found: $kodi"
    }

    # ---- 2. Kodi must be closed while its data folder is replaced
    if (Get-Process -Name kodi -ErrorAction SilentlyContinue) {
        Say '[2/5] Closing Kodi...'
        Get-Process -Name kodi | Stop-Process -Force
        Start-Sleep -Seconds 3
    } else {
        Say '[2/5] Kodi is not running.'
    }

    # ---- 3. the build package (checked against the published SHA-256)
    Say '[3/5] Downloading the TeleNova build (about 120 MB)...'
    $info = Invoke-RestMethod -Uri ($Site + 'build.json') -UseBasicParsing
    $zip = Join-Path $Tmp 'build.zip'
    Get-File $info.url $zip
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
    if ($info.sha256 -and $hash -ne $info.sha256.ToLower()) { throw 'The build download is corrupt (checksum mismatch). Run this file again.' }

    # ---- 4. install: the previous Kodi data is kept as a backup folder, never deleted
    Say '[4/5] Installing the build...'
    if (Test-Path $Home2) {
        $bak = "$Home2.backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Rename-Item -LiteralPath $Home2 -NewName (Split-Path $bak -Leaf)
        Say "      Your previous Kodi data was kept in: $bak" 'Yellow'
    }
    New-Item -ItemType Directory -Force -Path $Home2 | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Home2)

    # ---- 5. NovaTV 3.0.0 over the build's copy (it installs the Telegram engine by itself on first start)
    Say '[5/5] Updating NovaTV to 3.0.0...'
    $nova = Join-Path $Tmp 'nova.zip'
    Get-File ($Site + 'repo/plugin.video.nova/plugin.video.nova-3.0.0.zip') $nova
    $addons = Join-Path $Home2 'addons'
    New-Item -ItemType Directory -Force -Path $addons | Out-Null
    $old = Join-Path $addons 'plugin.video.nova'
    if (Test-Path $old) { Remove-Item -LiteralPath $old -Recurse -Force }
    [IO.Compression.ZipFile]::ExtractToDirectory($nova, $addons)

    # desktop shortcut
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TeleNova.lnk'))
    $lnk.TargetPath = $kodi
    $lnk.WorkingDirectory = Split-Path $kodi
    $lnk.Description = 'TeleNova V3.0'
    $lnk.Save()

    Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
    Say ''
    Say 'Done. Open "TeleNova" from the desktop.' 'Green'
    Say 'First start: wait about two minutes - NovaTV installs the Telegram engine (TeleScope AI) from the repository.' 'Green'
    Say 'Then: NovaTV > Telegram - TeleScope AI > Account & Status > log in.' 'Green'
} catch {
    Say ''
    Say ("Setup failed: " + $_.Exception.Message) 'Red'
    Say 'Nothing of your previous Kodi data was deleted.' 'Yellow'
}
