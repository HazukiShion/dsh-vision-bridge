#!/bin/sh
# Pack and install @shion/dsh-vision-bridge into a profile.
#
# Two things this works around, both real traps for local plugin development:
#
#   1. A directory install lands as `link:`, leaving the code at its source path
#      where Node cannot resolve @deepseek-ai/* from ~/.dsh/profiles/node_modules.
#      Packing puts the package under the profile's own node_modules instead,
#      where normal upward resolution finds the hoisted DSH packages.
#
#   2. pnpm caches a tarball by name+version, so re-packing the SAME version
#      silently installs the previous contents. Every pack therefore gets a
#      unique prerelease version.
#
# Usage: ./install.sh [profile]   (default: web)
set -eu

PROFILE="${1:-web}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/.dsh/plugin-tarballs"

cd "$HERE"
mkdir -p "$OUT"

VERSION="0.0.1-dev.$(date +%s)"
node -e '
  const fs = require("fs")
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  pkg.version = process.argv[1]
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
' "$VERSION"

# Drop the previous entry BEFORE deleting its tarball: pnpm resolves every
# existing dependency on any install, so a dangling file: path fails the run.
dsh plugin --profile "$PROFILE" remove @shion/dsh-vision-bridge >/dev/null 2>&1 || true
node scripts/build-client.mjs >/dev/null
rm -f "$OUT"/shion-dsh-vision-bridge-*.tgz
pnpm pack --pack-destination "$OUT" >/dev/null
TGZ="$(ls -t "$OUT"/shion-dsh-vision-bridge-*.tgz | head -1)"

echo "packed $VERSION -> $TGZ"
dsh plugin --profile "$PROFILE" add "$TGZ" 2>&1 | tail -3

INSTALLED="$HOME/.dsh/profiles/$PROFILE/node_modules/@shion/dsh-vision-bridge/index.js"
if grep -q "vision-bridge ready" "$INSTALLED" 2>/dev/null; then
  echo "verified: installed copy is current"
else
  echo "WARNING: installed copy looks stale — check $INSTALLED"
fi
