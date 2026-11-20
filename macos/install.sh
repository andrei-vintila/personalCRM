#!/bin/bash
# Builds a Release PRM.app and installs it in /Applications (quitting a running copy first).
set -euo pipefail
cd "$(dirname "$0")"
xcodegen -q
xcodebuild -project PRM.xcodeproj -scheme PRM -configuration Release -derivedDataPath build -destination "platform=macOS,arch=$(uname -m)" -quiet build
osascript -e 'tell application id "com.prm.mac" to quit' 2>/dev/null || true
while pgrep -f "PRM.app/Contents/MacOS/PRM" >/dev/null; do sleep 0.5; done
rm -rf /Applications/PRM.app
ditto build/Build/Products/Release/PRM.app /Applications/PRM.app
open /Applications/PRM.app
echo "Installed /Applications/PRM.app"
