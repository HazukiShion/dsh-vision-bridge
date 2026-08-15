# Pack and install @hazukishion/dsh-vision-bridge into a profile, on Windows.
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

  node scripts/build-client.mjs | Out-Null
  pnpm pack --pack-destination $out | Out-Null
  $tgz = Join-Path $out "hazukishion-dsh-vision-bridge-$version.tgz"
  Write-Host "packed $version -> $tgz"

  # Self-heal a wedged profile first. If our own entry points at a tarball that
  # no longer exists — moved, cleaned up, or deleted by an older version of this
  # script — then EVERY pnpm command in that profile fails, including the remove
  # below, and nothing can dig it out.
  $profilePkg = Join-Path $HOME ".dsh\profiles\$Profile\package.json"
  if (Test-Path $profilePkg) {
    $j = Get-Content $profilePkg -Raw | ConvertFrom-Json
    $spec = $j.dependencies.'@hazukishion/dsh-vision-bridge'
    if ($spec -and $spec.StartsWith('file:') -and -not (Test-Path $spec.Substring(5))) {
      $j.dependencies.PSObject.Properties.Remove('@hazukishion/dsh-vision-bridge')
      $j | ConvertTo-Json -Depth 20 | Set-Content $profilePkg
      Write-Warning "dropped @hazukishion/dsh-vision-bridge - its tarball was gone"
    }
  }

  # Order matters, and getting it wrong wedges the profile: the previous entry
  # has to go before its tarball does, because pnpm re-resolves EVERY dependency
  # on any install and a `file:` path pointing at a deleted tarball fails the
  # whole run. Old tarballs are deliberately NOT swept either — that directory
  # is shared by every profile, and each holds a file: path into it.
  dsh plugin --profile $Profile remove '@hazukishion/dsh-vision-bridge' 2>&1 | Out-Null
  dsh plugin --profile $Profile add $tgz 2>&1 | Select-Object -Last 3

  # Compare versions, not a marker string: the marker is in every build, so it
  # reported success even when the install had silently failed.
  $installedPkg = Join-Path $HOME ".dsh\profiles\$Profile\node_modules\@hazukishion\dsh-vision-bridge\package.json"
  $got = if (Test-Path $installedPkg) { (Get-Content $installedPkg -Raw | ConvertFrom-Json).version } else { 'missing' }
  if ($got -eq $version) {
    Write-Host "verified: installed copy is $got"
  } else {
    Write-Warning "installed copy is $got, expected $version"
    exit 1
  }
} finally {
  Set-PkgVersion $release
}
