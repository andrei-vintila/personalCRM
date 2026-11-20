#!/bin/bash
# Builds a Release PRM.app, signs it with the "PRM Local Signing" certificate when present
# (see setup-signing.sh), and installs it in /Applications, quitting a running copy first.
set -euo pipefail
cd "$(dirname "$0")"
xcodegen -q
xcodebuild -project PRM.xcodeproj -scheme PRM -configuration Release -derivedDataPath build -destination "platform=macOS,arch=$(uname -m)" -quiet build
app=build/Build/Products/Release/PRM.app
# A stable certificate keeps macOS permissions across updates; ad-hoc builds lose them.
if security find-certificate -c "PRM Local Signing" >/dev/null 2>&1; then
  codesign --force --options runtime --entitlements PRM/PRM.entitlements --sign "PRM Local Signing" "$app"
else
  echo "Note: run ./setup-signing.sh once so Full Disk Access survives updates."
fi
osascript -e 'tell application id "com.prm.mac" to quit' 2>/dev/null || true
while pgrep -f "PRM.app/Contents/MacOS/PRM" >/dev/null; do sleep 0.5; done
rm -rf /Applications/PRM.app
ditto "$app" /Applications/PRM.app
open /Applications/PRM.app
echo "Installed /Applications/PRM.app"
