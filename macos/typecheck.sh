#!/bin/sh
# Type-checks the app with only the Command Line Tools (no Xcode needed).
# Their toolchain lacks SwiftUI's @State macro plugin, so a temp copy of the sources
# uses TypecheckShim's @ShimState instead. The real sources are not modified.
set -e
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -R PRM "$tmp/"
find "$tmp" -name '*.swift' -exec sed -i '' 's/@State\([^A-Za-z]\)/@ShimState\1/g' {} +
swiftc -typecheck -swift-version 6 -target arm64-apple-macos15.0 -sdk "$(xcrun --show-sdk-path)" \
  $(find "$tmp" -name '*.swift') TypecheckShim/State.swift "$@"
echo "Type check passed"
