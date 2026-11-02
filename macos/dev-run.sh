#!/bin/sh
# Debug build + launch against a local server without touching the Keychain.
# Usage: ./dev-run.sh [server] [password]   (defaults: http://localhost:5180 dev-password)
set -e
cd "$(dirname "$0")"
SERVER=${1:-http://localhost:5180}
PASSWORD=${2:-dev-password}
xcodebuild -project PRM.xcodeproj -scheme PRM -configuration Debug -derivedDataPath build -quiet build
TOKEN=$(SERVER="$SERVER" PASSWORD="$PASSWORD" node --input-type=module -e '
const { SERVER: base, PASSWORD: password } = process.env;
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
if (!login.ok) { console.error("login failed", login.status); process.exit(1); }
const cookie = login.headers.get("set-cookie").split(";")[0];
const t = await fetch(`${base}/api/tokens`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Mac app (dev run)" }) }).then((r) => r.json());
process.stdout.write(t.token);')
pkill -x PRM 2>/dev/null || true
# Wait for a previous instance to exit, or `open` just re-activates it.
while pgrep -x PRM >/dev/null; do sleep 0.2; done
open --env PRM_DEV_SERVER="$SERVER" --env PRM_DEV_TOKEN="$TOKEN" build/Build/Products/Debug/PRM.app
