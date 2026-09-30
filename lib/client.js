/**
 * dsh-ollama-cloud — browser half.
 *
 * Two seats in the host's own surfaces, no separate page and no other client
 * package involved:
 *
 * - `settings.models.provider-card` (keyed by this plugin's settings
 *   namespace): the Ollama Cloud usage card inside the Models page row, with
 *   one meter per billing window, the primary window's per-model request
 *   counts, the write-only API-key field, and a refresh control.
 * - `sidebar.footer.action`: a compact remaining-quota progress bar
 *   (label + percentage on one line, the bar under it) that expands into the
 *   same window detail, refreshed on mount and on an interval. The collapsed
 *   rail keeps a mini bar with no text.
 *
 * Everything credentialed happens on the host: this half only calls the
 * plugin's own connection channel (`/ollama-cloud`) and never sees the key.
 * Styling uses host theme tokens exclusively, so light/dark and any future
 * re-theming apply without this file changing.
 *
 * Written by hand in the loader's lazy-factory format; `scripts/build-client.mjs`
 * copies it into `lib/client.js`. `internals` is exported for the tests that
 * pin the pure helpers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ollama-cloud',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** RPC channel and endpoints registered by the host half. */
    const RPC_CHANNEL = '/ollama-cloud'
    const USAGE_ENDPOINT = 'usage/read'
    const CREDENTIAL_STATUS_ENDPOINT = 'credential/status'
    const CREDENTIAL_SET_ENDPOINT = 'credential/set'

    /** Slots this half occupies. */
    const CARD_SLOT = 'settings.models.provider-card'
    const SIDEBAR_SLOT = 'sidebar.footer.action'

    /** Loader row id, which is also the settings namespace the card is keyed by. */
    const SETTINGS_NAMESPACE = 'llm-ollama-cloud'

    const LOCALE_NAMESPACE = 'plugin.ollama-cloud'
    /** Id of the single stylesheet this half owns. */
    const STYLE_ELEMENT_ID = 'dsh-ollama-cloud-styles'

    /** A snapshot younger than this answers without another round trip. */
    const FRESH_MS = 5 * 60 * 1000
    /** Sidebar polling cadence while the row is mounted. */
    const POLL_MS = 15 * 60 * 1000
    /** Window display order; the first one present is the primary window. */
    const WINDOW_ORDER = ['monthly', 'session', 'weekly']
    /** Remaining percentages at or under this point flip the meter's severity. */
    const WARN_REMAINING = 20
    /** Fallback reset cadences when the endpoint discloses no reset instant. */
    const FALLBACK_RESET = { session: { hours: 5 }, weekly: { days: 7 }, monthly: { days: 30 } }

    const COPY = {
      zh: {
        usageTitle: '云端用量',
        usageRefresh: '刷新',
        usageRefreshing: '刷新中…',
        usageMonthly: '月度用量',
        usageSession: '会话用量',
        usageWeekly: '周用量',
        usageRemaining: '剩余 {percent}%',
        usageResetsAt: '{time} 重置',
        usageResetsEveryHours: '每 {count} 小时重置',
        usageResetsEveryDays: '每 {count} 天重置',
        usageModels: '用量来源',
        usageRequests: '{count} 次请求',
        usageUpdatedAt: '更新于 {time}',
        usageUnsupported: '此端点不上报云端用量。',
        usageNeedsRestart: '用量将在宿主重新加载本插件后出现（请重启 dsh）。',
        usageUnreachable: '无法读取 Ollama Cloud 用量，请检查网络与 API 地址。',
        usageCredential: 'Ollama Cloud 拒绝了当前 API Key，请检查下方密钥。',
        usageFailed: '读取用量失败。',
        usageLoading: '正在读取用量…',
        usageKeyTitle: 'API Key',
        usageKeyPlaceholder: '粘贴 Ollama Cloud API Key',
        usageKeySave: '保存',
        usageKeySaving: '保存中…',
        usageKeyConfigured: '已配置',
        usageKeyMissing: '未配置',
        usageKeyFailed: '保存失败：{message}',
        usageSidebarLabel: 'Ollama Cloud 额度',
        usageSidebarUnavailable: '额度不可用',
        usageSidebarHint: '点击查看分窗口用量',
      },
      en: {
        usageTitle: 'Cloud usage',
        usageRefresh: 'Refresh',
        usageRefreshing: 'Refreshing…',
        usageMonthly: 'Monthly usage',
        usageSession: 'Session usage',
        usageWeekly: 'Weekly usage',
        usageRemaining: '{percent}% left',
        usageResetsAt: 'Resets at {time}',
        usageResetsEveryHours: 'Resets every {count} hours',
        usageResetsEveryDays: 'Resets every {count} days',
        usageModels: 'Usage sources',
        usageRequests: '{count} requests',
        usageUpdatedAt: 'Updated {time}',
        usageUnsupported: 'This endpoint does not report cloud usage.',
        usageNeedsRestart: 'Usage appears after the running host reloads this plugin (restart dsh).',
        usageUnreachable: 'Could not reach Ollama Cloud usage. Check the network and API URL.',
        usageCredential: 'Ollama Cloud refused the current API key; check the key below.',
        usageFailed: 'Reading usage failed.',
        usageLoading: 'Reading usage…',
        usageKeyTitle: 'API key',
        usageKeyPlaceholder: 'Paste the Ollama Cloud API key',
        usageKeySave: 'Save',
        usageKeySaving: 'Saving…',
        usageKeyConfigured: 'Configured',
        usageKeyMissing: 'Not configured',
        usageKeyFailed: 'Save failed: {message}',
        usageSidebarLabel: 'Ollama Cloud quota',
        usageSidebarUnavailable: 'Quota unavailable',
        usageSidebarHint: 'Open the per-window usage',
      },
    }

    /**
     * Stylesheet for both seats. Host tokens only (`--dsw-alias-*` for colour
     * and ink, `--dsw-radius-*` for corners), so it follows the host theme; the
     * unfilled meter track is the fill's own hue at low alpha, which keeps the
     * severity readable across the whole bar.
     */
    const CSS = `
.dshoc-root { display: flex; flex-direction: column; gap: 10px; padding: 10px 0 2px; }
.dshoc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dshoc-title { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-primary); margin: 0; font-weight: 500; }
.dshoc-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); margin: 0; }
.dshoc-error { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); margin: 0; }
.dshoc-button { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: transparent;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); padding: 2px 8px; cursor: pointer; }
.dshoc-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshoc-button:disabled { cursor: default; opacity: 0.6; }
.dshoc-windows { display: flex; flex-direction: column; gap: 8px; }
.dshoc-window { display: flex; flex-direction: column; gap: 4px; }
.dshoc-window-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dshoc-window-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshoc-window-value { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums; }
.dshoc-meter { height: 6px; border-radius: 999px; overflow: hidden; }
.dshoc-meter-track { height: 100%; width: 100%; border-radius: 999px; color: var(--dsw-alias-state-business-primary);
  background: color-mix(in oklab, currentColor 16%, transparent); }
.dshoc-meter-track[data-severity="warn"] { color: var(--dsw-alias-state-warn-primary); }
.dshoc-meter-track[data-severity="critical"] { color: var(--dsw-alias-state-error-primary); }
.dshoc-meter-fill { height: 100%; background: currentColor; border-radius: 999px; transition: width 200ms ease; }
.dshoc-skeleton { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-skeleton); }
.dshoc-models { display: flex; flex-direction: column; gap: 2px; }
.dshoc-models-title { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); margin: 2px 0 0; }
.dshoc-model-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dshoc-model-name { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshoc-model-count { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums; }
.dshoc-key { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 8px; }
.dshoc-key-line { display: flex; align-items: center; gap: 6px; }
.dshoc-key-input { flex: 1; min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm); padding: 2px 8px; }
.dshoc-key-state { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshoc-foot { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); }
.dshoc-sidebar { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
.dshoc-sidebar-button { display: flex; flex-direction: column; gap: 5px; width: 100%; min-width: 0; text-align: left;
  background: transparent; border: 0; border-radius: var(--dsw-radius-sm); padding: 6px 8px; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.dshoc-sidebar-button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshoc-sidebar-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.dshoc-sidebar-label { color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.dshoc-sidebar-button:hover .dshoc-sidebar-label { color: var(--dsw-alias-label-primary); }
.dshoc-sidebar-value { flex: none; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary);
  white-space: nowrap; }
.dshoc-bar { display: block; height: 6px; width: 100%; border-radius: 999px; overflow: hidden;
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in oklab, currentColor 16%, transparent); }
.dshoc-bar[data-severity="warn"] { color: var(--dsw-alias-state-warn-primary); }
.dshoc-bar[data-severity="critical"] { color: var(--dsw-alias-state-error-primary); }
.dshoc-bar[data-severity="none"] { color: var(--dsw-alias-label-tertiary); }
.dshoc-bar[data-loading="true"] { color: transparent; background: var(--dsw-alias-bg-skeleton); }
.dshoc-bar-fill { display: block; height: 100%; border-radius: 999px; background: currentColor;
  transition: width 240ms ease; }
.dshoc-sidebar-hint-line { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-caption);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshoc-rail { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 100%; }
.dshoc-rail-button { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%;
  background: transparent; border: 0; border-radius: var(--dsw-radius-sm); padding: 5px 0; cursor: pointer;
  color: var(--dsw-alias-label-secondary); }
.dshoc-rail-button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshoc-rail-bar { width: 26px; height: 4px; }
.dshoc-rail-value { font-size: 10px; line-height: 12px; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums; }
.dshoc-sidebar-panel { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; }
`

    /** Translate one window id into its copy key. */
    function windowCopyKey(id) {
      if (id === 'monthly') return 'usageMonthly'
      if (id === 'session') return 'usageSession'
      return 'usageWeekly'
    }

    /** Whether `value` is a plain object. */
    function isRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    /**
     * Decode one `usage/read` reply, whose shape is the host's
     * `WireUsageSnapshot` (`fetchedAt` plus optional `session`/`weekly`/`monthly`
     * objects). The host is trusted more than a provider is, but the reply
     * still crosses a process boundary: anything that does not match the
     * contract is refused rather than rendered.
     * @param value - decoded RPC value.
     * @returns the snapshot, the unsupported marker, or undefined.
     */
    function decodeUsageReply(value) {
      if (!isRecord(value)) return undefined
      if (value.status === 'unsupported') return { status: 'unsupported' }
      if (value.status !== 'ok' || !isRecord(value.usage) || typeof value.usage.fetchedAt !== 'string') return undefined
      const windows = []
      for (const id of WINDOW_ORDER) {
        const candidate = value.usage[id]
        if (candidate === undefined) continue
        if (!isRecord(candidate)) return undefined
        if (typeof candidate.usage !== 'number' || !Number.isFinite(candidate.usage) || candidate.usage < 0) {
          return undefined
        }
        const models = []
        if (Array.isArray(candidate.models)) {
          for (const model of candidate.models) {
            if (!isRecord(model)) continue
            if (typeof model.name !== 'string' || typeof model.requestCount !== 'number') continue
            models.push({ name: model.name, requestCount: model.requestCount })
          }
        }
        windows.push({
          id,
          usedFraction: candidate.usage,
          models,
          ...typeof candidate.resetsAt === 'string' ? { resetsAt: candidate.resetsAt } : {},
        })
      }
      return { status: 'ok', usage: { fetchedAt: value.usage.fetchedAt, windows } }
    }

    /** Remaining share of a window as a 0..100 percentage, rounded to a tenth. */
    function remainingPercent(usedFraction) {
      const remaining = 100 * (1 - usedFraction)
      return Math.min(100, Math.max(0, Math.round(remaining * 10) / 10))
    }

    /** Severity for one meter; the numeric label always states the value too. */
    function severityOf(remaining) {
      if (remaining <= 0) return 'critical'
      if (remaining <= WARN_REMAINING) return 'warn'
      return 'ok'
    }

    /** One instant as a short local clock time. */
    function formatClock(iso) {
      const parsed = new Date(iso)
      if (Number.isNaN(parsed.getTime())) return undefined
      const hours = String(parsed.getHours()).padStart(2, '0')
      const minutes = String(parsed.getMinutes()).padStart(2, '0')
      return `${hours}:${minutes}`
    }

    /** Reset label for one window: the disclosed instant, or the documented cadence. */
    function resetLabelOf(window, t) {
      const clock = typeof window.resetsAt === 'string' ? formatClock(window.resetsAt) : undefined
      if (clock !== undefined) return t('usageResetsAt', { time: clock })
      const fallback = FALLBACK_RESET[window.id]
      if (fallback === undefined) return undefined
      return fallback.hours === undefined
        ? t('usageResetsEveryDays', { count: String(fallback.days) })
        : t('usageResetsEveryHours', { count: String(fallback.hours) })
    }

    /** The window whose model counts the card shows first. */
    function primaryWindow(windows) {
      for (const id of WINDOW_ORDER) {
        const found = windows.find((window) => window.id === id)
        if (found !== undefined) return found
      }
      return undefined
    }

    /** One shared snapshot store: both seats read it, either can refresh it. */
    const store = (() => {
      let state = {
        status: 'idle',
        usage: undefined,
        error: undefined,
        code: undefined,
        updatedAt: undefined,
        refreshing: false,
      }
      const listeners = new Set()
      let inFlight
      let lastReadAt = 0
      const emit = () => {
        for (const listener of listeners) listener()
      }
      const set = (patch) => {
        state = Object.assign({}, state, patch)
        emit()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        async read(rpc, options) {
          const force = options !== undefined && options.force === true
          if (rpc === undefined) {
            set({ status: 'error', error: 'unavailable', code: 'unavailable', refreshing: false })
            return undefined
          }
          if (inFlight !== undefined) return inFlight
          if (!force && state.status === 'ready' && Date.now() - lastReadAt < FRESH_MS) return undefined
          set({ refreshing: true })
          inFlight = (async () => {
            try {
              const result = await rpc.call(RPC_CHANNEL, USAGE_ENDPOINT, {})
              if (result === undefined || result.ok !== true) {
                const failure = result !== undefined && result.error !== undefined ? result.error : {}
                warn(failure.code, failure.message)
                set({ status: 'error', error: failure.message, code: failure.code, refreshing: false })
                return
              }
              const decoded = decodeUsageReply(result.value)
              if (decoded === undefined) {
                warn('invalid-reply', 'the host answered with a snapshot this half cannot decode')
                set({ status: 'error', error: 'invalid usage snapshot', code: 'invalid-reply', refreshing: false })
                return
              }
              lastReadAt = Date.now()
              if (decoded.status === 'unsupported') {
                set({ status: 'unsupported', error: undefined, code: undefined, refreshing: false })
                return
              }
              set({
                status: 'ready',
                usage: decoded.usage,
                error: undefined,
                code: undefined,
                updatedAt: new Date(),
                refreshing: false,
              })
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              warn('transport', message)
              set({ status: 'error', error: message, code: 'transport', refreshing: false })
            } finally {
              inFlight = undefined
            }
          })()
          return inFlight
        },
      }
    })()

    /** Subscribe one component to the store. */
    function useStore() {
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    }

    /** Report one failure detail to the console; the UI shows localized copy. */
    function warn(code, message) {
      console.warn('[dsh-ollama-cloud]', code, message)
    }

    /** Resolve the RPC client lazily, so a late connection service is honored. */
    function rpcOf(ctx) {
      const connection = ctx.get('connection')
      return connection === undefined ? undefined : connection.rpc
    }

    /**
     * Failure copy for one store state. Copy is always the locale's; the host's
     * own message is a diagnostic and goes to the console instead of a
     * localized page.
     */
    function failureText(state, t) {
      if (state.code === 'unavailable' || state.code === 'unknown-endpoint') return t('usageNeedsRestart')
      if (state.code === 'INVALID_CREDENTIAL') return t('usageCredential')
      if (state.code === 'transport') return t('usageUnreachable')
      return t('usageFailed')
    }

    /** Copy for an empty panel: the state decides, and copy is always localized. */
    function panelEmptyText(state, t) {
      if (state.status === 'unsupported') return t('usageUnsupported')
      if (state.status === 'error') return failureText(state, t)
      return t('usageLoading')
    }

    /** One meter with its always-visible numeric label. */
    function Meter(props) {
      const remaining = remainingPercent(props.window.usedFraction)
      const severity = severityOf(remaining)
      return h(
        'div',
        { className: 'dshoc-window' },
        h(
          'div',
          { className: 'dshoc-window-line' },
          h('span', { className: 'dshoc-window-label' }, props.label),
          h('span', { className: 'dshoc-window-value' }, props.valueText),
        ),
        h(
          'div',
          { className: 'dshoc-meter', role: 'img', 'aria-label': props.label + ': ' + props.valueText },
          h(
            'div',
            { className: 'dshoc-meter-track', 'data-severity': severity },
            h('div', { className: 'dshoc-meter-fill', style: { width: String(100 - remaining) + '%' } }),
          ),
        ),
        props.hint === undefined ? null : h('p', { className: 'dshoc-hint' }, props.hint),
      )
    }

    /** The API-key field: write-only, so it starts empty and reports state beside it. */
    function KeyField(props) {
      const t = props.t
      const [value, setValue] = React.useState('')
      const [state, setState] = React.useState({ status: 'idle' })
      const configured = props.configured === true
      async function save() {
        if (value.length === 0 || state.status === 'saving') return
        const rpc = props.rpc()
        if (rpc === undefined) {
          setState({ status: 'failed', message: t('usageNeedsRestart') })
          return
        }
        setState({ status: 'saving' })
        const result = await props.saveCredential(rpc, value)
        if (result !== undefined && result.ok === true) {
          setValue('')
          setState({ status: 'saved' })
          props.onSaved()
          return
        }
        const message = result !== undefined && result.error !== undefined ? result.error.message : t('usageFailed')
        setState({ status: 'failed', message })
      }
      return h(
        'div',
        { className: 'dshoc-key' },
        h(
          'div',
          { className: 'dshoc-key-line' },
          h('span', { className: 'dshoc-window-label' }, t('usageKeyTitle')),
          h('input', {
            className: 'dshoc-key-input',
            type: 'password',
            autoComplete: 'new-password',
            'aria-label': t('usageKeyTitle'),
            placeholder: t('usageKeyPlaceholder'),
            value,
            onChange: (event) => setValue(event.target.value),
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'dshoc-button',
              disabled: value.length === 0 || state.status === 'saving',
              onClick: save,
            },
            state.status === 'saving' ? t('usageKeySaving') : t('usageKeySave'),
          ),
        ),
        h(
          'span',
          { className: 'dshoc-key-state' },
          state.status === 'failed'
            ? t('usageKeyFailed', { message: state.message })
            : configured ? t('usageKeyConfigured') : t('usageKeyMissing'),
        ),
      )
    }

    /** The Models-page card. */
    function UsageCard(props) {
      const t = props.t
      const state = useStore()
      const [credential, setCredential] = React.useState(undefined)
      React.useEffect(() => {
        const rpc = rpcOf(props.ctx)
        if (rpc === undefined) return undefined
        let cancelled = false
        rpc.call(RPC_CHANNEL, CREDENTIAL_STATUS_ENDPOINT, {}).then(
          (result) => {
            if (!cancelled && result !== undefined && result.ok === true) setCredential(result.value)
          },
          () => {},
        )
        return () => {
          cancelled = true
        }
      }, [props.ctx])
      React.useEffect(() => {
        void store.read(rpcOf(props.ctx))
      }, [props.ctx])

      const windows = state.usage === undefined ? [] : state.usage.windows
      const primary = primaryWindow(windows)
      const body = []
      if (state.status === 'idle' || (state.status === 'ready' && windows.length === 0)) {
        body.push(h('div', { className: 'dshoc-windows', key: 'skeleton' }, h('div', { className: 'dshoc-skeleton' })))
      } else if (state.status === 'unsupported') {
        // Retained numbers stay, and the state is still stated: a snapshot the
        // endpoint no longer reports must not pass for a current one.
        body.push(h('p', { className: 'dshoc-hint', key: 'unsupported' }, t('usageUnsupported')))
      } else if (state.status === 'error' && windows.length === 0) {
        body.push(h('p', { className: 'dshoc-error', key: 'error' }, failureText(state, t)))
      }
      if (windows.length > 0) {
        body.push(
          h(
            'div',
            { className: 'dshoc-windows', key: 'windows' },
            windows.map((window) =>
              h(Meter, {
                key: window.id,
                window,
                label: t(windowCopyKey(window.id)),
                valueText: t('usageRemaining', { percent: String(remainingPercent(window.usedFraction)) }),
                hint: resetLabelOf(window, t),
              }),
            ),
          ),
        )
      }
      if (primary !== undefined && primary.models.length > 0) {
        body.push(
          h(
            'div',
            { className: 'dshoc-models', key: 'models' },
            h('p', { className: 'dshoc-models-title' }, t('usageModels')),
            primary.models.map((model) =>
              h(
                'div',
                { className: 'dshoc-model-row', key: model.name },
                h('span', { className: 'dshoc-model-name', title: model.name }, model.name),
                h('span', { className: 'dshoc-model-count' }, t('usageRequests', { count: String(model.requestCount) })),
              ),
            ),
          ),
        )
      }
      const configured = credential !== undefined
        ? credential.configured === true
        : props.keyConfigured === true

      return h(
        'section',
        { className: 'dshoc-root', 'aria-label': t('usageTitle') },
        h(
          'div',
          { className: 'dshoc-head' },
          h('h3', { className: 'dshoc-title' }, t('usageTitle')),
          h(
            'button',
            {
              type: 'button',
              className: 'dshoc-button',
              disabled: state.refreshing === true,
              onClick: () => void store.read(rpcOf(props.ctx), { force: true }),
            },
            state.refreshing === true ? t('usageRefreshing') : t('usageRefresh'),
          ),
        ),
        body,
        h(KeyField, {
          t,
          configured,
          rpc: () => rpcOf(props.ctx),
          saveCredential: (rpc, value) => rpc.call(RPC_CHANNEL, CREDENTIAL_SET_ENDPOINT, { value }),
          onSaved: () => setCredential({ configured: true, writable: true }),
        }),
        state.updatedAt === undefined
          ? null
          : h(
              'span',
              { className: 'dshoc-foot' },
              t('usageUpdatedAt', { time: formatClock(state.updatedAt.toISOString()) ?? '' }),
            ),
      )
    }

    /**
     * The sidebar quota row: one line of text over a remaining-quota progress
     * bar, expanding into the per-window detail. The bar fills with what is
     * *left*, so a shrinking bar and the severity hue agree with the "remaining"
     * label; the collapsed rail keeps the bar alone.
     */
    function SidebarQuota(props) {
      const t = props.t
      const state = useStore()
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        const rpc = rpcOf(props.ctx)
        void store.read(rpc)
        const timer = setInterval(() => void store.read(rpc, { force: true }), POLL_MS)
        return () => clearInterval(timer)
      }, [props.ctx])

      const windows = state.usage === undefined ? [] : state.usage.windows
      const primary = primaryWindow(windows)
      const remaining = primary === undefined ? undefined : remainingPercent(primary.usedFraction)
      const severity = remaining === undefined ? 'none' : severityOf(remaining)
      const valueText = remaining === undefined
        ? t('usageSidebarUnavailable')
        : t('usageRemaining', { percent: String(remaining) })
      const label = t('usageSidebarLabel')
      const accessible = label + ': ' + valueText
      const hint = primary === undefined ? undefined : resetLabelOf(primary, t)
      // `wide` is false in the 56px rail, where the text would not fit.
      const rail = props.wide === false

      const bar = h(
        'span',
        {
          className: rail ? 'dshoc-bar dshoc-rail-bar' : 'dshoc-bar',
          role: 'img',
          'aria-label': accessible,
          'data-severity': severity,
          'data-loading': remaining === undefined ? 'true' : undefined,
        },
        h('span', { className: 'dshoc-bar-fill', style: { width: String(remaining ?? 0) + '%' } }),
      )

      if (rail) {
        return h(
          'div',
          { className: 'dshoc-rail' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshoc-rail-button',
              'aria-expanded': open,
              'aria-label': accessible,
              title: accessible,
              onClick: () => setOpen(!open),
            },
            bar,
            h('span', { className: 'dshoc-rail-value' }, remaining === undefined ? '—' : String(remaining) + '%'),
          ),
          open ? h(SidebarQuotaPanel, { t, state, windows, ctx: props.ctx }) : null,
        )
      }

      return h(
        'div',
        { className: 'dshoc-sidebar' },
        h(
          'button',
          {
            type: 'button',
            className: 'dshoc-sidebar-button',
            'aria-expanded': open,
            title: t('usageSidebarHint'),
            onClick: () => setOpen(!open),
          },
          h(
            'span',
            { className: 'dshoc-sidebar-head' },
            h('span', { className: 'dshoc-sidebar-label' }, label),
            h('span', { className: 'dshoc-sidebar-value' }, valueText),
          ),
          bar,
          hint === undefined ? null : h('span', { className: 'dshoc-sidebar-hint-line' }, hint),
        ),
        open ? h(SidebarQuotaPanel, { t, state, windows, ctx: props.ctx }) : null,
      )
    }

    /** The expanded half of the sidebar row: every window plus a refresh control. */
    function SidebarQuotaPanel(props) {
      const { t, state, windows, ctx } = props
      return h(
        'div',
        { className: 'dshoc-sidebar-panel' },
        h(
          'div',
          { className: 'dshoc-head' },
          h('span', { className: 'dshoc-window-label' }, t('usageTitle')),
          h(
            'button',
            {
              type: 'button',
              className: 'dshoc-button',
              disabled: state.refreshing === true,
              onClick: () => void store.read(rpcOf(ctx), { force: true }),
            },
            state.refreshing === true ? t('usageRefreshing') : t('usageRefresh'),
          ),
        ),
        windows.length > 0
          ? windows.map((window) =>
              h(Meter, {
                key: window.id,
                window,
                label: t(windowCopyKey(window.id)),
                valueText: t('usageRemaining', { percent: String(remainingPercent(window.usedFraction)) }),
                hint: resetLabelOf(window, t),
              }),
            )
          : h('p', { className: 'dshoc-hint' }, panelEmptyText(state, t)),
        state.status === 'unsupported' && windows.length > 0
          ? h('p', { className: 'dshoc-hint' }, t('usageUnsupported'))
          : null,
      )
    }

    const name = 'dsh-ollama-cloud-client'
    // `connection` is declared rather than merely looked up: the card's reads
    // must run against a mounted channel, and the slot owner re-renders when
    // the service finally arrives.
    const inject = ['slots', 'locale', 'connection']

    /**
     * Register both seats and this half's one stylesheet.
     * @param ctx - the client context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, COPY), 'dsh-ollama-cloud: locale')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = STYLE_ELEMENT_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-ollama-cloud: styles')
      const t = ctx.locale.bind(LOCALE_NAMESPACE)

      ctx.slots.inject(CARD_SLOT, () =>
        ctx.slots.register({ name: CARD_SLOT, key: SETTINGS_NAMESPACE }, (props) =>
          h(UsageCard, Object.assign({}, props, { t, ctx })),
        ),
      )
      ctx.slots.inject(SIDEBAR_SLOT, () =>
        ctx.slots.register({ name: SIDEBAR_SLOT, id: SETTINGS_NAMESPACE, order: 0 }, (props) =>
          h(SidebarQuota, Object.assign({}, props, { t, ctx })),
        ),
      )
    }

    return {
      name,
      inject,
      apply,
      internals: {
        COPY,
        CSS,
        SETTINGS_NAMESPACE,
        // Exposed for the tests that pin the store's state machine.
        store,
        STYLE_ELEMENT_ID,
        WINDOW_ORDER,
        decodeUsageReply,
        failureText,
        formatClock,
        primaryWindow,
        remainingPercent,
        resetLabelOf,
        severityOf,
        windowCopyKey,
      },
    }
  },
})
