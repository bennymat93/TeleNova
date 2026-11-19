# One command: copies web/ into the app (Gradle task syncWeb), builds the signed release APK and puts it in ..\apk\.
#   powershell -ExecutionPolicy Bypass -File android\build.ps1            (the next number of the series)
#   powershell -ExecutionPolicy Bypass -File android\build.ps1 -DryRun    (only says which number it would be)
# Version: every release goes up by one inside the series of android\VERSION (e.g. "2.6" -> 2.6.1, 2.6.2, ...). The
# number is the count of published GitHub releases apk-<series>.N plus one - the same rule as the iOS app
# (ios-app/VERSION). versionCode = major*10000 + minor*100 + N, so every release installs over the one before.
# Needs: Android Studio (its JDK is used) and the Android SDK; the release key in %USERPROFILE%\.telenova-keys\
# (keystore.properties + telenova-release.jks - never in the repository).
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- version: <series>.<published releases of the series + 1>
$series = (Get-Content (Join-Path $here 'VERSION') -Raw).Trim()
if ($series -notmatch '^(\d+)\.(\d+)$') { throw "android\VERSION must be MAJOR.MINOR (now: '$series')" }
$major = [int]$Matches[1]; $minor = [int]$Matches[2]
$done = $null
try {
    $tags = & gh release list --limit 300 --json tagName -q '.[].tagName' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $done = 0
        foreach ($t in $tags) { if ($t -match ('^apk-' + [regex]::Escape($series) + '\.(\d+)$')) { $done = [Math]::Max($done, [int]$Matches[1]) } }
    }
} catch { $done = $null }
if ($null -eq $done) { throw 'Cannot read the GitHub releases (gh missing or not signed in): the next version number is not known.' }
$patch = $done + 1
$vName = "$series.$patch"
$vCode = $major * 10000 + $minor * 100 + $patch
Write-Host "Version $vName (code $vCode) - releases of $series so far: $done"
if ($DryRun) { return }
$gradleFile = Join-Path $here 'app\build.gradle'
$g = Get-Content $gradleFile -Raw
$g = [regex]::Replace($g, "versionCode \d+", "versionCode $vCode")
$g = [regex]::Replace($g, "versionName '[^']*'", "versionName '$vName'")
[IO.File]::WriteAllText($gradleFile, $g)
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
# the build folder is outside the repository (see app/build.gradle)
$apk = Join-Path $env:USERPROFILE '.telenova-build\app\outputs\apk\release\app-release.apk'
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
Write-Host "Release it after commit + push:  gh release create apk-$name BN-Stream-Android-$name.apk --target gh-pages --latest --title `"BN Stream Android $name`""
