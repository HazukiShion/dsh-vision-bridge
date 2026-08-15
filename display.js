/**
 * The display seam: a route that hands a picture back to the person.
 *
 * Why a bespoke route rather than the harness's own presentation hooks —
 * `tools/post-execute` rewrites the model view and the UI view together (they
 * are not separate), and `presentResult`, which the type system advertises as
 * the UI-facing projection, is not consumed by this release's web client at
 * all. Both were measured, not assumed.
 *
 * Two lifetimes, deliberately separated:
 *
 *   - **A URL is a signed capability.** It carries the attachment reference
 *     itself, signed with a per-installation key, so it needs no server-side
 *     record and keeps working across restarts — a link in a month-old
 *     transcript still opens.
 *   - **A handle is conversational.** `img_511c828d` only means anything while
 *     the conversation that minted it is live, so its table is in-process and
 *     losing it on restart costs nothing.
 *
 * The earlier design had it backwards: random tokens in a table meant the
 * durable half (the URL) depended on the disposable half (the map).
 *
 * @module @shion/dsh-vision-bridge/display
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/shion-vision-bridge/image'

/** Signature length in bytes; 128 bits is plenty and keeps the URL short. */
const SIGNATURE_BYTES = 16

/** Signing key length. */
const KEY_BYTES = 32

/** How many handles stay resolvable in one process. */
const DEFAULT_CAPACITY = 200

const b64url = (buffer) => buffer.toString('base64url')

/** Where DSH keeps its state, matching the harness's own resolution order. */
function stateRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'cache', 'shion-vision-bridge')
}

/**
 * Load the installation signing key, creating it exactly once.
 *
 * `wx` makes the create atomic, so two hosts starting together cannot each
 * write a different key and invalidate the other's already-issued links.
 *
 * @param root - state directory override, for tests.
 * @returns the 32-byte key.
 */
export async function prepareSigningKey(root = stateRoot()) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const path = join(root, 'display.key')

  try {
    const existing = await readFile(path)
    if (existing.length === KEY_BYTES) return existing
    throw new Error(`display key at ${path} is ${existing.length} bytes, expected ${KEY_BYTES}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const candidate = randomBytes(KEY_BYTES)
  try {
    await writeFile(path, candidate, { flag: 'wx', mode: 0o600 })
    return candidate
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return readFile(path)
  }
}

/** The reference, in the shortest form `readImage` still accepts. */
function pack(ref) {
  return {
    i: ref.attachmentId,
    m: ref.mediaType,
    b: ref.bytes,
    w: ref.width,
    h: ref.height,
  }
}

function unpack(packed) {
  return {
    attachmentId: packed.i,
    mediaType: packed.m,
    bytes: packed.b,
    width: packed.w,
    height: packed.h,
  }
}

/**
 * Signed image URLs plus the route that serves them.
 *
 * @param ctx - plugin context carrying `webServer` and `attachments`.
 * @param capacity - how many handles stay resolvable.
 * @returns registration, URL building, and install control.
 */
export function createDisplay(ctx, capacity = DEFAULT_CAPACITY) {
  /** handle -> ref. In-process by design; see the module note. */
  const byHandle = new Map()
  let key

  const sign = (payload) => b64url(createHmac('sha256', key).update(payload).digest().subarray(0, SIGNATURE_BYTES))

  /** Verify and decode one URL segment, or return undefined. */
  const open = (segment) => {
    const split = segment.lastIndexOf('.')
    if (split <= 0) return undefined

    const payload = segment.slice(0, split)
    const provided = Buffer.from(segment.slice(split + 1), 'base64url')
    const expected = Buffer.from(sign(payload), 'base64url')

    // Constant-time, and length-checked first because timingSafeEqual throws
    // on a length mismatch rather than returning false.
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined

    try {
      return unpack(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    } catch {
      return undefined
    }
  }

  const origin = () => {
    const host = ctx.webServer.host === '0.0.0.0' ? '127.0.0.1' : ctx.webServer.host
    return `http://${host}:${ctx.webServer.port}`
  }

  return {
    /**
     * Remember a handle for the rest of this process, so the model can refer
     * back to an image it saw described earlier in the conversation.
     * @param handle - the marker used in translated text.
     * @param ref - the durable attachment reference.
     * @returns the same handle.
     */
    register(handle, ref) {
      byHandle.set(handle, ref)
      while (byHandle.size > capacity) byHandle.delete(byHandle.keys().next().value)
      return handle
    },

    /** Resolve a handle minted in this process. */
    get(handle) {
      return byHandle.get(handle)
    },

    /** Handles currently resolvable, oldest first. */
    handles() {
      return [...byHandle.keys()]
    },

    /**
     * Mint the durable link for one reference.
     * @param ref - the attachment to serve.
     * @returns an absolute URL that survives restarts.
     */
    urlFor(ref) {
      const payload = b64url(Buffer.from(JSON.stringify(pack(ref)), 'utf8'))
      return `${origin()}${ROUTE_PREFIX}/${payload}.${sign(payload)}`
    },

    /** Load the key and claim the route. */
    async install() {
      key = await prepareSigningKey()
      return ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const segment = decodeURIComponent(req.url?.split('?')[0].slice(ROUTE_PREFIX.length + 1) ?? '')
          const ref = open(segment)

          // A bad signature and a well-formed link to a vanished object are
          // reported identically: saying which would confirm that a payload
          // was correctly signed.
          if (!ref) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('no such image')
            return
          }

          try {
            const stored = await ctx.attachments.readImage(ref)
            res.writeHead(200, {
              'content-type': ref.mediaType,
              'content-length': String(stored.data.byteLength),
              'content-disposition': 'inline',
              // Immutable content-addressed bytes: caching them costs nothing.
              'cache-control': 'private, max-age=86400',
            })
            res.end(Buffer.from(stored.data))
          } catch {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('no such image')
          }
        },
      })
    },
  }
}
