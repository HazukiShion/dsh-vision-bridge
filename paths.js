/**
 * Input path admission for `vision_ask`.
 *
 * A tool that reads arbitrary files and ships their bytes to a third-party
 * endpoint is an exfiltration primitive if it accepts any path. Containment is
 * checked against the resolved real path, so neither `..` nor a symlink
 * pointing outside the workspace gets through.
 *
 * @module @hazukishion/dsh-vision-bridge/paths
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

/** Extension to media type, checked again against the decoded bytes below. */
const BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Magic bytes, so a renamed file cannot lie about what it is. */
const SIGNATURES = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
]

/**
 * Windows only, and deliberately not macOS.
 *
 * Both sides of the comparison come from `realpath()`, which on macOS returns
 * the canonical on-disk spelling — so a case mismatch cannot survive it there,
 * and folding anyway would *widen* the boundary on a case-sensitive volume
 * where `/ws` and `/WS` are genuinely different directories. Windows realpath
 * makes no such guarantee about drive letters or component case, so without
 * folding a file truly inside the workspace gets refused: a denial that reads
 * as a bug in the tool rather than a working guard.
 */
const CASE_INSENSITIVE = process.platform === 'win32'

/** Fold only for comparison; the path we return and open stays as resolved. */
function comparable(path) {
  return CASE_INSENSITIVE ? path.toLowerCase() : path
}

/** True when `child` is `parent` itself or sits underneath it. */
function isWithin(parent, child) {
  const a = comparable(parent)
  const b = comparable(child)
  if (a === b) return true
  return b.startsWith(a.endsWith(sep) ? a : a + sep)
}

/** RIFF....WEBP needs two checks at different offsets. */
function isWebp(head) {
  return head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
    && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
}

/**
 * Identify image bytes by content, not by name.
 * @param bytes - the file's contents.
 * @returns the detected media type, or undefined.
 */
function sniff(bytes) {
  if (isWebp(bytes)) return 'image/webp'
  for (const { type, bytes: sig } of SIGNATURES) {
    if (sig.every((byte, index) => bytes[index] === byte)) return type
  }
  return undefined
}

/**
 * Resolve, admit and read one image path.
 * @param rawPath - path as the model supplied it, absolute or workspace-relative.
 * @param roots - allowed real directories; the first is the session workspace.
 * @param maxBytes - refuse anything larger.
 * @returns the resolved path, verified media type and bytes.
 */
export async function readImageWithin(rawPath, roots, maxBytes) {
  const candidate = isAbsolute(rawPath) ? rawPath : resolve(roots[0] ?? process.cwd(), rawPath)

  let real
  try {
    real = await realpath(candidate)
  } catch {
    throw new Error(`no such image: ${rawPath}`)
  }

  const allowed = roots.some((root) => isWithin(root, real))
  if (!allowed) {
    throw new Error(
      `refusing to read "${rawPath}": it resolves outside the session workspace. `
      + 'Move the file into the workspace, or add its directory to allowedDirs.',
    )
  }

  const info = await stat(real)
  if (!info.isFile()) throw new Error(`not a regular file: ${rawPath}`)
  if (info.size > maxBytes) {
    throw new Error(`image is ${info.size} bytes, over the ${maxBytes} byte limit`)
  }

  const bytes = await readFile(real)
  const detected = sniff(bytes)
  if (!detected) throw new Error(`"${rawPath}" is not a PNG, JPEG, WebP or GIF image`)

  // A mismatch is not fatal — the bytes decide — but it is worth refusing,
  // because it usually means the caller picked the wrong file.
  const claimed = BY_EXTENSION[real.slice(real.lastIndexOf('.')).toLowerCase()]
  if (claimed && claimed !== detected) {
    throw new Error(`"${rawPath}" has a ${claimed} name but ${detected} contents`)
  }

  return { path: real, mediaType: detected, bytes }
}

/**
 * Build the allowed root list for one call.
 * @param workspace - the calling session's working directory.
 * @param extra - configured additional directories.
 * @returns real, de-duplicated roots; unreadable entries are dropped.
 */
export async function resolveRoots(workspace, extra = []) {
  const roots = []
  for (const dir of [workspace, ...extra]) {
    if (!dir) continue
    try { roots.push(await realpath(dir)) } catch { /* a configured dir that no longer exists */ }
  }
  return [...new Set(roots)]
}
