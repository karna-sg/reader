#!/usr/bin/env bash
# Build an UNSIGNED .ipa for sideloading (Sideplyloadly/AltStore re-sign it with
# your own Apple ID). Requires Xcode + XcodeGen. Output: app/Reader.ipa
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Generating Xcode project"
xcodegen generate

echo "==> Building Release for device (unsigned)"
xcodebuild \
  -project Reader.xcodeproj \
  -scheme Reader \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath build_device \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  build

APP="build_device/Build/Products/Release-iphoneos/Reader.app"
[ -d "$APP" ] || { echo "build failed: $APP not found" >&2; exit 1; }

echo "==> Packaging Reader.ipa"
WORK="$(mktemp -d)"
mkdir -p "$WORK/Payload"
cp -R "$APP" "$WORK/Payload/"
( cd "$WORK" && zip -qry Reader.ipa Payload )
mv -f "$WORK/Reader.ipa" ./Reader.ipa
rm -rf "$WORK"

echo "==> Done: $(pwd)/Reader.ipa"
echo "Sideload it with Sideloadly (or AltStore): connect your iPhone, drop in Reader.ipa,"
echo "sign in with your Apple ID. The app is iOS 26+. In Settings, set the Base URL to your"
echo "server (e.g. https://reader.example.com or http://<lightsail-ip>:8787)."
