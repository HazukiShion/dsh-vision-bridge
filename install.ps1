# Pack and install @shion/dsh-vision-bridge into a profile, on Windows.
#
# A direct translation of install.sh, which needs a POSIX shell that Windows
# does not ship. Same two workarounds, both real traps for local plugin
# development:
#
#   1. A directory install lands as `link:`, leaving the code at its source path
#      where Node cannot resolve @deepseek-ai/* from the profile's node_modules.
#      Packing puts the package under the profile's own node_modules instead,
#      where normal upward resolution finds the hoisted DSH packages.
#
#   2. pnpm caches a tarball by name+version, so re-packing the SAME version
#      silently installs the previous contents. Every pack therefore gets a
#      unique prerelease version.
#
# Usage: .\install.ps1 [profile]   (default: web)
param([string]$Profile = 'web')

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $HOME '.dsh\plugin-tarballs'

Set-Location $here
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Set-PkgVersion([string]$Value) {
  node -e @'
  const fs = require("fs")
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"))
  pkg.version = process.argv[1]
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n")
'@ $Value
}

# The unique version exists only to defeat pnpm's tarball cache, so put the real
# one back the moment packing is done: git installs resolve by commit and tags
# are meaningless if every local install rewrites the version field.
$release = node -p 'require("./package.json").version'
$version = '0.0.1-dev.' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
try {
  Set-PkgVersion $version

  # Drop the previous entry BEFORE deleting its tarball: pnpm resolves every
  # existing dependency on any install, so a dangling file: path fails the run.
  dsh plugin --profile $Profile remove '@shion/dsh-vision-bridge' 2>&1 | Out-Null
  node scripts/build-client.mjs | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $out 'shion-dsh-vision-bridge-*.tgz')
  pnpm pack --pack-destination $out | Out-Null

  $tgz = Get-ChildItem (Join-Path $out 'shion-dsh-vision-bridge-*.tgz') |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  Write-Host "packed $version -> $($tgz.FullName)"

  dsh plugin --profile $Profile add $tgz.FullName 2>&1 | Select-Object -Last 3

  $installed = Join-Path $HOME ".dsh\profiles\$Profile\node_modules\@shion\dsh-vision-bridge\index.js"
  if ((Test-Path $installed) -and (Select-String -Path $installed -Pattern 'vision-bridge ready' -Quiet)) {
    Write-Host 'verified: installed copy is current'
  } else {
    Write-Warning "installed copy looks stale - check $installed"
  }
} finally {
  Set-PkgVersion $release
}
