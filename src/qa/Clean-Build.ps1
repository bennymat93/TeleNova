param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Src)
# TeleNova 3.3 clean-up of a Kodi home folder (live install or a staging copy of the build)
$ErrorActionPreference = 'Stop'
$before = (Get-ChildItem $Root -Recurse -File | Measure-Object Length -Sum).Sum

# 1. add-ons nothing in the build uses (checked: no addon.xml requires them, no import of them)
$addons = 'skin.estuary',                      # modified copy of the skin Kodi already ships (fallback stays Kodi's own)
          'script.module.beautifulsoup4', 'script.module.soupsieve', 'script.module.dateutil', 'script.module.future',
          'script.module.html5lib', 'script.module.kodi-six', 'script.module.routing', 'script.module.six',
          'script.module.webencodings',
          'metadata.album.universal', 'metadata.artists.universal', 'metadata.common.fanart.tv',
          'metadata.generic.albums'              # music-library scrapers; Kodi ships its own copies
foreach ($a in $addons) {
    $p = Join-Path $Root "addons\$a"
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Recurse -Force; "removed addon $a" }
}

# 2. leftovers of the old POV wizard / build
foreach ($rel in 'wizard', 'media\wizard_assets', 'media\builds_favourites_xml', 'media\build_icons\POV',
                 'media\build_icons\Speed_Test', 'media\build_icons\Wizard', 'media\build_icons\Order_Favorites',
                 'media\build_icons\Twilight', 'userdata\addon_data\skin.estuary') {
    $p = Join-Path $Root $rel
    if (Test-Path $p) { Remove-Item -LiteralPath $p -Recurse -Force; "removed $rel" }
}
Get-ChildItem (Join-Path $Root 'addons') -Recurse -File -Filter '*.pre-telenova' -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem (Join-Path $Root 'addons') -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

# 3. favourites: only entries whose add-on exists
$fav = Join-Path $Root 'userdata\favourites.xml'
$enc = New-Object System.Text.UTF8Encoding($false)
$t = [IO.File]::ReadAllText($fav)
$t2 = [regex]::Replace($t, '[ \t]*<favourite\b[^>]*>[^<]*(?:plugin\.video\.pov|kodipovilai|kodipovilwizard|plugin\.video\.otaku|orderfavourites)[^<]*</favourite>\r?\n?', '')
if ($t2 -ne $t) { [IO.File]::WriteAllText($fav, $t2, $enc); "favourites cleaned" }
[xml]$null = $t2

# 4. the updated add-ons
foreach ($a in 'plugin.video.nova', 'plugin.video.telescope', 'plugin.program.novawizard') {
    $dst = Join-Path $Root "addons\$a"
    Remove-Item -LiteralPath $dst -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $Src $a) -Destination $dst -Recurse
    Get-ChildItem $dst -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
    "updated $a"
}
[IO.File]::WriteAllText((Join-Path $Root 'userdata\novatv_build.txt'), "TeleNova 4.0.0`n", $enc)

# 5. the build ships with the skin and All_Subs already patched (the service does the same on boxes that update)
$env:TN_ROOT = $Root; $env:TN_SRC = $Src
python -c "import os, sys; sys.path.insert(0, os.path.join(os.environ['TN_SRC'], 'plugin.video.nova', 'resources', 'lib')); import depov, subspatch, skinpatch; r = os.environ['TN_ROOT']; print('skin 3.3 patch:', depov.patch_skin33(os.path.join(r, 'addons', 'skin.fentastic', 'xml')), '| AI button:', skinpatch.apply(os.path.join(r, 'addons', 'skin.fentastic', 'xml')), '| paste:', skinpatch.keyboard_buttons(os.path.join(r, 'addons', 'skin.fentastic', 'xml')), '| notification:', skinpatch.notification(os.path.join(r, 'addons', 'skin.fentastic', 'xml')), '| home layout:', skinpatch.home_layout(os.path.join(r, 'addons', 'skin.fentastic', 'xml')), '| All_Subs guards:', subspatch.apply(os.path.join(r, 'addons', 'service.subtitles.All_Subs')))"
Get-ChildItem (Join-Path $Root 'addons') -Recurse -File -Filter '*.pre-telenova33' -ErrorAction SilentlyContinue | Remove-Item -Force

$after = (Get-ChildItem $Root -Recurse -File | Measure-Object Length -Sum).Sum
"size: {0:N1} MB -> {1:N1} MB" -f ($before / 1MB), ($after / 1MB)
