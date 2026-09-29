import { describe, expect, it } from 'vitest'

import { resolveConnection } from '../src/config.js'
import { createUsageRpcHandler, USAGE_ENDPOINT } from '../src/rpc.js'
import { loadBundle } from './helpers.js'

/**
 * The host half and the browser half are published together but tested
 * separately, so each side could satisfy its own tests while disagreeing with
 * the other. This file feeds the host's actual reply into the client's actual
 * decoder: the shape the channel serves and the shape the card accepts are one
 * contract, and it is pinned here.
 */
const LIVE_BODY = {
  limits: {
    monthly: {
      usage: 0.891,
      models: [{ name: 'web search', request_count: 12 }],
      resets_at: '2026-10-01T00:00:00Z',
    },
    session: { usage: 0.148, models: [{ name: 'deepseek-v4.1-flash', request_count: 419 }] },
  },
}

describe('host reply → client decoder', () => {
  it('serves a snapshot the browser half accepts, with its model counts intact', async () => {
    const handler = createUsageRpcHandler({
      connection: () => resolveConnection({}),
      resolveCredential: async () => 'k',
      credentials: () => undefined,
      fetch: async () =>
        new Response(JSON.stringify(LIVE_BODY), { status: 200, headers: { 'content-type': 'application/json' } }),
      attribution: () => ({}),
    })

    const reply = await handler(USAGE_ENDPOINT, {})
    expect(reply).toMatchObject({ ok: true })

    const { module } = loadBundle()
    const decode = module.internals.decodeUsageReply as (value: unknown) => {
      status: string
      usage?: { fetchedAt: string; windows: Array<{ id: string; usedFraction: number; models: unknown[] }> }
    }
    const decoded = decode((reply as { value: unknown }).value)
    expect(decoded.status).toBe('ok')
    expect(decoded.usage?.windows.map((window) => window.id)).toEqual(['monthly', 'session'])
    expect(decoded.usage?.windows[0]).toMatchObject({
      usedFraction: 0.891,
      models: [{ name: 'web search', requestCount: 12 }],
    })
    expect(decoded.usage?.windows[1]).toMatchObject({
      usedFraction: 0.148,
      models: [{ name: 'deepseek-v4.1-flash', requestCount: 419 }],
    })
  })

  it('carries the unsupported answer through unchanged', async () => {
    const handler = createUsageRpcHandler({
      connection: () => resolveConnection({}),
      resolveCredential: async () => undefined,
      credentials: () => undefined,
      fetch: async () => new Response('{}', { status: 404 }),
      attribution: () => ({}),
    })
    const reply = await handler(USAGE_ENDPOINT, {})
    const { module } = loadBundle()
    expect(module.internals.decodeUsageReply((reply as { value: unknown }).value)).toEqual({ status: 'unsupported' })
  })
})
