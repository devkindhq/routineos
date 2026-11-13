#!/usr/bin/env bash
# Desk visual checks. Playwright 1.63.0 is pinned: it uses the chromium-1243 build already in the local cache.
# Usage: bash tests/visual/run.sh [extra playwright test args]. DESK_SHOTS=<dir> moves the screenshots;
# DESK_SPECS="desk.spec.mjs" runs a subset of the specs.
# PHONE=1 bash tests/visual/run.sh runs only phone.spec.mjs (throttled phone timing, writes out/phone-timing.json).
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
# PHONE=1 runs the opt-in phone-timing spec alone (spec 12.4); the default run is unchanged.
if [ "${PHONE:-}" = "1" ]; then
  exec node "$PKG/cli.js" test phone.spec.mjs --browser=chromium --workers=1 --reporter=line --output=out/results "$@"
fi
# One bundle mode: the committed single-file page.
SPECS="desk.spec.mjs v2pages.spec.mjs walk.spec.mjs ext.spec.mjs blueprint.spec.mjs fixpass.spec.mjs mobile.spec.mjs zoom.spec.mjs imagenotes.spec.mjs imagenotes-real.spec.mjs"
exec node "$PKG/cli.js" test ${DESK_SPECS:-$SPECS} --browser=chromium --workers=2 --reporter=line --output=out/results "$@"
