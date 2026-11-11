@echo off
rem TeleNova 3.1 - Windows installer. Double-click to run.
rem Installs Kodi (if missing) and the TeleNova build (Telegram engine included).
title TeleNova 3.1 Setup
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
    Say '=== TeleNova 3.1 Setup ==='
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit Windows is required.' }
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

    # ---- 1. Kodi itself
    $kodi = Find-Kodi
    if (-not $kodi) {
        Say '[1/4] Kodi is not installed - downloading Kodi 21 (about 70 MB)...'
        $setup = Join-Path $Tmp 'kodi-setup.exe'
        Get-File $KodiUrl $setup
        Say '      Installing Kodi (approve the Windows prompt if one appears)...'
        Start-Process -FilePath $setup -ArgumentList '/S' -Wait -Verb RunAs
        $kodi = Find-Kodi
        if (-not $kodi) { throw 'Kodi was not installed. Install Kodi 21 from https://kodi.tv/download and run this file again.' }
    } else {
        Say "[1/4] Kodi found: $kodi"
    }

    # ---- 2. Kodi must be closed while its data folder is replaced
    if (Get-Process -Name kodi -ErrorAction SilentlyContinue) {
        Say '[2/4] Closing Kodi...'
        Get-Process -Name kodi | Stop-Process -Force
        Start-Sleep -Seconds 3
    } else {
        Say '[2/4] Kodi is not running.'
    }

    # ---- 3. the build package: downloaded in parts, joined, checked against the published SHA-256
    Say '[3/4] Downloading the TeleNova build (about 110 MB)...'
    $info = Invoke-RestMethod -Uri ($Site + 'build.json') -UseBasicParsing
    $zip = Join-Path $Tmp 'build.zip'
    $urls = if ($info.parts) { @($info.parts) } else { @($info.url) }
    $out = [IO.File]::Create($zip)
    try {
        $n = 0
        foreach ($u in $urls) {
            $part = Join-Path $Tmp ("part" + $n)
            Get-File $u $part
            $in = [IO.File]::OpenRead($part)
            try { $in.CopyTo($out) } finally { $in.Close() }
            Remove-Item -LiteralPath $part -Force
            $n++
        }
    } finally { $out.Close() }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
    if ($info.sha256 -and $hash -ne $info.sha256.ToLower()) { throw 'The build download is corrupt (checksum mismatch). Run this file again.' }

    # ---- 4. install: the previous Kodi data is kept as a backup folder, never deleted
    Say '[4/4] Installing the build...'
    if (Test-Path $Home2) {
        $bak = "$Home2.backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Rename-Item -LiteralPath $Home2 -NewName (Split-Path $bak -Leaf)
        Say "      Your previous Kodi data was kept in: $bak" 'Yellow'
    }
    New-Item -ItemType Directory -Force -Path $Home2 | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Home2)

    # desktop shortcut
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'TeleNova.lnk'))
    $lnk.TargetPath = $kodi
    $lnk.WorkingDirectory = Split-Path $kodi
    $lnk.Description = 'TeleNova 3.1'
    $lnk.Save()

    Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
    Say ''
    Say 'Done. Open "TeleNova" from the desktop.' 'Green'
        Say 'Then: TeleNova > Telegram > Account & Status > log in to Telegram.' 'Green'
} catch {
    Say ''
    Say ("Setup failed: " + $_.Exception.Message) 'Red'
    Say 'Nothing of your previous Kodi data was deleted.' 'Yellow'
}
