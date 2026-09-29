import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'

import type { OllamaCloudAdapter } from '../src/adapter.js'
import { resolveConnection } from '../src/config.js'
import { createCredentialResolver } from '../src/credentials.js'
import { nativeBaseFrom } from '../src/discovery.js'
import {
  apply,
  createRouteApiKeyResolver,
  DEFAULT_SETTINGS_NAMESPACE,
  DISPLAY_NAME,
  inject,
  name,
  PROVIDER,
} from '../src/index.js'
import { fakeContext, liveConfig, ref } from './helpers.js'

describe('plugin contract', () => {
  it('declares the loader-facing identity', () => {
    expect(name).toBe('llm-ollama-cloud')
    expect(inject).toEqual(['llm'])
  })

  it('registers the route, its configurable provider, discovery, and web providers', () => {
    const { ctx, captured } = fakeContext({ entryId: DEFAULT_SETTINGS_NAMESPACE })
    apply(ctx, liveConfig().config)

    expect(captured.adapters).toHaveLength(1)
    expect(captured.adapters[0]?.providers).toEqual([PROVIDER])
    expect(captured.directory).toEqual([{
      provider: PROVIDER,
      displayName: DISPLAY_NAME,
      settingsNs: DEFAULT_SETTINGS_NAMESPACE,
      settingsPath: [],
    }])
    expect(captured.discovery).toHaveLength(1)
    expect(captured.discovery[0]?.settingsNs).toBe(DEFAULT_SETTINGS_NAMESPACE)
    expect(captured.web).toEqual({ search: [PROVIDER], fetch: [PROVIDER] })
  })

  it('follows the loader entry id for its settings namespace', () => {
    const { ctx, captured } = fakeContext({ entryId: 'custom-row-id' })
    apply(ctx, liveConfig().config)
    expect(captured.directory[0]).toMatchObject({ settingsNs: 'custom-row-id' })
    expect(captured.discovery[0]?.settingsNs).toBe('custom-row-id')
  })

  it('skips the web registration when the composition has no web seam', () => {
    const { ctx, captured } = fakeContext({ includeWeb: false })
    apply(ctx, liveConfig().config)
    expect(captured.web).toEqual({ search: [], fetch: [] })
  })

  it('fails loudly on an unusable configuration instead of mounting unconfigured', () => {
    const { ctx } = fakeContext({})
    expect(() => apply(ctx, liveConfig({ baseURL: 'not a url' }).config)).toThrow(/baseURL/)
  })
})

describe('usage RPC registration', () => {
  it('registers the usage channel the browser card calls', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ limits: { monthly: { usage: 0.5 } } }), { status: 200 })
    }) as unknown as typeof fetch)

    const { ctx, captured } = fakeContext({ credentials: { resolve: async () => ({ value: 'k' }) } })
    apply(ctx, liveConfig().config)

    expect(captured.rpc).toHaveLength(1)
    expect(captured.rpc[0]?.channel).toBe('/ollama-cloud')
    const handler = captured.rpc[0]?.handler as (
      endpoint: string,
      payload: unknown,
    ) => Promise<unknown>
    await expect(handler('usage/read', {})).resolves.toMatchObject({ ok: true, value: { status: 'ok' } })
    expect(calls[0]).toBe('https://ollama.com/api/usage')
    await expect(handler('credential/status', {})).resolves.toMatchObject({
      ok: true,
      value: { reference: 'OLLAMA_API_KEY', configured: true },
    })

    vi.unstubAllGlobals()
  })

  it('warns instead of failing when the composition refuses the channel', () => {
    const { ctx, captured } = fakeContext({ connectionHandleThrows: true })
    expect(() => apply(ctx, liveConfig().config)).not.toThrow()
    expect(captured.rpc).toEqual([])
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/usage channel could not mount/u))
  })

  it('skips the channel in a composition without a browser session', () => {
    const { ctx, captured } = fakeContext({ includeConnection: false })
    apply(ctx, liveConfig().config)
    expect(captured.rpc).toEqual([])
  })
})

describe('registered adapter behavior', () => {
  function mountedAdapter() {
    const { ctx, captured } = fakeContext({})
    apply(ctx, liveConfig().config)
    return captured.adapters[0]?.adapter as OllamaCloudAdapter
  }

  it('advertises the shipped catalog to selectors', async () => {
    const models = await mountedAdapter().listModels(PROVIDER)
    expect(models).toHaveLength(17)
    expect(models[0]).toEqual({
      provider: PROVIDER,
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      inputModalities: ['text', 'image'],
    })
    expect(models.every((model) => model.provider === PROVIDER)).toBe(true)
  })

  it('publishes the offered thinking levels and the catalog default', async () => {
    const adapter = mountedAdapter()
    const resolved = await adapter.resolveModel(PROVIDER, 'glm-5.3')
    expect(resolved.reasoning?.efforts.map((effort) => effort.id)).toEqual(['low', 'high', 'max'])
    expect(resolved.reasoning?.efforts.map((effort) => effort.name)).toEqual(['Low', 'High', 'Max'])
    expect(resolved.reasoning?.defaultEffort).toBe('max')
    expect(resolved.context?.contextWindow).toBe(1048576)
  })

  it('offers no effort control for a non-reasoning model', async () => {
    const resolved = await mountedAdapter().resolveModel(PROVIDER, 'mistral-large-3:675b')
    expect(resolved.reasoning).toBeUndefined()
  })

  it('reports the route retry policy', () => {
    expect(mountedAdapter().providerRetryPolicy(PROVIDER)).toBeDefined()
  })
})

describe('createCredentialResolver', () => {
  it('resolves through the credentials seam when it is present', async () => {
    const resolve = vi.fn(async () => ({ value: '  from-store  ' }))
    const { ctx } = fakeContext({ credentials: { resolve } })
    const resolver = createCredentialResolver(ctx, 'llm-ollama-cloud')
    await expect(resolver(credentialRef('OLLAMA_API_KEY'))).resolves.toBe('from-store')
    expect(resolve).toHaveBeenCalledWith('OLLAMA_API_KEY')
  })

  it('falls back to the launcher environment without the seam', async () => {
    const { ctx } = fakeContext({
      launchEnvironment: {
        get: (name: string) => (name === 'OLLAMA_API_KEY' ? { value: 'from-env' } : undefined),
      },
    })
    const resolver = createCredentialResolver(ctx, 'llm-ollama-cloud')
    await expect(resolver(credentialRef('OLLAMA_API_KEY'))).resolves.toBe('from-env')
    await expect(resolver(credentialRef('OTHER_KEY'))).resolves.toBeUndefined()
  })

  it('refuses a key no HTTP header can carry without echoing it', async () => {
    const { ctx } = fakeContext({ credentials: { resolve: async () => ({ value: 'bad\nkey' }) } })
    const resolver = createCredentialResolver(ctx, 'llm-ollama-cloud')
    await expect(resolver(credentialRef('OLLAMA_API_KEY'))).rejects.toThrow(/OLLAMA_API_KEY/)
  })
})

describe('createRouteApiKeyResolver', () => {
  const facts = resolveConnection({})

  it('sends no auth for a route that names no reference', async () => {
    const resolver = createRouteApiKeyResolver(async () => 'unused')
    await expect(resolver(resolveConnection({ apiKeyEnv: '' }))).resolves.toBeUndefined()
  })

  it('returns the resolved key', async () => {
    const resolver = createRouteApiKeyResolver(async () => 'k')
    await expect(resolver(facts)).resolves.toBe('k')
  })

  it('fails with MISSING_CREDENTIAL when the named reference is unset', async () => {
    const resolver = createRouteApiKeyResolver(async () => undefined)
    await expect(resolver(facts)).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })
})

describe('model discovery wiring', () => {
  it('interrogates the configured native base with the stored credential', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const route: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'glm-5.3' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ capabilities: ['tools'], model_info: { 'glm_dsa_moe.context_length': 1048576 } }), { status: 200 })
    }
    vi.stubGlobal('fetch', route)

    const { ctx, captured } = fakeContext({
      credentials: { resolve: async () => ({ value: 'stored-key' }) },
    })
    apply(ctx, liveConfig({ baseURL: 'http://localhost:11434' }).config)
    const discover = captured.discovery[0]?.discover as (request: unknown, signal?: AbortSignal) => Promise<unknown>

    const result = await discover({})
    expect(result).toEqual([{ id: 'glm-5.3', name: 'glm-5.3', contextWindow: 1048576, inputModalities: ['text'] }])
    expect(calls[0]?.url).toBe('http://localhost:11434/api/tags')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer stored-key' })
    vi.unstubAllGlobals()
  })

  it('honors a draft endpoint and one-shot key from a configuration surface', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ models: [] }), { status: 200 })
    }) as unknown as typeof fetch)

    const { ctx, captured } = fakeContext({})
    apply(ctx, liveConfig().config)
    const discover = captured.discovery[0]?.discover as (request: unknown, signal?: AbortSignal) => Promise<unknown>

    await discover({ baseURL: 'https://ollama.example/v1', apiKey: 'draft-key' })
    expect(calls[0]?.url).toBe('https://ollama.example/api/tags')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer draft-key' })
    vi.unstubAllGlobals()
  })

  it('fails loudly when the endpoint refuses the listing', async () => {
    vi.stubGlobal('fetch', (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch)
    const { ctx, captured } = fakeContext({})
    apply(ctx, liveConfig().config)
    const discover = captured.discovery[0]?.discover as (request: unknown, signal?: AbortSignal) => Promise<unknown>
    await expect(discover({})).rejects.toThrow(/401/)
    vi.unstubAllGlobals()
  })
})

describe('nativeBaseFrom', () => {
  it('maps the compatible base back to the native surface', () => {
    expect(nativeBaseFrom('https://ollama.com/v1', 'fallback')).toBe('https://ollama.com/api')
    expect(nativeBaseFrom('https://ollama.com/api/', 'fallback')).toBe('https://ollama.com/api')
    expect(nativeBaseFrom('http://localhost:11434', 'fallback')).toBe('http://localhost:11434/api')
    expect(nativeBaseFrom('  ', 'fallback')).toBe('fallback')
    expect(nativeBaseFrom(undefined, 'fallback')).toBe('fallback')
  })
})

describe('live configuration changes', () => {
  it('picks up a model-list change on the next operation', async () => {
    const { ctx, captured } = fakeContext({})
    const { config, references } = liveConfig()
    apply(ctx, config)
    const adapter = captured.adapters[0]?.adapter as OllamaCloudAdapter

    expect((await adapter.listModels(PROVIDER)).map((model) => model.id)).toContain('kimi-k3')
    references.models.set([{ id: 'kimi-k3', enabled: false }])
    expect((await adapter.listModels(PROVIDER)).map((model) => model.id)).not.toContain('kimi-k3')
  })
})
