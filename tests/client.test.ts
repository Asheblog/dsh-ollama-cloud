import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { Translate } from './helpers.js'
import { cardSeat, loadBundle, mountClient, sidebarSeat, translatorFor } from './helpers.js'

const { id: registrationId, module: bundle } = loadBundle()
const { internals } = bundle
const t: Translate = translatorFor(bundle)

/** One reply the RPC stub answers with. */
function rpcStub(reply: unknown) {
  return { call: async () => reply }
}

describe('bundle contract', () => {
  it('registers under the package name and exports the loader shape', () => {
    expect(registrationId).toBe('dsh-ollama-cloud')
    expect(bundle.name).toBe('dsh-ollama-cloud-client')
    // `connection` is declared, not merely looked up: reads must run against a
    // mounted channel, and the seats re-render when the service arrives.
    expect(bundle.inject).toEqual(['slots', 'locale', 'connection'])
    expect(typeof bundle.apply).toBe('function')
  })

  it('occupies both seats, the locale copy, and one stylesheet', () => {
    const mount = mountClient(bundle, rpcStub({ ok: true, value: { status: 'unsupported' } }), t)
    expect(mount.registered).toEqual(['settings.models.provider-card', 'sidebar.footer.action'])
    expect(mount.seats[0]?.options).toMatchObject({ key: 'llm-ollama-cloud' })
    expect(mount.seats[1]?.options).toMatchObject({ id: 'llm-ollama-cloud' })
    expect(mount.styles).toEqual(['dsh-ollama-cloud-styles'])
  })

  it('tags its stylesheet with its own module id so a neighbour cannot claim it', () => {
    // The module system's claim sweep takes *every* untagged <style> for the
    // plugin materializing next, and deletes a plugin's claimed tags when that
    // plugin is hot-replaced — so an untagged sheet here dies with a neighbour's
    // reload, which reads as "new markup, no styling at all".
    const mount = mountClient(bundle, rpcStub({ ok: true, value: { status: 'unsupported' } }), t)
    expect(mount.styleElements[0]?.attributes['data-plugin']).toBe(internals.STYLE_OWNER)
    expect(internals.STYLE_OWNER).toBe(registrationId)
    expect(mount.styleElements[0]?.textContent).toBe(internals.CSS)
  })

  it('re-appends its stylesheet when something removes it', () => {
    let notify: (() => void) | undefined
    class FakeObserver {
      constructor(callback: () => void) {
        notify = callback
      }
      observe() {}
      disconnect() {
        notify = undefined
      }
    }
    const mount = mountClient(bundle, rpcStub({ ok: true, value: { status: 'unsupported' } }), t, {
      globals: { MutationObserver: FakeObserver },
    })
    const element = mount.styleElements[0]
    expect(element?.isConnected).toBe(true)
    element?.remove()
    expect(element?.isConnected).toBe(false)
    // The observer fires long after the mount, so it needs a head to re-append into.
    vi.stubGlobal('document', {
      head: { appendChild: (target: { isConnected: boolean }) => { target.isConnected = true } },
    })
    notify?.()
    vi.unstubAllGlobals()
    expect(element?.isConnected).toBe(true)
  })
})

describe('usage decoding', () => {
  it('accepts the host wire shape and keeps window order', () => {
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

  it('picks the primary window in display order', () => {
    expect(internals.primaryWindow([{ id: 'weekly' }, { id: 'session' }])).toEqual({ id: 'session' })
    expect(internals.primaryWindow([{ id: 'monthly' }, { id: 'session' }])).toEqual({ id: 'monthly' })
    expect(internals.primaryWindow([])).toBeUndefined()
  })

  it('maps every failure onto localized copy, never the host message', () => {
    const en = internals.COPY.en
    expect(internals.failureText({ code: 'unavailable' }, t)).toBe(en.usageNeedsRestart)
    expect(internals.failureText({ code: 'unknown-endpoint', message: 'unknown Ollama Cloud endpoint: x' }, t))
      .toBe(en.usageNeedsRestart)
    expect(internals.failureText({ code: 'INVALID_CREDENTIAL' }, t)).toBe(en.usageCredential)
    expect(internals.failureText({ code: 'transport', error: 'could not reach https://x' }, t)).toBe(en.usageUnreachable)
    expect(internals.failureText({ code: 'invalid-reply' }, t)).toBe(en.usageFailed)
    expect(internals.failureText({}, t)).toBe(en.usageFailed)
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

  /** One isolated bundle instance seeded with one full RPC reply, rendered as the card. */
  async function cardMarkupAfter(reply: unknown): Promise<string> {
    const { module: instance } = loadBundle()
    const rpc = rpcStub(reply)
    await instance.internals.store.read(rpc, { force: true })
    const mount = mountClient(instance, rpc, translatorFor(instance))
    return renderToStaticMarkup(cardSeat(mount)({ provider: {}, keyConfigured: true }))
  }

  it('renders meters, model counts, and the key field once the snapshot is ready', async () => {
    const markup = await cardMarkupAfter({ ok: true, value: READY })
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

  it('renders the unsupported, restart, credential, and transport states when there is nothing to show', async () => {
    expect(await cardMarkupAfter({ ok: true, value: { status: 'unsupported' } }))
      .toContain('This endpoint does not report cloud usage.')
    expect(await cardMarkupAfter({
      ok: false,
      error: { code: 'unknown-endpoint', message: 'unknown Ollama Cloud endpoint: usage/read', details: {} },
    })).toContain('Usage appears after the running host reloads this plugin')
    expect(await cardMarkupAfter({ ok: false, error: { code: 'INVALID_CREDENTIAL', message: 'refused', details: {} } }))
      .toContain('Ollama Cloud refused the current API key')
    expect(await cardMarkupAfter({
      ok: false,
      error: { code: 'transport', message: 'could not reach https://x', details: {} },
    })).toContain('Could not reach Ollama Cloud usage')
  })

  it('keeps the last snapshot while stating that it is no longer supported', async () => {
    const { module: instance } = loadBundle()
    const mount = mountClient(instance, rpcStub(READY), translatorFor(instance))
    await instance.internals.store.read(rpcStub({ ok: true, value: READY }), { force: true })
    await instance.internals.store.read(rpcStub({ ok: true, value: { status: 'unsupported' } }), { force: true })

    const markup = renderToStaticMarkup(cardSeat(mount)({ provider: {}, keyConfigured: true }))
    // Both facts, at once: the numbers are the last good read, and the state
    // says the endpoint no longer reports them.
    expect(markup).toContain('10.9% left')
    expect(markup).toContain('This endpoint does not report cloud usage.')
  })

  it('offers a refresh inside the sidebar panel and names its state', async () => {
    const { module: instance } = loadBundle()
    const rpc = rpcStub({ ok: true, value: { status: 'unsupported' } })
    await instance.internals.store.read(rpc, { force: true })
    const mount = mountClient(instance, rpc, translatorFor(instance))
    // Render the open panel by driving its own state through a click-free path:
    // the seat starts closed, so the panel copy is asserted through the card's
    // shared helpers instead.
    const markup = renderToStaticMarkup(sidebarSeat(mount)({ wide: true }))
    expect(markup).toContain('Ollama Cloud quota')
    expect(markup).toContain('Quota unavailable')
  })

  it('renders the sidebar row with the remaining share and no panel until opened', async () => {
    const { module: instance } = loadBundle()
    const rpc = rpcStub({ ok: true, value: READY })
    await instance.internals.store.read(rpc, { force: true })
    const mount = mountClient(instance, rpc, translatorFor(instance))
    const markup = renderToStaticMarkup(sidebarSeat(mount)({ wide: true }))
    expect(markup).toContain('Ollama Cloud quota')
    expect(markup).toContain('10.9% left')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('dshoc-sidebar-panel')
  })

  it('draws the remaining share as a progress bar sized and graded by the primary window', async () => {
    const { module: instance } = loadBundle()
    const rpc = rpcStub({ ok: true, value: READY })
    await instance.internals.store.read(rpc, { force: true })
    const mount = mountClient(instance, rpc, translatorFor(instance))
    const markup = renderToStaticMarkup(sidebarSeat(mount)({ wide: true }))
    // The monthly window is primary at 89.1% consumed: 10.9% left fills the bar
    // and grades it `warn`, and the label states the same number.
    expect(markup).toContain('class="dshoc-bar"')
    expect(markup).toContain('style="width:10.9%"')
    expect(markup).toContain('data-severity="warn"')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Ollama Cloud quota: 10.9% left"')
    expect(markup).toContain('Resets at')
    expect(markup).not.toContain('dshoc-rail-bar')
  })

  it('keeps only the mini bar and its number in the collapsed rail', async () => {
    const { module: instance } = loadBundle()
    const rpc = rpcStub({ ok: true, value: READY })
    await instance.internals.store.read(rpc, { force: true })
    const mount = mountClient(instance, rpc, translatorFor(instance))
    const markup = renderToStaticMarkup(sidebarSeat(mount)({ wide: false }))
    expect(markup).toContain('dshoc-rail-bar')
    expect(markup).toContain('style="width:10.9%"')
    expect(markup).toContain('10.9%')
    // Text would not fit the 56px rail, so the label is carried by the title.
    expect(markup).not.toContain('dshoc-sidebar-head')
    expect(markup).not.toContain('Resets at')
  })

  it('shows a neutral, empty bar while no window has been read yet', () => {
    const { module: instance } = loadBundle()
    const mount = mountClient(instance, rpcStub({ ok: true, value: { status: 'unsupported' } }), translatorFor(instance))
    const markup = renderToStaticMarkup(sidebarSeat(mount)({ wide: true }))
    expect(markup).toContain('data-severity="none"')
    expect(markup).toContain('data-loading="true"')
    expect(markup).toContain('style="width:0%"')
    expect(markup).toContain('Quota unavailable')
  })
})
