import { describe, expect, it, vi } from 'vitest'

import { decodeShowResponse, decodeTagsResponse, discoverModels } from '../src/discovery.js'

// Bodies shaped like live https://ollama.com/api responses captured 2026-09-29.
const DEEPSEEK_SHOW = {
  capabilities: ['completion', 'thinking', 'tools', 'vision'],
  details: { family: 'deepseek_v41', parameter_size: '763205315794', quantization_level: 'FP8' },
  model_info: {
    'deepseek_v41.context_length': 1048576,
    'general.architecture': 'deepseek_v41',
  },
  thinking: { values: [false, 'low', 'high', 'max'], default: 'high' },
}

const MISTRAL_SHOW = {
  capabilities: ['completion', 'tools', 'vision'],
  model_info: { 'mistral3.context_length': 262144 },
  thinking: null,
}

const MINIMAX_M3_SHOW = {
  capabilities: ['completion', 'tools', 'thinking', 'vision'],
  model_info: { 'minimax-m3.context_length': 512000 },
}

describe('decodeTagsResponse', () => {
  it('reads and de-duplicates model ids', () => {
    expect(
      decodeTagsResponse({
        models: [
          { name: 'kimi-k3', model: 'kimi-k3' },
          { name: 'kimi-k3', model: 'kimi-k3' },
          { name: 'gpt-oss:20b', model: 'gpt-oss:20b' },
        ],
      }),
    ).toEqual(['kimi-k3', 'gpt-oss:20b'])
  })

  it('refuses a listing without a models array', () => {
    expect(() => decodeTagsResponse({ models: 'nope' })).toThrow(/models/)
  })
})

describe('decodeShowResponse', () => {
  it('maps live metadata into a catalog entry', () => {
    expect(decodeShowResponse('deepseek-v4.1-flash', DEEPSEEK_SHOW)).toEqual({
      id: 'deepseek-v4.1-flash',
      contextWindow: 1048576,
      vision: true,
      reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
      defaultEffort: 'high',
    })
  })

  it('marks a model without thinking metadata as non-reasoning', () => {
    expect(decodeShowResponse('mistral-large-3:675b', MISTRAL_SHOW)).toEqual({
      id: 'mistral-large-3:675b',
      contextWindow: 262144,
      vision: true,
      reasoningEfforts: false,
    })
  })

  it('offers the standard ladder when the endpoint names thinking without a ladder', () => {
    expect(decodeShowResponse('minimax-m3', MINIMAX_M3_SHOW)).toEqual({
      id: 'minimax-m3',
      contextWindow: 512000,
      vision: true,
      reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    })
  })

  it('records a negative vision capability but leaves an absent one unknown', () => {
    expect(decodeShowResponse('gpt-oss:20b', { capabilities: ['completion', 'tools'] }).vision).toBe(false)
    expect(decodeShowResponse('gpt-oss:20b', { model_info: {} })).not.toHaveProperty('vision')
  })
})

interface Route {
  (url: string, init?: RequestInit): Promise<Response>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('discoverModels', () => {
  it('enriches tag listings with show metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: Route = async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/tags')) {
        return jsonResponse({ models: [{ name: 'deepseek-v4.1-flash' }, { name: 'mistral-large-3:675b' }] })
      }
      if (url.endsWith('/show')) {
        const body = JSON.parse(String(init?.body)) as { model: string }
        return jsonResponse(body.model === 'deepseek-v4.1-flash' ? DEEPSEEK_SHOW : MISTRAL_SHOW)
      }
      throw new Error(`unexpected url ${url}`)
    }

    const models = await discoverModels(
      { baseURL: 'https://ollama.com/api', apiKey: 'secret' },
      { fetch: route as unknown as typeof fetch, attribution: () => ({ 'user-agent': 'dsh-test' }) },
    )

    expect(models).toEqual([
      {
        id: 'deepseek-v4.1-flash',
        name: 'deepseek-v4.1-flash',
        contextWindow: 1048576,
        inputModalities: ['text', 'image'],
      },
      {
        id: 'mistral-large-3:675b',
        name: 'mistral-large-3:675b',
        contextWindow: 262144,
        inputModalities: ['text', 'image'],
      },
    ])
    const tagsCall = calls.find((call) => call.url.endsWith('/tags'))
    expect(tagsCall?.init?.headers).toMatchObject({
      authorization: 'Bearer secret',
      'user-agent': 'dsh-test',
    })
    expect(calls.filter((call) => call.url.endsWith('/show'))).toHaveLength(2)
  })

  it('omits the authorization header when no key is configured', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: Route = async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/tags')) return jsonResponse({ models: [{ name: 'kimi-k3' }] })
      return jsonResponse(DEEPSEEK_SHOW)
    }

    await discoverModels(
      { baseURL: 'http://localhost:11434/api' },
      { fetch: route as unknown as typeof fetch },
    )

    expect(calls[0]?.init?.headers).not.toHaveProperty('authorization')
  })

  it('omits models the endpoint cannot describe, because adoption needs their metadata', async () => {
    const route: Route = async (url, init) => {
      if (url.endsWith('/tags')) {
        return jsonResponse({ models: [{ name: 'deepseek-v4.1-flash' }, { name: 'retired-model' }] })
      }
      const body = JSON.parse(String(init?.body)) as { model: string }
      if (body.model === 'retired-model') return jsonResponse({ error: 'was retired' }, 410)
      return jsonResponse(DEEPSEEK_SHOW)
    }
    const seen: string[] = []
    const wrapped: Route = async (url, init) => {
      if (url.endsWith('/show')) seen.push(String(JSON.parse(String(init?.body)).model))
      return route(url, init)
    }

    const models = await discoverModels(
      { baseURL: 'https://ollama.com/api' },
      { fetch: wrapped as unknown as typeof fetch },
    )
    expect(models).toEqual([
      {
        id: 'deepseek-v4.1-flash',
        name: 'deepseek-v4.1-flash',
        contextWindow: 1048576,
        inputModalities: ['text', 'image'],
      },
    ])
    expect(seen).toEqual(['deepseek-v4.1-flash', 'retired-model'])
  })

  it('fails loudly when the listing itself is refused', async () => {
    const route = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
    await expect(
      discoverModels(
        { baseURL: 'https://ollama.com/api' },
        { fetch: route as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/401/)
  })
})
