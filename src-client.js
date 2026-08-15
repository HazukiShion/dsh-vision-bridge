/**
 * Settings page for @hazukishion/dsh-vision-bridge.
 *
 * Plain CommonJS with `React.createElement` — no bundler, no transpiler.
 * `scripts/build-client.mjs` only adds the loader envelope.
 *
 * Layout and type follow the shipped Settings pages exactly, read off their
 * live computed styles rather than guessed: 18px/600 heading with its
 * description directly beneath, 14px field labels above a full-width control,
 * 13px muted help text below it, `--dsw-alias-border-l2` hairlines between
 * fields, and right-aligned Discard/Save that stay disabled until something
 * actually changed. Colours come from `--dsw-alias-*` tokens so both themes
 * work without a second palette.
 *
 * @module @hazukishion/dsh-vision-bridge/client
 */

const React = require('react')
const { Button, Input, StateDot, Toast } = require('@deepseek-ai/dsh-client-ui-primitives')

const NS = 'shion-vision-bridge'
const SETTINGS_ROUTE = '/_dsh/shion-vision-bridge/settings'

const h = React.createElement

const TRANSLATE_MODES = ['auto', 'on', 'off']
const ON_OFF = ['on', 'off']


const en = {
  nav: 'Vision',
  title: 'Vision bridge',
  intro: 'Describes images through an external vision model so a text-only model can read them, and shows pictures back to you on demand.',
  statusReady: 'Ready',
  statusNoEndpoint: 'No endpoint configured',
  statusNoCredential: 'Credential not configured',
  statusShowable: 'images showable',
  provider: 'Vision service',
  externalNotice: 'Translation and vision_ask send image bytes to this endpoint. The credential value never appears here or in settings.yaml.',
  baseUrl: 'Base URL',
  baseUrlHelp: 'An OpenAI-compatible endpoint, ending before /chat/completions.',
  model: 'Model',
  modelHelp: 'The vision model id at that endpoint.',
  credential: 'Credential reference',
  credentialHelp: 'Name of the stored credential holding the API key. Only the name is kept here.',
  translation: 'Translation',
  translate: 'Mode',
  translateHelp: 'auto describes images only for models that cannot read them. on always describes; off never does.',
  onUnknown: 'When the model declares no modality',
  onUnknownHelp: 'Some adapters do not say whether they accept images. Describing anyway is the safe choice: an unread image block fails the whole turn.',
  describePrompt: 'Description prompt',
  describePromptHelp: 'Replaces the built-in instruction given to the vision model. Leave blank to use it.',
  limits: 'Limits',
  maxImageBytes: 'Maximum image size',
  maxImageBytesHelp: 'Larger images are refused before upload, in bytes.',
  maxImages: 'Images per vision_ask call',
  maxImagesHelp: 'Pass several together only when they need comparing.',
  timeoutMs: 'Request timeout',
  timeoutMsHelp: 'Deadline for one vision endpoint request, in milliseconds.',
  displayCapacity: 'Handles kept resolvable',
  displayCapacityHelp: 'How many recent images show_image can still find. Already-issued links keep working regardless.',
  save: 'Save',
  discard: 'Discard',
  savedNote: 'Saved. Applies immediately.',
  retry: 'Retry',
  fetchModels: 'Fetch',
  fetching: 'Fetching…',
  testConn: 'Test',
  testing: 'Testing…',
  testOk: 'Reads images correctly',
  testBlind: 'Endpoint answered but did not read the picture —',
  modelsFound: 'models listed',
  modelEmpty: 'Fetch to list models',
  modelHint: 'Pick from what this endpoint lists. Fetch again after changing the base URL.',
}

const zh = {
  nav: '视觉',
  title: '视觉桥接',
  intro: '把图片交给外部视觉模型描述，让纯文本模型也能读懂；并在你需要时把原图展示回来。',
  statusReady: '就绪',
  statusNoEndpoint: '尚未配置端点',
  statusNoCredential: '凭证未配置',
  statusShowable: '张图片可展示',
  provider: '视觉服务',
  externalNotice: '转译和 vision_ask 会把图片字节发送到这个端点。凭证的值不会出现在这里，也不会写进 settings.yaml。',
  baseUrl: 'Base URL',
  baseUrlHelp: 'OpenAI 兼容的端点地址，写到 /chat/completions 之前为止。',
  model: '模型',
  modelHelp: '该端点上的视觉模型 id。',
  credential: '凭证引用名',
  credentialHelp: '存放 API key 的凭证名称。这里只保存名称，不保存值。',
  translation: '转译',
  translate: '模式',
  translateHelp: 'auto 只为读不了图的模型描述；on 总是描述；off 从不描述。',
  onUnknown: '模型未声明模态时',
  onUnknownHelp: '有些 adapter 不声明是否接受图片。此时仍然描述是更安全的选择——未经描述的图片块会让整轮失败。',
  describePrompt: '描述提示词',
  describePromptHelp: '替换内置的、给视觉模型的指令。留空则使用内置的。',
  limits: '限制',
  maxImageBytes: '单图大小上限',
  maxImageBytesHelp: '超过则在上传前拒绝，单位字节。',
  maxImages: 'vision_ask 单次图片数',
  maxImagesHelp: '只有需要相互比较时才一次传多张。',
  timeoutMs: '请求超时',
  timeoutMsHelp: '单次视觉端点请求的时限，单位毫秒。',
  displayCapacity: '保留可解析的 handle 数',
  displayCapacityHelp: 'show_image 还能找回最近多少张图。已经发出的链接不受此项影响。',
  save: '保存',
  discard: '放弃修改',
  savedNote: '已保存，立即生效。',
  retry: '重试',
  fetchModels: '拉取',
  fetching: '拉取中…',
  testConn: '测试',
  testing: '测试中…',
  testOk: '识图正常',
  testBlind: '端点通了，但没读出图里的内容 ——',
  modelsFound: '个模型可选',
  modelEmpty: '按「拉取」获取可选模型',
  modelHint: '从端点列出的模型里选。改了 Base URL 之后重新拉取。',
}

/** One vertical field: label, control, help text, hairline. */
function Field(props) {
  return h('div', { className: 'shion-set-field' },
    h('div', { className: 'shion-set-label' }, props.label),
    props.children,
    props.help ? h('div', { className: 'shion-set-help' }, props.help) : null)
}

function SettingsSection(props) {
  const t = props.t
  const [state, setState] = React.useState({ phase: 'loading' })
  const [draft, setDraft] = React.useState(undefined)
  const [note, setNote] = React.useState('')

  const load = React.useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`)
      setState({ phase: 'ready', config: data.config, status: data.status })
      setDraft(data.config)
      setNote('')
    } catch (error) {
      setState({ phase: 'error', error: error && error.message ? error.message : String(error) })
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  const [models, setModels] = React.useState([])
  const [busy, setBusy] = React.useState('')

  // Outcome lands in two places, neither of which costs layout: the button
  // flashes green or red for a moment, and a toast carries the words. Earlier
  // versions printed the result beside the button, which read fine but pushed
  // the row around and left a stale sentence sitting there afterwards.
  const [flash, setFlash] = React.useState({})
  const [toast, setToast] = React.useState(undefined)
  const flashTimers = React.useRef({})

  const say = (action, ok, message) => {
    // Functional update: `toast` in this closure is whatever it was when the
    // handler was created, which is not the sequence we need to advance.
    setToast((current) => ({ text: message, seq: (current?.seq ?? 0) + 1 }))
    setFlash((current) => Object.assign({}, current, { [action]: ok ? 'ok' : 'bad' }))
    clearTimeout(flashTimers.current[action])
    flashTimers.current[action] = setTimeout(
      () => setFlash((current) => Object.assign({}, current, { [action]: '' })),
      1200,
    )
  }

  React.useEffect(() => () => {
    for (const id of Object.values(flashTimers.current)) clearTimeout(id)
  }, [])

  // A dropdown with nothing in it is a dead control, so fill it as soon as the
  // page opens rather than making Fetch a required first step. Failures stay
  // quiet here: the endpoint may simply be unreachable right now, and the
  // button beside the field is the loud path that reports why.
  const savedBaseUrl = state.phase === 'ready' ? String(state.config.baseUrl || '') : ''
  React.useEffect(() => {
    if (!savedBaseUrl) return undefined
    let cancelled = false
    fetch(SETTINGS_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'models', baseUrl: savedBaseUrl }),
    })
      .then((response) => response.json())
      .then((data) => { if (!cancelled && data?.result?.models) setModels(data.result.models) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [savedBaseUrl])

  /** Run a named server action against the values currently on screen. */
  const act = async (action, extra) => {
    setBusy(action)
    try {
      const response = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await response.json()
      if (data?.error) throw new Error(data.error)
      return data.result
    } finally {
      setBusy('')
    }
  }

  const save = async () => {
    try {
      const response = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch: draft }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`)
      setState({ phase: 'ready', config: data.config, status: data.status })
      setDraft(data.config)
      setNote(t('savedNote'))
    } catch (error) {
      setNote(error && error.message ? error.message : String(error))
    }
  }

  if (state.phase === 'loading') return h('div', { className: 'shion-set-page' })
  if (state.phase === 'error') {
    return h('div', { className: 'shion-set-page' },
      h('div', { className: 'shion-set-status' }, state.error),
      h('div', { className: 'shion-set-actions' },
        h(Button, { variant: 'primary', size: 'sm', onClick: load }, t('retry'))))
  }

  const config = state.config
  const status = state.status || {}
  const credential = status.credential || {}
  // Editing any field can invalidate a probe result — a test against the old
  // base URL says nothing about the one now on screen.
  const set = (key, value) => {
    setDraft(Object.assign({}, draft, { [key]: value }))
    setNote('')
    setProbe({ models: '', test: '' })
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(config)

  // Whatever is configured stays selectable even if the endpoint no longer
  // lists it — dropping it would quietly rewrite the setting on first save.
  const modelOptions = models.slice()
  const currentModel = String(draft.model ?? '')
  if (currentModel && modelOptions.indexOf(currentModel) < 0) modelOptions.unshift(currentModel)

  const text = (key, placeholder) => h(Input, {
    value: String(draft[key] ?? ''),
    ...placeholder ? { placeholder } : {},
    onChange: (event) => set(key, event.target.value),
  })
  const numberField = (key) => h(Input, {
    value: String(draft[key] ?? ''),
    inputMode: 'numeric',
    onChange: (event) => {
      const raw = event.target.value.replace(/[^0-9]/g, '')
      set(key, raw === '' ? '' : Number(raw))
    },
  })
  const choice = (key, options) => h('select', {
    className: 'shion-set-select',
    value: options.indexOf(draft[key]) >= 0 ? draft[key] : options[0],
    onChange: (event) => set(key, event.target.value),
  }, options.map((id) => h('option', { key: id, value: id }, id)))

  // The endpoint and the credential are two separate ways to be unusable, so
  // report whichever is actually missing rather than one vague "not ready".
  const ok = Boolean(status.endpoint) && credential.configured === true
  const statusText = !status.endpoint
    ? t('statusNoEndpoint')
    : credential.configured === true
      ? `${t('statusReady')} · ${status.endpoint}`
      : t('statusNoCredential')

  return h('div', { className: 'shion-set-page' },
    h('div', { className: 'shion-set-head' },
      h('h2', { className: 'shion-set-title' }, t('title')),
      h('p', { className: 'shion-set-intro' }, t('intro'))),

    h('div', { className: 'shion-set-status' },
      h('div', { className: 'shion-set-status-line' },
        h(StateDot, { state: ok ? 'done' : 'warning', size: 8 }),
        h('span', null, statusText),
        h('span', { className: 'shion-set-status-meta' },
          `${status.showable ?? 0} ${t('statusShowable')}`)),
      credential.source
        ? h('div', { className: 'shion-set-status-line' },
          h('span', { className: 'shion-set-status-meta', style: { marginLeft: 0 } },
            `${draft.credential} · ${credential.source}`))
        : null),

    h('div', { className: 'shion-set-group' },
      h('div', { className: 'shion-set-group-title' }, t('provider')),
      h('p', { className: 'shion-set-notice' }, t('externalNotice')),
      h(Field, { label: t('baseUrl'), help: t('baseUrlHelp') }, text('baseUrl', 'https://api.example.com/v1')),

      // A plain <select>, not an <input list=…>: the dual-mode field read well
      // on paper, but the webview draws the datalist popup detached from its
      // input, and that position is the browser's to decide — no CSS reaches
      // it. The saved value is always an option, so a model the endpoint stops
      // advertising still shows what is configured instead of silently
      // switching to something else.
      h(Field, { label: t('model'), help: t('modelHint') },
        h('div', { className: 'shion-vb-inline' },
          h('select', {
            className: 'shion-set-select',
            value: String(draft.model ?? ''),
            onChange: (event) => set('model', event.target.value),
          },
          modelOptions.length === 0
            ? h('option', { value: '' }, t('modelEmpty'))
            : modelOptions.map((id) => h('option', { key: id, value: id }, id))),
          h(Button, {
            variant: 'ghost', size: 'sm',
            disabled: busy !== '' || !draft.baseUrl,
            onClick: async () => {
              try {
                const result = await act('models', { baseUrl: draft.baseUrl })
                setModels(result.models || [])
                say('models', true, `${(result.models || []).length} ${t('modelsFound')}`)
              } catch (error) { say('models', false, error.message) }
            },
            className: flash.models ? `shion-vb-flash-${flash.models}` : undefined,
          }, busy === 'models' ? t('fetching') : t('fetchModels')),

          // Test sits beside Fetch because that is the order of the work: pick
          // a model, then find out whether that model can actually see.
          h(Button, {
            variant: 'ghost', size: 'sm',
            disabled: busy !== '' || !draft.baseUrl || !draft.model,
            onClick: async () => {
              try {
                const result = await act('test', { baseUrl: draft.baseUrl, model: draft.model })
                // Three outcomes, not two: unreachable, reachable but blind,
                // and working. The middle one looks like success on the wire,
                // so it flashes red — it is a failure of the thing being tested.
                say('test', result.read,
                  result.read
                    ? `${t('testOk')} · ${result.latencyMs}ms`
                    : `${t('testBlind')} "${result.reply}"`)
              } catch (error) { say('test', false, error.message) }
            },
            className: flash.test ? `shion-vb-flash-${flash.test}` : undefined,
          }, busy === 'test' ? t('testing') : t('testConn')))),

      h(Field, { label: t('credential'), help: t('credentialHelp') }, text('credential'))),

    h('div', { className: 'shion-set-group' },
      h('div', { className: 'shion-set-group-title' }, t('translation')),
      h(Field, { label: t('translate'), help: t('translateHelp') }, choice('translate', TRANSLATE_MODES)),
      h(Field, { label: t('onUnknown'), help: t('onUnknownHelp') }, choice('onUnknown', ON_OFF)),
      h(Field, { label: t('describePrompt'), help: t('describePromptHelp') }, text('describePrompt'))),

    h('div', { className: 'shion-set-group' },
      h('div', { className: 'shion-set-group-title' }, t('limits')),
      h(Field, { label: t('maxImageBytes'), help: t('maxImageBytesHelp') }, numberField('maxImageBytes')),
      h(Field, { label: t('maxImages'), help: t('maxImagesHelp') }, numberField('maxImages')),
      h(Field, { label: t('timeoutMs'), help: t('timeoutMsHelp') }, numberField('timeoutMs')),
      h(Field, { label: t('displayCapacity'), help: t('displayCapacityHelp') }, numberField('displayCapacity'))),

    toast ? h(Toast, {
      key: toast.seq,
      text: toast.text,
      onDone: () => setToast(undefined),
    }) : null,

    h('div', { className: 'shion-set-actions' },
      note ? h('span', { className: 'shion-set-note' }, note) : null,
      h(Button, { variant: 'ghost', size: 'sm', disabled: !dirty, onClick: () => { setDraft(config); setNote('') } }, t('discard')),
      h(Button, { variant: 'primary', size: 'sm', disabled: !dirty, onClick: save }, t('save'))))
}

/** Styles built from the shipped tokens, so both themes follow automatically. */
function installStyles() {
  const style = document.createElement('style')
  style.textContent = `
    .shion-set-page { display: flex; flex-direction: column; }
    .shion-set-head { margin-bottom: 20px; }
    .shion-set-title { font-size: 18px; font-weight: 600; line-height: 1.4; margin: 0 0 4px; color: var(--dsw-alias-label-primary); }
    .shion-set-intro { font-size: 13px; line-height: 1.6; margin: 0; color: var(--dsw-alias-label-secondary); }

    .shion-set-status {
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px; border-radius: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      font-size: 13px; color: var(--dsw-alias-label-secondary);
    }
    .shion-set-status-line { display: flex; align-items: center; gap: 8px; }
    .shion-set-status-meta { margin-left: auto; color: var(--dsw-alias-label-tertiary); }
    .shion-set-notice { font-size: 13px; line-height: 1.55; margin: 0 0 4px; color: var(--dsw-alias-label-tertiary); }

    .shion-set-group { margin-top: 24px; }
    .shion-set-group-title { font-size: 13px; font-weight: 600; margin: 0 0 2px; color: var(--dsw-alias-label-tertiary); }

    .shion-set-field { padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
    .shion-set-field:last-child { border-bottom: none; }
    .shion-set-label { font-size: 14px; line-height: 1.5; margin-bottom: 6px; color: var(--dsw-alias-label-primary); }
    .shion-set-help { font-size: 13px; line-height: 1.55; margin-top: 6px; color: var(--dsw-alias-label-tertiary); }

    .shion-set-toggle { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; cursor: pointer; }
    .shion-set-toggle .shion-set-label { margin-bottom: 0; }
    .shion-set-toggle .shion-set-help { margin-top: 4px; }
    .shion-set-checkbox { width: 16px; height: 16px; margin: 3px 0 0; flex: none; accent-color: var(--dsw-alias-label-primary); }

    /* The Input primitive wraps its field in an inline-flex <span> fixed at
       160px. Shipped Settings fields are full width, so stretch the wrapper —
       targeting the input alone does nothing, because the wrapper is what
       constrains it. */
    .shion-set-field > span:has(> input:not([type="checkbox"])) { display: flex; width: 100%; }
    .shion-set-field input:not([type="checkbox"]) { width: 100%; min-width: 0; box-sizing: border-box; }

    .shion-set-select {
      width: 100%; height: 34px; padding: 0 10px; font: inherit; font-size: 13px;
      border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
      background: transparent; color: var(--dsw-alias-label-primary);
    }

    /* Width and height read as one measurement, so keep each label welded to
       its own box instead of letting flex spread them across the row. */
    .shion-set-pair { display: flex; align-items: center; gap: 10px; }
    .shion-set-pair > span:has(> input) { flex: 1; min-width: 0; display: flex; }
    .shion-set-pair-label { font-size: 13px; color: var(--dsw-alias-label-tertiary); flex: none; margin-right: -4px; }
    .shion-set-pair-x { color: var(--dsw-alias-label-tertiary); flex: none; padding: 0 2px; }

    .shion-set-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 16px; }
    .shion-set-note { margin-right: auto; font-size: 13px; color: var(--dsw-alias-label-tertiary); }

    /* Control takes the row, button keeps its natural size, result follows it. */
    .shion-vb-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .shion-vb-inline > select { flex: 1 1 180px; }
    .shion-vb-inline > span:has(> input) { flex: 1; min-width: 0; display: flex; }
    /* The button says it worked before the words arrive: a short tint, then
       back to normal.

       Literal colours, not the app's --dsw-alias-state-* tokens, and that is
       measured rather than lazy: those aliases ARE defined in this scope but
       resolve through --dsw-static-* variables that are not, so the whole
       declaration becomes invalid at computed-value time and the background
       falls back to transparent — a var() fallback only applies when the
       variable is undefined, never when its value fails to resolve. The flash
       silently did nothing. These two read correctly on both themes. */
    .shion-vb-flash-ok, .shion-vb-flash-bad { transition: background-color 140ms ease, color 140ms ease; }
    .shion-vb-flash-ok { background: #22c55e !important; color: #06210f !important; }
    .shion-vb-flash-bad { background: #ef4444 !important; color: #2a0808 !important; }
  `
  document.head.append(style)
  return () => { style.remove() }
}

/** Client services this bundle needs. */
exports.inject = ['slots', 'locale']

/**
 * Register the Settings section.
 * @param ctx - client context.
 */
exports.apply = function apply(ctx) {
  ctx.effect(installStyles, 'shion-vision-bridge: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'shion-vision-bridge: locale')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 41,
    label: () => t('nav'),
    inject: () => ({ t }),
  }, SettingsSection))
}
