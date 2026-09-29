import type { Volatile } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import type { Config } from '../src/config.js'
import { createConnectionReader } from '../src/config.js'

/** A stand-in for the harness's live configuration reference. */
function ref<T>(value: T) {
  let current = value
  return {
    get: (): T => current,
    set: (next: T): void => {
      current = next
    },
  } satisfies Volatile<T> & { set(next: T): void }
}

function liveConfig(overrides: { baseURL?: string; models?: Config['models'] extends Volatile<infer T> ? T : never }) {
  const baseURL = ref(overrides.baseURL ?? 'https://ollama.com/api')
  return {
    config: {
      apiKeyEnv: ref('OLLAMA_API_KEY'),
      baseURL,
      models: ref(overrides.models),
      maxTokens: ref(32768),
      defaultContextWindow: ref(262144),
      streamIdleTimeoutMs: ref(300000),
      webRequestTimeoutMs: ref(15000),
    } as unknown as Config,
    baseURL,
  }
}

describe('createConnectionReader', () => {
  it('resolves once and reuses the facts while the configuration is unchanged', () => {
    const { config } = liveConfig({})
    const reader = createConnectionReader(config, () => {})
    expect(reader()).toBe(reader())
  })

  it('re-resolves after a volatile value changes', () => {
    const { config, baseURL } = liveConfig({})
    const reader = createConnectionReader(config, () => {})
    const first = reader()
    baseURL.set('http://localhost:11434/api')
    const second = reader()
    expect(second).not.toBe(first)
    expect(second.nativeBaseURL).toBe('http://localhost:11434/api')
    expect(second.chatBaseURL).toBe('http://localhost:11434/v1')
  })

  it('fails loudly before any good resolution', () => {
    const { config } = liveConfig({ baseURL: 'not a url' })
    expect(() => createConnectionReader(config, () => {})()).toThrow(/baseURL/)
  })

  it('keeps the last good configuration and reports the invalid one', () => {
    const { config, baseURL } = liveConfig({})
    const reported = vi.fn()
    const reader = createConnectionReader(config, reported)
    const good = reader()
    baseURL.set('not a url')
    expect(reader()).toBe(good)
    expect(reported).toHaveBeenCalledTimes(1)
    expect(reader()).toBe(good)
    expect(reported).toHaveBeenCalledTimes(1)
    baseURL.set('https://ollama.example/api')
    expect(reader().nativeBaseURL).toBe('https://ollama.example/api')
  })

  it('reflects a model-list change on the next read', () => {
    const { config } = liveConfig({})
    const reader = createConnectionReader(config, () => {})
    expect(reader().models.map((model) => model.id)).toContain('kimi-k3')
    ;(config.models as unknown as ReturnType<typeof ref>).set([{ id: 'kimi-k3', enabled: false }])
    expect(reader().models.map((model) => model.id)).not.toContain('kimi-k3')
  })
})
