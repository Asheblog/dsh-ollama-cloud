import { readFileSync } from 'node:fs'

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/** One seat registration captured from a fake slots service. */
interface CapturedSeat {
  options: Record<string, unknown>
  component: (props: Record<string, unknown>) => React.ReactElement
}

/** The bundle's shape as far as these tests reach into it. */
interface ClientBundle {
  name: string
  inject: string[]
  apply: (ctx: unknown) => void
  internals: {
    COPY: { en: Record<string, string>; zh: Record<string, string> }
    store: { read(rpc: unknown, options?: { force?: boolean }): Promise<unknown> }
    decodeUsageReply: (value: unknown) => unknown
    failureText: (state: Record<string, unknown>, t: Translate) => string
    formatClock: (iso: string) => string | undefined
    isNeedsRestart: (message: unknown) => boolean
    primaryWindow: (windows: Array<{ id: string }>) => { id: string } | undefined
    remainingPercent: (used: number) => number
    resetLabelOf: (window: Record<string, unknown>, t: Translate) => string | undefined
    severityOf: (remaining: number) => string
    windowCopyKey: (id: string) => string
  }
}

type Translate = (key: string, params?: Record<string, string>) => string

/**
 * Load the hand-written browser bundle the way the host loader does: hand it a
 * `window.__ModuleLoader__` to register into, then materialize the factory with
 * a `require` that answers what the loader's baseline answers.
 */
function loadBundle(): { id: string; module: ClientBundle } {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  let registration: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  const fakeWindow = {
    __ModuleLoader__: {
      load: (value: typeof registration) => {
        registration = value
      },
    },
  }
  new Function('window', source)(fakeWindow)
  if (registration === undefined) throw new Error('bundle never registered')
  const module = registration.factory((id: string) => {
    if (id === 'react') return React
    throw new Error(`unexpected require("${id}")`)
  }) as ClientBundle
  return { id: registration.id, module }
}

const { id: registrationId, module: bundle } = loadBundle()
const { internals } = bundle

/** A translator bound to the bundle's own English dictionary, with its own interpolation rules. */
function translatorFor(module: ClientBundle): Translate {
  const dictionary = (module.internals as unknown as { COPY: Record<string, Record<string, string>> }).COPY.en
  return (key, params) => {
    const template = dictionary[key] ?? key
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/gu, (_match, name: string) => params[name] ?? '')
  }
}

const t = translatorFor(bundle)

/** One RPC stub whose reply each test replaces. */
function rpcStub(reply: unknown) {
  return { call: vi.fn(async () => reply) }
}

/** Mount the bundle against a fake client context and capture its seats. */
function mount(rpc: unknown): { seats: CapturedSeat[]; registered: string[]; styles: string[] } {
  const seats: CapturedSeat[] = []
  const registered: string[] = []
  const styles: string[] = []
  vi.stubGlobal('document', {
    head: { appendChild: (element: { id: string }) => styles.push(element.id) },
    createElement: () => ({ id: '', textContent: '', remove: () => {} }),
  })
  const ctx = {
    effect: (callback: () => unknown) => callback(),
    locale: { register: vi.fn(() => () => {}), bind: () => t },
    get: () => ({ rpc }),
    slots: {
      inject: (name: string, callback: () => unknown) => {
        registered.push(name)
        callback()
      },
      register: (options: Record<string, unknown>, component: CapturedSeat['component']) => {
        seats.push({ options, component })
        return () => {}
      },
    },
  }
  bundle.apply(ctx)
  vi.unstubAllGlobals()
  return { seats, registered, styles }
}

describe('bundle contract', () => {
  it('registers under the package name and exports the loader shape', () => {
    expect(registrationId).toBe('dsh-ollama-cloud')
    expect(bundle.name).toBe('dsh-ollama-cloud-client')
    expect(bundle.inject).toEqual(['slots', 'locale'])
    expect(typeof bundle.apply).toBe('function')
  })

  it('occupies both seats, the locale copy, and one stylesheet', () => {
    const { seats, registered, styles } = mount(rpcStub({ ok: true, value: { status: 'unsupported' } }))
    expect(registered).toEqual(['settings.models.provider-card', 'sidebar.footer.action'])
    expect(seats[0]?.options).toMatchObject({ key: 'llm-ollama-cloud' })
    expect(seats[1]?.options).toMatchObject({ id: 'llm-ollama-cloud' })
    expect(styles).toEqual(['dsh-ollama-cloud-styles'])
  })
})

describe('usage decoding', () => {
  it('accepts the host envelope and keeps window order', () => {
    expect(internals.decodeUsageReply({
      status: 'ok',
      usage: {
        fetchedAt: '2026-09-29T15:00:00.000Z',
        weekly: { usage: 0.4 },
        monthly: {
          usage: 0.891,
          models: [{ name: 'web search', requestCount: 12 }],
          resetsAt: '2026-10-01T00:00:00.000Z',
        },
      },
    })).toEqual({
      status: 'ok',
      usage: {
        fetchedAt: '2026-09-29T15:00:00.000Z',
        windows: [
          {
            id: 'monthly',
            usedFraction: 0.891,
            models: [{ name: 'web search', requestCount: 12 }],
            resetsAt: '2026-10-01T00:00:00.000Z',
          },
          { id: 'weekly', usedFraction: 0.4, models: [] },
        ],
      },
    })
  })

  it('passes the unsupported marker through and refuses malformed values', () => {
    expect(internals.decodeUsageReply({ status: 'unsupported' })).toEqual({ status: 'unsupported' })
    expect(internals.decodeUsageReply({ status: 'ok', usage: {} })).toBeUndefined()
    expect(internals.decodeUsageReply({ status: 'ok', usage: { fetchedAt: 1 } })).toBeUndefined()
    expect(internals.decodeUsageReply({ status: 'ok', usage: { fetchedAt: 'x', monthly: { usage: -1 } } }))
      .toBeUndefined()
    expect(internals.decodeUsageReply({
      status: 'ok',
      usage: { fetchedAt: 'x', monthly: { usage: 0.1, models: 'nope' } },
    })).toEqual({ status: 'ok', usage: { fetchedAt: 'x', windows: [{ id: 'monthly', usedFraction: 0.1, models: [] }] } })
    expect(internals.decodeUsageReply(undefined)).toBeUndefined()
  })
})

describe('pure helpers', () => {
  it('turns a consumed fraction into a remaining percentage', () => {
    expect(internals.remainingPercent(0.891)).toBe(10.9)
    expect(internals.remainingPercent(0)).toBe(100)
    expect(internals.remainingPercent(1.2)).toBe(0)
  })

  it('grades severity from the remaining share', () => {
    expect(internals.severityOf(10.9)).toBe('warn')
    expect(internals.severityOf(20)).toBe('warn')
    expect(internals.severityOf(20.1)).toBe('ok')
    expect(internals.severityOf(0)).toBe('critical')
  })

  it('labels resets from the disclosed instant or the documented cadence', () => {
    expect(internals.resetLabelOf({ id: 'session', resetsAt: '2026-09-29T15:00:00.000Z' }, t))
      .toMatch(/^Resets at \d\d:\d\d$/u)
    expect(internals.resetLabelOf({ id: 'session' }, t)).toBe('Resets every 5 hours')
    expect(internals.resetLabelOf({ id: 'weekly' }, t)).toBe('Resets every 7 days')
    expect(internals.resetLabelOf({ id: 'monthly' }, t)).toBe('Resets every 30 days')
    expect(internals.resetLabelOf({ id: 'other' }, t)).toBeUndefined()
  })

  it('formats a clock time and refuses garbage', () => {
    expect(internals.formatClock('2026-09-29T15:04:05.000Z')).toMatch(/^\d\d:\d\d$/u)
    expect(internals.formatClock('nope')).toBeUndefined()
  })

  it('recognizes the host-restart diagnostic', () => {
    expect(internals.isNeedsRestart('unknown Ollama Cloud endpoint: usage/read')).toBe(true)
    expect(internals.isNeedsRestart('other')).toBe(false)
    expect(internals.isNeedsRestart(undefined)).toBe(false)
  })

  it('picks the primary window in display order', () => {
    expect(internals.primaryWindow([{ id: 'weekly' }, { id: 'session' }])).toEqual({ id: 'session' })
    expect(internals.primaryWindow([{ id: 'monthly' }, { id: 'session' }])).toEqual({ id: 'monthly' })
    expect(internals.primaryWindow([])).toBeUndefined()
  })

  it('maps failures onto copy, preferring the code', () => {
    const en = bundle.internals.COPY.en
    expect(internals.failureText({ code: 'unavailable' }, t)).toBe(en.usageNeedsRestart)
    expect(internals.failureText({ code: 'unknown-endpoint' }, t)).toBe(en.usageNeedsRestart)
    expect(internals.failureText({ code: 'INVALID_CREDENTIAL' }, t)).toBe(en.usageCredential)
    expect(internals.failureText({ code: 'transport', error: 'boom' }, t)).toBe('boom')
    expect(internals.failureText({}, t)).toBe(en.usageUnreachable)
  })

  it('maps window ids onto copy keys', () => {
    expect(internals.windowCopyKey('monthly')).toBe('usageMonthly')
    expect(internals.windowCopyKey('session')).toBe('usageSession')
    expect(internals.windowCopyKey('weekly')).toBe('usageWeekly')
  })
})

describe('rendered seats', () => {
  const READY = {
    status: 'ok',
    usage: {
      fetchedAt: '2026-09-29T15:00:00.000Z',
      monthly: {
        usage: 0.891,
        models: [{ name: 'web search', requestCount: 12 }, { name: 'gpt-oss:120b', requestCount: 3 }],
        resetsAt: '2026-10-01T00:00:00.000Z',
      },
      session: { usage: 0.25 },
    },
  }

  /** One isolated bundle instance seeded with `reply`, plus its seats. */
  async function mountAfter(reply: unknown) {
    const { module: instance } = loadBundle()
    const t = translatorFor(instance)
    const rpc = rpcStub(reply)
    await instance.internals.store.read(rpc, { force: true })
    const seats: CapturedSeat[] = []
    vi.stubGlobal('document', {
      head: { appendChild: () => {} },
      createElement: () => ({ id: '', textContent: '', remove: () => {} }),
    })
    instance.apply({
      effect: (callback: () => unknown) => callback(),
      locale: { register: () => () => {}, bind: () => t },
      get: () => ({ rpc }),
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: Record<string, unknown>, component: CapturedSeat['component']) => {
          seats.push({ options, component })
          return () => {}
        },
      },
    })
    vi.unstubAllGlobals()
    return seats
  }

  it('renders meters, model counts, and the key field once the snapshot is ready', async () => {
    const seats = await mountAfter({ ok: true, value: READY })
    const card = seats[0]?.component
    if (card === undefined) throw new Error('card seat was not registered')
    const markup = renderToStaticMarkup(card({ provider: {}, configured: true, keyConfigured: true }))
    expect(markup).toContain('Cloud usage')
    expect(markup).toContain('Monthly usage')
    expect(markup).toContain('10.9% left')
    expect(markup).toContain('data-severity="warn"')
    expect(markup).toContain('Usage sources')
    expect(markup).toContain('web search')
    expect(markup).toContain('12 requests')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('Configured')
    expect(markup).toContain('aria-label="Monthly usage: 10.9% left"')
  })

  it('renders the unsupported, restart, and credential states when there is nothing to show', async () => {
    async function cardMarkup(reply: unknown): Promise<string> {
      const seats = await mountAfter(reply)
      const card = seats[0]?.component
      if (card === undefined) throw new Error('card seat was not registered')
      return renderToStaticMarkup(card({ provider: {}, keyConfigured: false }))
    }
    expect(await cardMarkup({ ok: true, value: { status: 'unsupported' } }))
      .toContain('This endpoint does not report cloud usage.')
    expect(await cardMarkup({
      ok: false,
      error: { code: 'unknown-endpoint', message: 'unknown Ollama Cloud endpoint: usage/read', details: {} },
    })).toContain('Usage appears after the running host reloads this plugin')
    expect(await cardMarkup({ ok: false, error: { code: 'INVALID_CREDENTIAL', message: 'refused', details: {} } }))
      .toContain('Ollama Cloud refused the current API key')
    expect(await cardMarkup({ ok: false, error: { code: 'transport', message: 'boom', details: {} } })).toContain('boom')
  })

  it('keeps the last snapshot when a later read stops being supported', async () => {
    const { module: instance } = loadBundle()
    const t = translatorFor(instance)
    const seats: CapturedSeat[] = []
    vi.stubGlobal('document', {
      head: { appendChild: () => {} },
      createElement: () => ({ id: '', textContent: '', remove: () => {} }),
    })
    instance.apply({
      effect: (callback: () => unknown) => callback(),
      locale: { register: () => () => {}, bind: () => t },
      get: () => ({ rpc: rpcStub(READY) }),
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: Record<string, unknown>, component: CapturedSeat['component']) => {
          seats.push({ options, component })
          return () => {}
        },
      },
    })
    vi.unstubAllGlobals()
    await instance.internals.store.read(rpcStub({ ok: true, value: READY }), { force: true })
    await instance.internals.store.read(rpcStub({ ok: true, value: { status: 'unsupported' } }), { force: true })

    const card = seats[0]?.component
    if (card === undefined) throw new Error('card seat was not registered')
    const markup = renderToStaticMarkup(card({ provider: {}, configured: true, keyConfigured: true }))
    expect(markup).toContain('10.9% left')
    expect(markup).not.toContain('This endpoint does not report cloud usage.')
  })

  it('renders the sidebar row with the remaining share and no panel until opened', async () => {
    const seats = await mountAfter({ ok: true, value: READY })
    const row = seats[1]?.component
    if (row === undefined) throw new Error('sidebar seat was not registered')
    const markup = renderToStaticMarkup(row({ wide: true }))
    expect(markup).toContain('Ollama Cloud quota')
    expect(markup).toContain('10.9% left')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('dshoc-sidebar-panel')
  })
})
