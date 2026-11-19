#!/bin/bash
# TeleNova iOS app - build script. Needs a Mac with Xcode and XcodeGen (brew install xcodegen); on this project it
# runs in GitHub Actions (.github/workflows/ios-app.yml), because the development PC is Windows.
#
#   ./build.sh prepare      copy web/ into build/web, make the icon, write TeleNova.xcodeproj
#   ./build.sh ipa          unsigned device build -> build/TeleNova-Web-<version>.ipa
#   ./build.sh sim <udid>   simulator build -> build/sim/TeleNova.app (installed and started by the workflow)
#
# The web files are copied from ../web at build time and never edited here.
# Version: ios-app/VERSION (file name ios/TeleNova-Web-<version>.ipa, release tag ios-<version>-b<build>).
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
WEB="$HERE/../web"

# the app's own version (the owner's numbering, since 2.0): ios-app/VERSION. The web version is only reported.
TN_VERSION="$(tr -d ' \r\n' < "$HERE/VERSION")"
[ -n "$TN_VERSION" ] || { echo "ios-app/VERSION is empty" >&2; exit 1; }
WEB_VERSION="$(sed -n "s/.*WEB_VERSION *= *'\([0-9][0-9.]*\)'.*/\1/p" "$WEB/version.js" | head -1)"
export TN_VERSION
export TN_BUILD="${TN_BUILD:-${GITHUB_RUN_NUMBER:-1}}"
IPA="$HERE/build/TeleNova-Web-$TN_VERSION.ipa"

prepare() {
  rm -rf build/web build/Assets.xcassets build/Info.plist TeleNova.xcodeproj
  mkdir -p build/web
  # the site as published, without its tests and notes
  rsync -a --exclude '_t' --exclude 'tests' --exclude '*.md' --exclude '.DS_Store' "$WEB/" build/web/
  [ -f build/web/index.html ] && [ -f build/web/app.js ] && [ -f build/web/sw.js ] || { echo "web copy is incomplete" >&2; exit 1; }

  local icons="build/Assets.xcassets/AppIcon.appiconset" color="build/Assets.xcassets/LaunchBG.colorset"
  mkdir -p "$icons" "$color"
  # 1024 px, no alpha channel (through JPEG and back), from the web icon
  sips -s format jpeg -s formatOptions 100 -z 1024 1024 "$WEB/icon-512.png" --out build/icon.jpg >/dev/null
  sips -s format png build/icon.jpg --out "$icons/icon-1024.png" >/dev/null
  rm -f build/icon.jpg
  cat > "$icons/Contents.json" <<'JSON'
{"images":[{"filename":"icon-1024.png","idiom":"universal","platform":"ios","size":"1024x1024"}],"info":{"author":"xcode","version":1}}
JSON
  cat > "$color/Contents.json" <<'JSON'
{"colors":[{"idiom":"universal","color":{"color-space":"srgb","components":{"red":"0x0B","green":"0x0D","blue":"0x12","alpha":"1.000"}}}],"info":{"author":"xcode","version":1}}
JSON
  echo '{"info":{"author":"xcode","version":1}}' > build/Assets.xcassets/Contents.json
  xcodegen generate --spec project.yml
  echo "prepared: BN Stream $TN_VERSION ($TN_BUILD), bundled web $WEB_VERSION, $(find build/web -type f | wc -l | tr -d ' ') web files"
}

NOSIGN=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= CODE_SIGN_ENTITLEMENTS= DEVELOPMENT_TEAM=)

show_errors() {
  grep -E "error:|error :|fatal" -A4 "$1" | head -120 || true
  echo "--- last lines of $1"; tail -25 "$1"
}

ipa() {
  [ -d TeleNova.xcodeproj ] || prepare
  xcodebuild -project TeleNova.xcodeproj -scheme TeleNova -configuration Release -sdk iphoneos \
    -destination 'generic/platform=iOS' -derivedDataPath build/dd "${NOSIGN[@]}" build > build/xcodebuild-ipa.log 2>&1     || { show_errors build/xcodebuild-ipa.log; exit 1; }
  local app="build/dd/Build/Products/Release-iphoneos/TeleNova.app"
  [ -f "$app/TeleNova" ] || { echo "no app binary" >&2; exit 1; }
  # nothing that would get in the way of signing it again
  rm -rf "$app/_CodeSignature" "$app/embedded.mobileprovision"
  rm -rf build/ipa && mkdir -p build/ipa/Payload
  cp -R "$app" build/ipa/Payload/
  rm -f "$IPA"
  (cd build/ipa && zip -qry "$IPA" Payload)
  echo "ipa: $IPA ($(du -h "$IPA" | cut -f1))"
}

sim() {
  [ -d TeleNova.xcodeproj ] || prepare
  local dest="generic/platform=iOS Simulator"
  [ -n "${1:-}" ] && dest="id=$1"
  xcodebuild -project TeleNova.xcodeproj -scheme TeleNova -configuration Debug -sdk iphonesimulator \
    -destination "$dest" -derivedDataPath build/ddsim "${NOSIGN[@]}" build > build/xcodebuild-sim.log 2>&1     || { show_errors build/xcodebuild-sim.log; exit 1; }
  rm -rf build/sim && mkdir -p build/sim
  cp -R build/ddsim/Build/Products/Debug-iphonesimulator/TeleNova.app build/sim/
  echo "simulator app: build/sim/TeleNova.app"
}

case "${1:-}" in
  prepare) prepare ;;
  ipa) ipa ;;
  sim) sim "${2:-}" ;;
  version) echo "$TN_VERSION" ;;
  *) echo "usage: $0 prepare | ipa | sim [udid] | version" >&2; exit 2 ;;
esac
