import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'

import { DEFAULT_MODELS, type CatalogSource, type OllamaModelEntry } from '../src/catalog.js'
import {
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  nativeAPIBaseURL,
  openAICompatibleBaseURL,
  PROVIDER,
  resolveConnection,
} from '../src/config.js'

describe('openAICompatibleBaseURL', () => {
  it('maps the native /api base onto the OpenAI-compatible /v1 base', () => {
    expect(openAICompatibleBaseURL('https://ollama.com/api')).toBe('https://ollama.com/v1')
  })

  it('keeps an already-compatible base and tolerates trailing slashes', () => {
    expect(openAICompatibleBaseURL('https://ollama.com/v1')).toBe('https://ollama.com/v1')
    expect(openAICompatibleBaseURL('https://ollama.com/v1/')).toBe('https://ollama.com/v1')
    expect(openAICompatibleBaseURL('https://ollama.com/api/')).toBe('https://ollama.com/v1')
  })

  it('appends /v1 for a bare local base', () => {
    expect(openAICompatibleBaseURL('http://localhost:11434')).toBe('http://localhost:11434/v1')
  })
})

describe('nativeAPIBaseURL', () => {
  it('completes a bare host with the native API root', () => {
    expect(nativeAPIBaseURL('https://ollama.com')).toBe('https://ollama.com/api')
    expect(nativeAPIBaseURL('http://localhost:11434')).toBe('http://localhost:11434/api')
  })

  it('keeps the native base and maps the compatible base back onto it', () => {
    expect(nativeAPIBaseURL('https://ollama.com/api')).toBe('https://ollama.com/api')
    expect(nativeAPIBaseURL('https://ollama.com/api/')).toBe('https://ollama.com/api')
    expect(nativeAPIBaseURL('https://ollama.com/v1')).toBe('https://ollama.com/api')
  })

  it('keeps an explicit custom path, because only the deployment knows its layout', () => {
    expect(nativeAPIBaseURL('https://gateway.example/ollama')).toBe('https://gateway.example/ollama')
  })
})

describe('resolveConnection', () => {
  it('resolves the documented defaults', () => {
    const connection = resolveConnection({})
    expect(connection.provider).toBe(PROVIDER)
    expect(connection.nativeBaseURL).toBe(DEFAULT_BASE_URL)
    expect(connection.chatBaseURL).toBe('https://ollama.com/v1')
    expect(connection.apiKeyEnv).toBe(credentialRef(DEFAULT_API_KEY_ENV))
    expect(connection.defaultContextWindow).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(connection.defaultMaxTokens).toBe(DEFAULT_MAX_TOKENS)
    expect(connection.streamIdleTimeoutMs).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    expect(connection.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS)
    expect(connection.models).toHaveLength(DEFAULT_MODELS.length)
    expect(connection.models.map((model) => model.id)).toEqual(DEFAULT_MODELS.map((model) => model.id))
  })

  it('pins reasoning levels for a built-in model', () => {
    const glm = resolveConnection({}).models.find((model) => model.id === 'glm-5.3')
    expect(glm?.efforts).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    })
    expect(glm?.defaultEffort).toBe('max')
    expect(glm?.name).toBe('GLM-5.3')
  })

  it('merges configured models over the built-in catalog by id', () => {
    const connection = resolveConnection({
      models: [
        { id: 'gpt-oss:20b', contextWindow: 4096 },
        { id: 'brand-new', name: 'Brand New', contextWindow: 8192, reasoningEfforts: { off: 'none', high: 'high' }, defaultEffort: 'high' },
      ],
    })
    expect(connection.models).toHaveLength(DEFAULT_MODELS.length + 1)
    const oss = connection.models.find((model) => model.id === 'gpt-oss:20b')
    expect(oss?.contextWindow).toBe(4096)
    expect(oss?.efforts.low).toBe('low')
    expect(oss?.defaultEffort).toBe('medium')
    const added = connection.models.at(-1)
    expect(added).toMatchObject({ id: 'brand-new', name: 'Brand New', contextWindow: 8192, defaultEffort: 'high' })
    expect(added?.efforts.off).toBe('none')
  })

  it('hides a built-in model marked disabled', () => {
    const connection = resolveConnection({ models: [{ id: 'deepseek-v4.1-flash', enabled: false }] })
    expect(connection.models.map((model) => model.id)).not.toContain('deepseek-v4.1-flash')
    expect(connection.models).toHaveLength(DEFAULT_MODELS.length - 1)
  })

  it('treats an empty override list as no overrides', () => {
    expect(resolveConnection({ models: [] }).models).toHaveLength(DEFAULT_MODELS.length)
  })

  it('gives a model nothing describes the standard ladder instead of no control', () => {
    const added = resolveConnection({ models: [{ id: 'mystery-model' }] })
      .models.find((model) => model.id === 'mystery-model')
    expect(added?.efforts).toEqual({
      off: 'none',
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: 'max',
    })
    expect(added?.defaultEffort).toBeUndefined()
  })

  it('lets a configured entry declare non-reasoning', () => {
    const kimi = resolveConnection({ models: [{ id: 'kimi-k3', reasoningEfforts: false }] })
      .models.find((model) => model.id === 'kimi-k3')
    expect(kimi?.efforts.max).toBeNull()
    expect(kimi?.defaultEffort).toBeUndefined()
  })

  it('rejects a default effort the entry does not offer', () => {
    expect(() => resolveConnection({
      models: [{ id: 'gpt-oss:20b', reasoningEfforts: { high: 'high' }, defaultEffort: 'low' }],
    })).toThrow(/gpt-oss:20b.*low|low.*gpt-oss:20b/)
  })

  it('rejects duplicate configured ids', () => {
    expect(() => resolveConnection({ models: [{ id: 'x' }, { id: 'x' }] })).toThrow(/duplicate/i)
  })

  it('rejects a configured entry without an id', () => {
    expect(() => resolveConnection({ models: [{ id: '' }] })).toThrow(/id/i)
  })

  it('normalizes the credential reference', () => {
    expect(resolveConnection({ apiKeyEnv: 'MY_OLLAMA_KEY' }).apiKeyEnv).toBe(credentialRef('MY_OLLAMA_KEY'))
    expect(resolveConnection({ apiKeyEnv: '  spaced  ' }).apiKeyEnv).toBe(credentialRef('spaced'))
    expect(resolveConnection({ apiKeyEnv: '' }).apiKeyEnv).toBeUndefined()
  })

  it('rejects an unusable base URL', () => {
    expect(() => resolveConnection({ baseURL: 'not a url' })).toThrow(/baseURL/)
    expect(() => resolveConnection({ baseURL: 'ftp://ollama.com' })).toThrow(/baseURL/)
  })

  it('rejects non-positive numeric overrides', () => {
    expect(() => resolveConnection({ defaultContextWindow: 0 })).toThrow(/defaultContextWindow/)
    expect(() => resolveConnection({ models: [{ id: 'x', contextWindow: -1 }] })).toThrow(/contextWindow/)
  })
})

describe('resolveConnection over a live catalog', () => {
  /** A catalog seam holding one endpoint's freshly fetched entries. */
  function liveCatalog(endpoint: string, models: readonly OllamaModelEntry[]): CatalogSource {
    return {
      revision: () => 1,
      modelsFor: (nativeBaseURL) => (nativeBaseURL === endpoint ? models : undefined),
    }
  }

  it('takes the endpoint list as the catalog, not the shipped snapshot', () => {
    const connection = resolveConnection(
      {},
      liveCatalog(DEFAULT_BASE_URL, [
        {
          id: 'glm-5.3',
          contextWindow: 4096,
          reasoningEfforts: { low: 'low', high: 'high' },
          defaultEffort: 'high',
        },
        { id: 'brand-new' },
      ]),
    )

    expect(connection.models.map((model) => model.id)).toEqual(['glm-5.3', 'brand-new'])
    // The endpoint's own levels, not the snapshot's `low/high/max` + `max`.
    expect(connection.models[0]?.efforts.max).toBeNull()
    expect(connection.models[0]?.defaultEffort).toBe('high')
    expect(connection.models[1]?.efforts.off).toBe('none')
  })

  it('lets a configured entry still override the live entry', () => {
    const connection = resolveConnection(
      { models: [{ id: 'glm-5.3', enabled: false }] },
      liveCatalog(DEFAULT_BASE_URL, [{ id: 'glm-5.3' }, { id: 'brand-new' }]),
    )
    expect(connection.models.map((model) => model.id)).toEqual(['brand-new'])
  })

  it('falls back to the shipped snapshot for an endpoint the live catalog does not know', () => {
    const connection = resolveConnection({}, liveCatalog('http://localhost:11434/api', [{ id: 'brand-new' }]))
    expect(connection.models.map((model) => model.id)).toEqual(DEFAULT_MODELS.map((model) => model.id))
  })
})
