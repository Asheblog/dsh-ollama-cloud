import { describe, expect, it } from 'vitest'

import {
  decodeBalanceResponse,
  readUsage,
  USAGE_MAX_BYTES,
  USAGE_UNSUPPORTED,
  UsageError,
} from '../src/usage.js'

// Body shaped like the live `GET https://ollama.com/api/balance` response
// (shape captured from the endpoint on 2026-10-12; the values are not the
// account's own). `included` carries one entry per billing window the plan
// has, each reporting what is *left* of that window's allowance — this account
// is on a legacy plan, so it reports the session and weekly limits and no
// monthly one.
const LIVE_BODY = {
  included: {
    session: { remaining_percent: 95.55, resets_at: '2026-10-12T03:00:00Z' },
    weekly: { remaining_percent: 99.21, resets_at: '2026-10-19T00:00:00Z' },
  },
  purchased: { balance_usd: 1.59 },
}

const NOW = 1789310000000

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('decodeBalanceResponse', () => {
  it('reads every reported window in display order, as a consumed fraction', () => {
    const snapshot = decodeBalanceResponse(LIVE_BODY, 'https://ollama.com/api/balance', NOW)
    expect(snapshot.fetchedAt).toBe(new Date(NOW).toISOString())
    expect(snapshot.windows).toEqual([
      // The endpoint reports what is left; the panel meters what was spent.
      { id: 'session', usedFraction: 0.0445, resetsAt: '2026-10-12T03:00:00.000Z' },
      { id: 'weekly', usedFraction: 0.0079, resetsAt: '2026-10-19T00:00:00.000Z' },
    ])
  })

  it('converts both extremes exactly', () => {
    const snapshot = decodeBalanceResponse(
      { included: { session: { remaining_percent: 100 }, weekly: { remaining_percent: 0 } } },
      'u',
      NOW,
    )
    expect(snapshot.windows).toEqual([
      { id: 'session', usedFraction: 0 },
      { id: 'weekly', usedFraction: 1 },
    ])
  })

  it('clamps a reading just outside the range instead of blanking the panel', () => {
    const snapshot = decodeBalanceResponse(
      { included: { session: { remaining_percent: 100.4 }, weekly: { remaining_percent: -3 } } },
      'u',
      NOW,
    )
    expect(snapshot.windows).toEqual([
      { id: 'session', usedFraction: 0 },
      { id: 'weekly', usedFraction: 1 },
    ])
  })

  it('keeps a window the endpoint reported without a reset instant', () => {
    const snapshot = decodeBalanceResponse({ included: { session: { remaining_percent: 50 } } }, 'u', NOW)
    expect(snapshot.windows).toEqual([{ id: 'session', usedFraction: 0.5 }])
  })

  it('drops a window whose remaining percentage is not a finite number', () => {
    const snapshot = decodeBalanceResponse(
      {
        included: {
          monthly: { remaining_percent: 'nope' },
          session: { remaining_percent: null },
          weekly: { remaining_percent: 20 },
        },
      },
      'u',
      NOW,
    )
    expect(snapshot.windows).toEqual([{ id: 'weekly', usedFraction: 0.8 }])
  })

  it('carries an unparseable reset instant as no instant at all', () => {
    const snapshot = decodeBalanceResponse(
      { included: { session: { remaining_percent: 10, resets_at: 'whenever' } } },
      'u',
      NOW,
    )
    expect(snapshot.windows).toEqual([{ id: 'session', usedFraction: 0.9 }])
  })

  it('ignores a window id this plugin has no seat for', () => {
    const snapshot = decodeBalanceResponse(
      { included: { daily: { remaining_percent: 10 }, session: { remaining_percent: 10 } } },
      'u',
      NOW,
    )
    expect(snapshot.windows).toEqual([{ id: 'session', usedFraction: 0.9 }])
  })

  it('refuses a body without a usable "included" object', () => {
    expect(() => decodeBalanceResponse({ included: 'nope' }, 'https://x/balance', NOW)).toThrow(UsageError)
    expect(() => decodeBalanceResponse({ included: {} }, 'https://x/balance', NOW)).toThrow(/malformed/)
    expect(() => decodeBalanceResponse({}, 'https://x/balance', NOW)).toThrow(/malformed/)
    expect(() => decodeBalanceResponse(null, 'https://x/balance', NOW)).toThrow(/malformed/)
  })

  it('names the keys it saw, so a changed contract is diagnosable', () => {
    // The retired shape from before the endpoint moved: a panel that fails must
    // say what arrived, because this is exactly how the previous contract broke.
    expect(() => decodeBalanceResponse({ limits: { session: { usage: 0.2 } } }, 'https://x/balance', NOW))
      .toThrow(/body keys: limits/)
  })
})

describe('readUsage', () => {
  const target = { baseURL: 'https://ollama.com/api', apiKey: 'secret' }

  it('sends a credentialed, non-redirecting GET to the balance endpoint', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return jsonResponse(LIVE_BODY)
    }
    const snapshot = await readUsage(target, { fetch: route, attribution: () => ({ 'user-agent': 'dsh-test' }) })

    expect(calls[0]?.url).toBe('https://ollama.com/api/balance')
    expect(calls[0]?.init?.method).toBe('GET')
    expect(calls[0]?.init?.redirect).toBe('error')
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer secret',
      'user-agent': 'dsh-test',
    })
    expect(snapshot.windows).toHaveLength(2)
  })

  it('tolerates a trailing slash on the configured base', async () => {
    const calls: string[] = []
    const route: typeof fetch = async (url) => {
      calls.push(String(url))
      return jsonResponse({ included: { session: { remaining_percent: 50 } } })
    }
    await readUsage({ baseURL: 'http://localhost:11434/api//' }, { fetch: route })
    expect(calls[0]).toBe('http://localhost:11434/api/balance')
  })

  it('omits the authorization header without a credential', async () => {
    const calls: RequestInit[] = []
    const route: typeof fetch = async (_url, init) => {
      calls.push(init ?? {})
      return jsonResponse({ included: { session: { remaining_percent: 50 } } })
    }
    await readUsage({ baseURL: 'http://localhost:11434/api' }, { fetch: route })
    expect(calls[0]?.headers).not.toHaveProperty('authorization')
  })

  it('reports a 404 as unsupported rather than a failure', async () => {
    const route: typeof fetch = async () => jsonResponse({ error: 'not found' }, 404)
    await expect(readUsage(target, { fetch: route })).rejects.toMatchObject({ code: USAGE_UNSUPPORTED })
  })

  it('reports 401 and 403 as credential problems', async () => {
    for (const status of [401, 403]) {
      const route: typeof fetch = async () => jsonResponse({ error: 'no' }, status)
      await expect(readUsage(target, { fetch: route })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    }
  })

  it('reports a rate-limited or otherwise refused read as a usage failure', async () => {
    const refused: typeof fetch = async () => jsonResponse({ error: 'busy' }, 429)
    await expect(readUsage(target, { fetch: refused })).rejects.toMatchObject({ code: 'OLLAMA_USAGE_FAILED' })
  })

  it('reports a transport failure as a reach failure', async () => {
    const broken: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(readUsage(target, { fetch: broken })).rejects.toThrow(/could not reach/)
  })

  it('reports a reply the decoder cannot use as a usage failure', async () => {
    // The shape the endpoint answered with before it moved: a panel that
    // receives it must say "failed", not render a phantom snapshot.
    const stale: typeof fetch = async () => jsonResponse({ limits: { session: { usage: 0.2 } } })
    await expect(readUsage(target, { fetch: stale })).rejects.toMatchObject({ code: 'OLLAMA_USAGE_FAILED' })
  })

  it('refuses a reply larger than the usage budget', async () => {
    const big: typeof fetch = async () =>
      new Response('x', { status: 200, headers: { 'content-length': String(USAGE_MAX_BYTES + 1) } })
    await expect(readUsage(target, { fetch: big })).rejects.toMatchObject({ code: 'OLLAMA_USAGE_FAILED' })
  })

  it('refuses a non-JSON reply', async () => {
    const route: typeof fetch = async () => new Response('<html>', { status: 200 })
    await expect(readUsage(target, { fetch: route })).rejects.toThrow(/JSON/)
  })

  it('reports caller cancellation as an abort', async () => {
    const controller = new AbortController()
    const route: typeof fetch = async (_url, init) => {
      controller.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError', cause: init?.signal })
    }
    await expect(
      readUsage(target, { fetch: route }, controller.signal),
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('aborts an attempt that outlives the configured budget', async () => {
    const route: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })
    await expect(readUsage({ ...target, requestTimeoutMs: 5 }, { fetch: route })).rejects.toThrow(/timed out/)
  })
})
