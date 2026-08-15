/**
 * The Settings backend: one route the Settings page talks to.
 *
 * A plugin distributed outside the DSH repository cannot use the standard
 * settings wire — `dsh-host-apiproxy` gates every namespace through a
 * hard-coded `WEB_SETTINGS_NAMESPACES` array, and an absent namespace answers
 * `settings-not-exposed` no matter who registered it. The comment beside that
 * array calls moving the declaration to `settings.register()` deferred work.
 *
 * So the page reads and writes through here instead. `ctx.settings` stays the
 * source of truth on the server side: this route is a window onto it, not a
 * second store. The day the allowlist opens up, the page can switch to the
 * standard wire and nothing else changes.
 *
 * @module @hazukishion/dsh-vision-bridge/web
 */

/** Path the client half fetches. Must match the constant in the client bundle. */
export const SETTINGS_ROUTE = '/_dsh/shion-vision-bridge/settings'

/** Fields the page may write. Anything else in a patch is ignored. */
const WRITABLE = new Set([
  'translate', 'onUnknown', 'baseUrl', 'model', 'credential',
  'describePrompt', 'maxImageBytes', 'maxImages', 'timeoutMs', 'displayCapacity',
  'concurrency', 'maxTokens',
])

/** Bound the request body: a settings patch is tiny, anything large is wrong. */
const MAX_BODY_BYTES = 64 * 1024

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Read a bounded JSON body, or reject. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch { reject(new Error('body is not valid JSON')) }
    })
    req.on('error', reject)
  })
}

/**
 * Install the Settings route.
 *
 * @param ctx - plugin context.
 * @param deps - `section` (the registered settings scope), `status()` returning
 *   live facts the page shows but cannot edit, and optional `actions` the page
 *   may trigger by name.
 * @returns disposer.
 */
export function installSettingsRoute(ctx, { section, status, actions }) {
  let dispose = () => {}

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: SETTINGS_ROUTE,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            send(res, 200, { config: section.get(), status: await status() })
            return
          }

          if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST')
            send(res, 405, { error: 'use GET or POST' })
            return
          }

          const body = await readJson(req)

          // Actions are explicit user gestures — a button press, never a side
          // effect of saving — so they are handled before the patch path and
          // report their own failure instead of poisoning a settings write.
          if (typeof body?.action === 'string') {
            const run = actions?.[body.action]
            if (!run) {
              send(res, 400, { error: `unknown action "${body.action}"` })
              return
            }
            try {
              send(res, 200, { action: body.action, result: await run(body) })
            } catch (error) {
              send(res, 200, { action: body.action, error: error?.message ?? String(error) })
            }
            return
          }

          const patch = {}
          for (const [key, value] of Object.entries(body?.patch ?? {})) {
            // An unknown key is a bug in the page, not a request to store
            // arbitrary data in the user's settings file.
            if (WRITABLE.has(key)) patch[key] = value
          }

          if (Object.keys(patch).length === 0) {
            send(res, 400, { error: 'no writable fields in patch' })
            return
          }

          // Schema validation lives in ctx.settings, so an invalid value is
          // rejected there and reported here rather than being persisted.
          await section.update(patch)
          send(res, 200, { config: section.get(), status: await status() })
        } catch (error) {
          send(res, 400, { error: error?.message ?? String(error) })
        }
      },
    }), 'shion-vision-bridge: settings route')

    dispose = () => {}
  })

  return () => dispose()
}
