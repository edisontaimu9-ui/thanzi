#!/bin/bash
# deploy.sh — Thanzi deploy helper
# Stamps sw.js with the current timestamp so the SW cache busts automatically
# Usage:  bash deploy.sh "your commit message"

set -e
cd "$(dirname "$0")"

MSG="${1:-chore: deploy}"
TS=$(date +%s)

echo "🔨 Stamping sw.js with build timestamp: $TS"

# Replace the BUILD_TS placeholder (or previous timestamp) in sw.js
sed -i "s/self\.__BUILD_TS__ = [0-9]*/self.__BUILD_TS__ = $TS/" sw.js 2>/dev/null || true

# If placeholder not yet present, inject it at the top of sw.js
if ! grep -q "__BUILD_TS__" sw.js; then
  sed -i "1s/^/self.__BUILD_TS__ = $TS;\n/" sw.js
fi

echo "✅ sw.js stamped"

git add -A
git commit -m "$MSG"
git push

echo ""
echo "🚀 Deployed! Users will get the update automatically on next visit."
