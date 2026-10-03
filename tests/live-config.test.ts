import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MODELS, type CatalogSource, type OllamaModelEntry } from '../src/catalog.js'
import { createConnectionReader } from '../src/config.js'
import { liveConfig } from './helpers.js'

describe('createConnectionReader', () => {
  it('resolves once and reuses the facts while the configuration is unchanged', () => {
    const { config } = liveConfig()
    const reader = createConnectionReader(config, () => {})
    expect(reader()).toBe(reader())
  })

  it('re-resolves after a volatile value changes', () => {
    const { config, references } = liveConfig()
    const reader = createConnectionReader(config, () => {})
    const first = reader()
    references.baseURL.set('http://localhost:11434/api')
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
    const { config, references } = liveConfig()
    const reported = vi.fn()
    const reader = createConnectionReader(config, reported)
    const good = reader()
    references.baseURL.set('not a url')
    expect(reader()).toBe(good)
    expect(reported).toHaveBeenCalledTimes(1)
    expect(reader()).toBe(good)
    expect(reported).toHaveBeenCalledTimes(1)
    references.baseURL.set('https://ollama.example/api')
    expect(reader().nativeBaseURL).toBe('https://ollama.example/api')
  })

  it('reflects a model-list change on the next read', () => {
    const { config, references } = liveConfig()
    const reader = createConnectionReader(config, () => {})
    expect(reader().models.map((model) => model.id)).toContain('kimi-k3')
    references.models.set([{ id: 'kimi-k3', enabled: false }])
    expect(reader().models.map((model) => model.id)).not.toContain('kimi-k3')
  })

  it('re-resolves when the live catalog moves to a new revision', () => {
    let revision = 0
    let models: readonly OllamaModelEntry[] | undefined
    const catalog: CatalogSource = { revision: () => revision, modelsFor: () => models }
    const { config } = liveConfig()
    const reader = createConnectionReader(config, () => {}, catalog)

    expect(reader().models).toHaveLength(DEFAULT_MODELS.length)

    // A new catalog that has not announced itself yet is not observed: the
    // revision is the identity the reader memoizes on.
    models = [{ id: 'brand-new' }]
    expect(reader().models).toHaveLength(DEFAULT_MODELS.length)

    revision = 1
    const refreshed = reader()
    expect(refreshed.models.map((model) => model.id)).toEqual(['brand-new'])
    expect(reader()).toBe(refreshed)
  })
})
