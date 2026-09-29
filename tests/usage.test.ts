import { describe, expect, it, vi } from 'vitest'

import {
  decodeUsageResponse,
  readUsage,
  USAGE_MAX_BYTES,
  USAGE_UNSUPPORTED,
  UsageError,
} from '../src/usage.js'

// Body shaped like the live `GET https://ollama.com/api/usage` response the
// reference implementation parses (window keys are optional; monthly is what
// current plans report, session/weekly appear on older ones).
const LIVE_BODY = {
  limits: {
    monthly: {
      usage: 0.891,
      models: [
        { name: 'web search', request_count: 12 },
        { name: 'gpt-oss:120b', request_count: 3 },
      ],
      resets_at: '2026-10-01T00:00:00Z',
    },
    session: { usage: 0.25, reset_after_seconds: 3600 },
    weekly: { usage: 0.4, resetsAt: 1789313741936 },
  },
}

const NOW = 1789310000000

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('decodeUsageResponse', () => {
  it('reads every window in display order with models and reset instants', () => {
    const snapshot = decodeUsageResponse(LIVE_BODY, 'https://ollama.com/api/usage', NOW)
    expect(snapshot.fetchedAt).toBe(new Date(NOW).toISOString())
    expect(snapshot.windows.map((window) => window.id)).toEqual(['monthly', 'session', 'weekly'])
    const [monthly, session, weekly] = snapshot.windows
    expect(monthly).toEqual({
      id: 'monthly',
      usedFraction: 0.891,
      models: [
        { name: 'web search', requestCount: 12 },
        { name: 'gpt-oss:120b', requestCount: 3 },
      ],
      // Reset instants are normalized to ISO so every spelling the endpoint
      // has used (string, epoch seconds, relative seconds) compares alike.
      resetsAt: '2026-10-01T00:00:00.000Z',
    })
    expect(session?.resetsAt).toBe(new Date(NOW + 3600_000).toISOString())
    expect(session?.models).toEqual([])
    expect(weekly?.resetsAt).toBe(new Date(1789313741936).toISOString())
  })

  it('accepts epoch seconds and keeps only the windows the endpoint reported', () => {
    const snapshot = decodeUsageResponse({ limits: { session: { usage: 0.5, resetsAt: 1789313741 } } }, 'u', NOW)
    expect(snapshot.windows).toEqual([
      { id: 'session', usedFraction: 0.5, models: [], resetsAt: new Date(1789313741_000).toISOString() },
    ])
  })

  it('drops a window whose usage is not a finite non-negative number', () => {
    const snapshot = decodeUsageResponse(
      { limits: { monthly: { usage: 'nope' }, session: { usage: -1 }, weekly: { usage: 0.2 } } },
      'u',
      NOW,
    )
    expect(snapshot.windows.map((window) => window.id)).toEqual(['weekly'])
  })

  it('skips one odd model entry instead of sinking the panel', () => {
    const snapshot = decodeUsageResponse({
      limits: {
        monthly: {
          usage: 0.1,
          models: [
            { name: 'ok', request_count: 2 },
            { name: 'missing count' },
            { name: 'negative', request_count: -3 },
            { name: 'fractional', request_count: 1.5 },
            { request_count: 9 },
            'nonsense',
          ],
        },
      },
    }, 'u', NOW)
    expect(snapshot.windows[0]?.models).toEqual([{ name: 'ok', requestCount: 2 }])
  })

  it('refuses a body without a usable limits object', () => {
    expect(() => decodeUsageResponse({ limits: 'nope' }, 'https://x/usage', NOW)).toThrow(UsageError)
    expect(() => decodeUsageResponse({ limits: {} }, 'https://x/usage', NOW)).toThrow(/malformed/)
    expect(() => decodeUsageResponse({}, 'https://x/usage', NOW)).toThrow(/malformed/)
    expect(() => decodeUsageResponse(null, 'https://x/usage', NOW)).toThrow(/malformed/)
  })
})

describe('readUsage', () => {
  const target = { baseURL: 'https://ollama.com/api', apiKey: 'secret' }

  it('sends a credentialed, non-redirecting GET and decodes the reply', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return jsonResponse(LIVE_BODY)
    }
    const snapshot = await readUsage(target, { fetch: route, attribution: () => ({ 'user-agent': 'dsh-test' }) })

    expect(calls[0]?.url).toBe('https://ollama.com/api/usage')
    expect(calls[0]?.init?.method).toBe('GET')
    expect(calls[0]?.init?.redirect).toBe('error')
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer secret',
      'user-agent': 'dsh-test',
    })
    expect(snapshot.windows).toHaveLength(3)
  })

  it('omits the authorization header without a credential', async () => {
    const calls: RequestInit[] = []
    const route: typeof fetch = async (_url, init) => {
      calls.push(init ?? {})
      return jsonResponse({ limits: { monthly: { usage: 0.1 } } })
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

  it('reports other refusals and transport failures as usage failures', async () => {
    const refused: typeof fetch = async () => jsonResponse({ error: 'busy' }, 429)
    await expect(readUsage(target, { fetch: refused })).rejects.toMatchObject({ code: 'OLLAMA_USAGE_FAILED' })
    const broken: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(readUsage(target, { fetch: broken })).rejects.toThrow(/could not reach/)
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
