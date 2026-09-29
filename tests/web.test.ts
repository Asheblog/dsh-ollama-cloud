import { describe, expect, it, vi } from 'vitest'

import {
  decodeFetchResponse,
  decodeSearchResponse,
  OllamaWebFetchProvider,
  OllamaWebSearchProvider,
  OLLAMA_WEB_PROVIDER_ID,
} from '../src/web.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Provider options wired to a scripted fetch, with an API key available. */
function optionsFor(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof makeProviders>[0]> = {}) {
  return {
    baseURL: () => 'https://ollama.com/api',
    resolveApiKey: () => Promise.resolve('secret'),
    fetch: fetchImpl,
    attribution: () => ({ 'user-agent': 'dsh-test' }),
    requestTimeoutMs: () => 1000,
    ...overrides,
  }
}

function makeProviders(config: {
  baseURL: () => string
  resolveApiKey: () => Promise<string | undefined>
  fetch: typeof fetch
  attribution?: () => Record<string, string>
  requestTimeoutMs?: () => number
}) {
  return {
    search: new OllamaWebSearchProvider(config),
    fetch: new OllamaWebFetchProvider(config),
  }
}

describe('decodeSearchResponse', () => {
  it('keeps sources with a usable url and drops the rest', () => {
    const result = decodeSearchResponse({
      results: [
        { url: 'https://a.example/x', title: 'A', content: 'snippet a' },
        { title: 'no url' },
        { url: '', content: 'empty url' },
        { url: 'https://b.example/y', content: 'snippet b' },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.example/x', title: 'A', snippet: 'snippet a' },
        { url: 'https://b.example/y', snippet: 'snippet b' },
      ],
      truncated: false,
    })
  })

  it('refuses a reply without a results array', () => {
    expect(() => decodeSearchResponse({ nope: true })).toThrow(/results/)
  })
})

describe('decodeFetchResponse', () => {
  it('returns extracted page text', () => {
    expect(decodeFetchResponse({ content: '# Title\n\nbody' })).toBe('# Title\n\nbody')
  })

  it('refuses a reply without text content', () => {
    expect(() => decodeFetchResponse({ content: 42 })).toThrow(/content/)
  })
})

describe('OllamaWebSearchProvider', () => {
  it('posts a bounded query with the credential and attribution', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ results: [{ url: 'https://a.example', title: 'A' }] })
    }
    const { search } = makeProviders(optionsFor(route))

    const result = await search.search({ query: 'ollama cloud', maxResults: 50 })

    expect(result.sources).toEqual([{ url: 'https://a.example', title: 'A' }])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://ollama.com/api/web_search')
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer secret',
      'user-agent': 'dsh-test',
    })
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ query: 'ollama cloud', max_results: 10 })
    expect(calls[0]?.init?.redirect).toBe('error')
  })

  it('omits the result cap when the caller sets none', async () => {
    const calls: RequestInit[] = []
    const route: typeof fetch = async (_url, init) => {
      calls.push(init ?? {})
      return jsonResponse({ results: [] })
    }
    const { search } = makeProviders(optionsFor(route))
    await search.search({ query: 'q' })
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ query: 'q' })
  })

  it('fails loud without a credential', async () => {
    const route = vi.fn()
    const { search } = makeProviders(optionsFor(route as unknown as typeof fetch, {
      resolveApiKey: () => Promise.resolve(undefined),
    }))
    await expect(search.search({ query: 'q' })).rejects.toMatchObject({ code: 'OLLAMA_WEB_MISSING_CREDENTIAL' })
    expect(route).not.toHaveBeenCalled()
  })

  it('reports an HTTP refusal with its status', async () => {
    const route: typeof fetch = async () => jsonResponse({ error: 'Unauthorized' }, 401)
    const { search } = makeProviders(optionsFor(route))
    await expect(search.search({ query: 'q' })).rejects.toThrow(/401/)
  })

  it('retries one transport failure, then succeeds', async () => {
    const route = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ results: [{ url: 'https://a.example' }] }))
    const { search } = makeProviders(optionsFor(route as unknown as typeof fetch))
    const result = await search.search({ query: 'q' })
    expect(result.sources).toEqual([{ url: 'https://a.example' }])
    expect(route).toHaveBeenCalledTimes(2)
  })

  it('does not retry an HTTP refusal', async () => {
    const route = vi.fn(async () => jsonResponse({ error: 'nope' }, 400))
    const { search } = makeProviders(optionsFor(route as unknown as typeof fetch))
    await expect(search.search({ query: 'q' })).rejects.toThrow(/400/)
    expect(route).toHaveBeenCalledTimes(1)
  })

  it('is available only for a parseable base URL', () => {
    const route = vi.fn() as unknown as typeof fetch
    expect(makeProviders(optionsFor(route)).search.available()).toBe(true)
    expect(makeProviders(optionsFor(route, { baseURL: () => 'not a url' })).search.available()).toBe(false)
    expect(makeProviders(optionsFor(route)).search.id).toBe(OLLAMA_WEB_PROVIDER_ID)
  })
})

describe('OllamaWebFetchProvider', () => {
  it('posts the url and maps extracted text into a text body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      return jsonResponse({ content: 'page text' }, 200)
    }
    const { fetch: fetchProvider } = makeProviders(optionsFor(route))

    const result = await fetchProvider.fetch({ url: 'https://example.com/page' })

    expect(result).toEqual({
      url: 'https://example.com/page',
      statusCode: 200,
      body: { kind: 'text', content: 'page text' },
      truncated: false,
    })
    expect(calls[0]?.url).toBe('https://ollama.com/api/web_fetch')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ url: 'https://example.com/page' })
  })
})
