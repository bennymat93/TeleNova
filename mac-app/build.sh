#!/bin/bash
# BN Stream for Mac - build script (macOS with Xcode and XcodeGen; runs in .github/workflows/mac-app.yml).
#   ./build.sh prepare   copy web/ into build/web, make the icon set, write BNStream.xcodeproj
#   ./build.sh app       universal (arm64 + x86_64) app, ad-hoc signed -> build/BN-Stream-macOS-<version>.zip
#   ./build.sh version
# Version: mac-app/VERSION (one number for the whole project). The web files are copied, never edited here.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
WEB="$HERE/../web"
TN_VERSION="${TN_VERSION:-$(tr -d ' \r\n' < "$HERE/VERSION")}"
export TN_VERSION
export TN_BUILD="${TN_BUILD:-${GITHUB_RUN_NUMBER:-1}}"
ZIP="$HERE/build/BN-Stream-macOS-$TN_VERSION.zip"

prepare() {
  rm -rf build/web build/Assets.xcassets build/Info.plist BNStream.xcodeproj
  mkdir -p build/web
  rsync -a --exclude '_t' --exclude 'tests' --exclude '*.md' --exclude '.DS_Store' "$WEB/" build/web/
  [ -f build/web/index.html ] && [ -f build/web/app.js ] && [ -f build/web/sw.js ] || { echo "web copy is incomplete" >&2; exit 1; }
  local set="build/Assets.xcassets/AppIcon.appiconset"
  mkdir -p "$set"
  local json='{"images":['
  local first=1
  for s in 16 32 128 256 512; do
    for k in 1 2; do
      local px=$((s * k)) f="icon_${s}x${s}@${k}x.png"
      sips -z "$px" "$px" "$WEB/icon-512.png" --out "$set/$f" >/dev/null 2>&1 || sips -z "$px" "$px" "$WEB/icon-512.png" --out "$set/$f"
      [ $first = 1 ] || json="$json,"
      first=0
      json="$json{\"filename\":\"$f\",\"idiom\":\"mac\",\"scale\":\"${k}x\",\"size\":\"${s}x${s}\"}"
    done
  done
  echo "$json],\"info\":{\"author\":\"xcode\",\"version\":1}}" > "$set/Contents.json"
  echo '{"info":{"author":"xcode","version":1}}' > build/Assets.xcassets/Contents.json
  xcodegen generate --spec project.yml
  echo "prepared: BN Stream for Mac $TN_VERSION ($TN_BUILD), $(find build/web -type f | wc -l | tr -d ' ') web files"
}

show_errors() { grep -E "error:|fatal" -A4 "$1" | head -120 || true; echo "--- last lines of $1"; tail -25 "$1"; }

app() {
  [ -d BNStream.xcodeproj ] || prepare
  xcodebuild -project BNStream.xcodeproj -scheme BNStream -configuration Release -destination 'generic/platform=macOS' \
    -derivedDataPath build/dd ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO \
    build > build/xcodebuild.log 2>&1 || { show_errors build/xcodebuild.log; exit 1; }
  local a="build/dd/Build/Products/Release/BN Stream.app"
  [ -d "$a" ] || { echo "no app" >&2; exit 1; }
  # ad-hoc signature: an arm64 Mac refuses to run code with none; it is not a developer signature (Gatekeeper still asks)
  codesign --force --deep --sign - "$a"
  rm -rf build/out && mkdir -p build/out && cp -R "$a" build/out/
  rm -f "$ZIP"
  (cd build/out && ditto -c -k --sequesterRsrc --keepParent "BN Stream.app" "$ZIP")
  echo "zip: $ZIP ($(du -h "$ZIP" | cut -f1))"
}

case "${1:-}" in
  prepare) prepare ;;
  app) app ;;
  version) echo "$TN_VERSION" ;;
  *) echo "usage: $0 prepare | app | version" >&2; exit 2 ;;
esac
