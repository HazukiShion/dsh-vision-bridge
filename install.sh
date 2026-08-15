#!/bin/sh
# Pack and install @hazukishion/dsh-vision-bridge into a profile.
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

setversion() {
  node -e '
    const fs = require("fs")
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
    pkg.version = process.argv[1]
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
  ' "$1"
}

# The unique version exists only to defeat pnpm's tarball cache, so put the real
# one back the moment packing is done: git installs resolve by commit and tags
# are meaningless if every local install rewrites the version field.
RELEASE="$(node -p 'require("./package.json").version')"
trap 'setversion "$RELEASE"' EXIT INT TERM
setversion "0.0.1-dev.$(date +%s)"
VERSION="$(node -p 'require("./package.json").version')"

node scripts/build-client.mjs >/dev/null
pnpm pack --pack-destination "$OUT" >/dev/null
TGZ="$OUT/hazukishion-dsh-vision-bridge-$VERSION.tgz"
echo "packed $VERSION -> $TGZ"

# Order matters, and getting it wrong wedges the profile: the previous entry has
# to go before its tarball does, because pnpm re-resolves EVERY dependency on
# any install and a `file:` path pointing at a deleted tarball fails the whole
# run — including the very command that would have removed it. So the old
# tarballs are swept only after the new one is installed, and the remove is
# allowed to fail (there is nothing to remove on a first install).
dsh plugin --profile "$PROFILE" remove @hazukishion/dsh-vision-bridge >/dev/null 2>&1 || true
if ! dsh plugin --profile "$PROFILE" add "$TGZ" 2>&1 | tail -3; then
  echo "FAILED: could not install $TGZ" >&2
  exit 1
fi
find "$OUT" -name "hazukishion-dsh-vision-bridge-*.tgz" ! -name "$(basename "$TGZ")" -delete

# Compare versions, not a marker string: the marker is present in every build,
# so it reported success even when the install had silently failed and the old
# copy was still in place.
INSTALLED="$HOME/.dsh/profiles/$PROFILE/node_modules/@hazukishion/dsh-vision-bridge/package.json"
GOT="$(node -p "require('$INSTALLED').version" 2>/dev/null || echo missing)"
if [ "$GOT" = "$VERSION" ]; then
  echo "verified: installed copy is $GOT"
else
  echo "WARNING: installed copy is $GOT, expected $VERSION" >&2
  exit 1
fi
