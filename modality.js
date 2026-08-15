/**
 * Does the model driving this call accept images?
 *
 * This is the question that decides whether translation runs at all, and it is
 * answered from the LLM service rather than a hard-coded table, so switching
 * models switches behaviour with no configuration change.
 *
 * Resolution happens per call, never cached at activation: DSH lets a session
 * change model mid-conversation, and a cached answer would keep translating
 * for a model that no longer needs it (or worse, stop translating for one that
 * does — which fails the whole turn).
 *
 * @module @hazukishion/dsh-vision-bridge/modality
 */

/** What the probe concluded, and why — the `why` is surfaced in diagnostics. */
export const VERDICT = {
  ACCEPTS_IMAGES: 'accepts-images',
  TEXT_ONLY: 'text-only',
  UNKNOWN: 'unknown',
}

/**
 * Ask the adapter what the given route accepts.
 *
 * `inputModalities` is three-valued and the distinction matters: an explicit
 * list without `image` is a negative capability, while an absent list means the
 * adapter simply did not say. Treating "absent" as "text-only" would silently
 * degrade a multimodal model; treating it as "accepts images" would let an
 * un-translated block reach a text-only adapter and fail the entire turn. The
 * caller decides which risk to take, via `onUnknown`.
 *
 * @param ctx - plugin context carrying `ctx.llm`.
 * @param selection - provider and model for this call.
 * @param signal - optional cancellation for the adapter lookup.
 * @returns one of {@link VERDICT} plus the raw modalities for diagnostics.
 */
export async function probeModality(ctx, selection, signal) {
  const { provider, model } = selection ?? {}
  if (!provider || !model) {
    return { verdict: VERDICT.UNKNOWN, why: 'the call carried no provider/model route' }
  }

  let info
  try {
    info = await ctx.llm.resolveModelInfo(provider, model, signal)
  } catch (error) {
    return { verdict: VERDICT.UNKNOWN, why: `resolveModelInfo failed: ${error?.message ?? error}`, provider, model }
  }

  const modalities = info?.inputModalities
  if (modalities === undefined) {
    return { verdict: VERDICT.UNKNOWN, why: 'the adapter declared no inputModalities', provider, model }
  }

  return {
    verdict: modalities.includes('image') ? VERDICT.ACCEPTS_IMAGES : VERDICT.TEXT_ONLY,
    why: `adapter declares [${modalities.join(', ')}]`,
    provider,
    model,
    modalities: [...modalities],
  }
}

/**
 * Fold a probe result and the configured policy into one decision.
 * @param probe - result of {@link probeModality}.
 * @param config - plugin config carrying `translate` and `onUnknown`.
 * @returns whether to translate, and the reason to show in diagnostics.
 */
export function shouldTranslate(probe, config) {
  if (config.translate === 'off') return { translate: false, reason: 'translate is off' }
  if (config.translate === 'on') return { translate: true, reason: 'translate is forced on' }

  switch (probe.verdict) {
    case VERDICT.ACCEPTS_IMAGES:
      return { translate: false, reason: `${probe.model} accepts images (${probe.why})` }
    case VERDICT.TEXT_ONLY:
      return { translate: true, reason: `${probe.model} is text-only (${probe.why})` }
    default:
      return {
        translate: config.onUnknown !== 'off',
        reason: `model capability unknown (${probe.why}); applied onUnknown=${config.onUnknown}`,
      }
  }
}
