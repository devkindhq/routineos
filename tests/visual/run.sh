#!/usr/bin/env bash
# Desk visual checks. Playwright 1.63.0 is pinned: it uses the chromium-1243 build already in the local cache.
# Usage: bash tests/visual/run.sh [extra playwright test args]. DESK_SHOTS=<dir> moves the screenshots.
set -euo pipefail
cd "$(dirname "$0")"
VERSION=1.63.0
mkdir -p out node_modules/@playwright
# Make sure npx has the pinned package, then find its copy in the npx cache by version.
npx --yes -p "@playwright/test@$VERSION" true >/dev/null
PKG=""
for p in "$HOME"/.npm/_npx/*/node_modules/@playwright/test/package.json; do
  if grep -q "\"version\": \"$VERSION\"" "$p"; then PKG=$(dirname "$p"); break; fi
done
[ -n "$PKG" ] || { echo "@playwright/test@$VERSION not found in the npx cache" >&2; exit 1; }
# The spec imports @playwright/test; link it to the same copy the CLI runs so both resolve to one module.
ln -sfn "$PKG" node_modules/@playwright/test
exec node "$PKG/cli.js" test desk.spec.mjs --browser=chromium --workers=2 --reporter=line --output=out/results "$@"
