/**
 * The external vision model call.
 *
 * One OpenAI-compatible chat/completions request with image_url parts carrying
 * base64 data URIs. No SDK: the request shape is small, stable, and every
 * candidate endpoint speaks it.
 *
 * @module @shion/dsh-vision-bridge/vlm
 */

/**
 * Bound in-flight requests to the endpoint.
 *
 * Measured, not guessed: one full-image call to `kimi-for-coding` takes ~38s,
 * and three fired together came back at 42s / 44s / 62s. The agent naturally
 * asks several questions at once, so unbounded concurrency stacks those
 * latencies until every call blows its deadline — which is exactly how both
 * stress tests failed. Queueing here keeps each request inside its own budget.
 *
 * @param limit - how many requests may be in flight at once.
 * @returns a function that runs `task` once a slot frees up.
 */
export function createGate(limit) {
  let active = 0
  const waiting = []

  const next = () => {
    if (active >= limit || waiting.length === 0) return
    active += 1
    const { task, resolve, reject } = waiting.shift()
    task().then(resolve, reject).finally(() => { active -= 1; next() })
  }

  return (task) => new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject })
    next()
  })
}

/**
 * A 64x64 PNG, inlined so a connection test never depends on a file existing.
 *
 * Not smaller: a 2x2 probe is a perfectly valid PNG and endpoints still reject
 * it — "failed to decode image: invalid or unsupported image format" — because
 * they enforce a minimum size. 64x64 clears that everywhere while staying at
 * 167 bytes, so the round trip still measures the endpoint and not the upload.
 */
const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAbklEQVR42u3aMQ2AUABDwVpAAcbwgA90MSAADQhAATMzf6DJNc/A7c1UvgD8BnBlKwoAAAAAAAAAAOAFyHEWBQAAAAAAAAAAAAAwEnDvKQoAAAAAAAAAAAAAYCRgXpeiAAAAAAAAAAAAfKcBvu8BFruJRuB1+gcAAAAASUVORK5CYII=',
  'base64',
)

/**
 * List the models an OpenAI-compatible endpoint advertises.
 *
 * Worth its own call: the configured model is the single field most likely to
 * be wrong, and typing it blind from documentation is how it gets wrong.
 *
 * @param options - endpoint, credential and cancellation.
 * @returns model ids, in the order the endpoint returned them.
 */
export async function listVisionModels({ baseUrl, apiKey, timeoutMs, signal }) {
  const deadline = AbortSignal.timeout(timeoutMs ?? 20_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: combined,
  }).catch((error) => {
    throw new Error(`could not reach ${baseUrl}: ${error?.message ?? error}`)
  })

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(`endpoint returned ${response.status} for /models: ${detail}`)
  }

  const payload = await response.json()
  const ids = (payload?.data ?? [])
    .map((entry) => entry?.id)
    .filter((id) => typeof id === 'string' && id !== '')
  if (ids.length === 0) throw new Error('endpoint listed no models')
  return ids
}

/**
 * Send one tiny image and time the round trip.
 *
 * Tests the path that actually matters — credential, model id, and vision
 * capability together — rather than just whether the host resolves.
 *
 * @param options - endpoint, model, credential and cancellation.
 * @returns latency and the model's reply.
 */
export async function testVision({ baseUrl, model, apiKey, timeoutMs, signal }) {
  const started = Date.now()
  const answer = await askVision({
    baseUrl,
    model,
    apiKey,
    images: [{ bytes: PROBE_PNG, mediaType: 'image/png' }],
    prompt: 'Reply with the single word: ok',
    timeoutMs,
    signal,
  })
  return { latencyMs: Date.now() - started, reply: answer.slice(0, 120) }
}

/** Media types the attachment service admits, and that endpoints accept. */
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/**
 * The instruction the vision model is given when the caller asks nothing
 * specific. It optimises for what a *text* model downstream can act on:
 * structure, text content, and state — not aesthetic description.
 */
export const DEFAULT_DESCRIBE_PROMPT =
  'You are the eyes of a text-only assistant that cannot see this image. It will act on what you '
  + 'report, so be precise and complete.\n\n'
  + 'Report, in this order: what kind of screen or image it is; every piece of text you can read, '
  + 'verbatim; the layout and any interactive elements with their labels and states; colours as '
  + 'concrete values where you can judge them; and anything that looks wrong, broken, or like an error.\n\n'
  + 'State plainly what you can see and what you cannot. Mark anything you are unsure of with '
  + '"(uncertain)" rather than hedging the whole answer — the assistant needs to know which specific '
  + 'facts to double-check, and treats everything unmarked as reliable. Never guess a value you '
  + 'cannot actually read; say it is illegible instead.'

/**
 * Encode bytes as a data URI the endpoint accepts.
 * @param bytes - raw image bytes.
 * @param mediaType - verified media type.
 * @returns a `data:` URI.
 */
function toDataUri(bytes, mediaType) {
  if (!MEDIA_TYPES.has(mediaType)) {
    throw new Error(`unsupported image type "${mediaType}"; expected one of ${[...MEDIA_TYPES].join(', ')}`)
  }
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
}

/**
 * Ask the configured vision model about one or more images.
 *
 * Every image is sent in a single request so the model can compare them; that
 * is the only way "what changed between these two screenshots" works at all.
 *
 * @param options - endpoint, credential, images, prompt and cancellation.
 * @returns the model's answer text.
 */
export async function askVision({ baseUrl, model, apiKey, images, prompt, timeoutMs, maxTokens, signal }) {
  if (images.length === 0) throw new Error('no images to look at')

  const parts = [
    { type: 'text', text: prompt || DEFAULT_DESCRIBE_PROMPT },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: toDataUri(image.bytes, image.mediaType) },
    })),
  ]

  // The caller's cancellation and our own deadline both have to reach fetch,
  // and only one signal fits — so combine them.
  const deadline = AbortSignal.timeout(timeoutMs ?? 60_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline

  let response
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: parts }],
        // A reasoning model will happily spend 1300 reasoning tokens on a
        // four-line answer; without a ceiling one runaway call eats the whole
        // deadline and returns nothing at all.
        ...maxTokens ? { max_tokens: maxTokens } : {},
      }),
      signal: combined,
    })
  } catch (error) {
    if (deadline.aborted) throw new Error(`vision endpoint did not answer within ${timeoutMs ?? 60_000}ms`)
    throw new Error(`vision endpoint unreachable: ${error?.message ?? error}`)
  }

  if (!response.ok) {
    // The body usually carries the actionable part (bad key, unknown model);
    // bound it so a HTML error page cannot flood the log.
    const detail = (await response.text().catch(() => '')).slice(0, 400)
    throw new Error(`vision endpoint returned ${response.status}: ${detail}`)
  }

  const payload = await response.json()
  const choice = payload?.choices?.[0]
  const answer = choice?.message?.content

  if (typeof answer !== 'string' || answer.trim() === '') {
    // A reasoning model spends the token budget thinking before it writes, so a
    // cap that looked generous can be consumed entirely by reasoning, leaving an
    // empty message. That is a budget problem with an obvious fix, and reporting
    // it as "no answer" sent the caller looking in the wrong place entirely.
    if (choice?.finish_reason === 'length') {
      const used = payload?.usage?.completion_tokens
      const reasoning = payload?.usage?.completion_tokens_details?.reasoning_tokens
      throw new Error(
        `vision response hit the token ceiling before writing an answer `
        + `(${used ?? '?'} generated, ${reasoning ?? '?'} of them reasoning). `
        + 'Raise maxTokens, or ask a narrower question — a cropped region with one question is cheapest.',
      )
    }
    throw new Error(`vision endpoint returned no answer text (finish_reason: ${choice?.finish_reason ?? 'absent'})`)
  }
  return answer.trim()
}
