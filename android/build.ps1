# One command: copies web/ into the app (Gradle task syncWeb), builds the signed release APK and puts it in ..\apk\.
#   powershell -ExecutionPolicy Bypass -File android\build.ps1
# Needs: Android Studio (its JDK is used) and the Android SDK; the release key in %USERPROFILE%\.telenova-keys\
# (keystore.properties + telenova-release.jks - never in the repository).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr' }
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $here 'local.properties'))) {
    'sdk.dir=' + ($sdk -replace '\\', '/') | Set-Content -Encoding ASCII (Join-Path $here 'local.properties')
}
if (-not (Test-Path (Join-Path $env:USERPROFILE '.telenova-keys\keystore.properties'))) {
    throw 'The release key is missing: %USERPROFILE%\.telenova-keys\keystore.properties (an APK signed with another key cannot update the installed app).'
}
Push-Location $here
try {
    & .\gradlew.bat --console=plain assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed ($LASTEXITCODE)" }
} finally { Pop-Location }
$apk = Join-Path $here 'app\build\outputs\apk\release\app-release.apk'
$out = Join-Path $here '..\apk'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $apk (Join-Path $out 'TeleNova.apk') -Force
$gradle = Get-Content (Join-Path $here 'app\build.gradle') -Raw
$name = [regex]::Match($gradle, "versionName '([^']+)'").Groups[1].Value
$code = [regex]::Match($gradle, 'versionCode (\d+)').Groups[1].Value
$web = [regex]::Match((Get-Content (Join-Path $here '..\web\version.js') -Raw), "WEB_VERSION\s*=\s*'([^']+)'").Groups[1].Value
$sha = (Get-FileHash (Join-Path $out 'TeleNova.apk') -Algorithm SHA256).Hash.ToLower()
$json = '{"versionName": "' + $name + '", "versionCode": ' + $code + ', "webVersion": "' + $web + '", "file": "TeleNova.apk", "sha256": "' + $sha + '"}'
[IO.File]::WriteAllText((Join-Path $out 'version.json'), $json + "`n")
Write-Host "OK: apk\TeleNova.apk  (app $name, web $web)"
