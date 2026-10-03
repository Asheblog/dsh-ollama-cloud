import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readCatalogCache, writeCatalogCache, type CatalogCacheSnapshot } from '../src/catalog-cache.js'
import { DEFAULT_MODELS, mergeCatalogEntry, mergeLiveCatalog, type OllamaModelEntry } from '../src/catalog.js'
import { createLiveCatalog } from '../src/live-catalog.js'
import { jsonResponse, ollamaEndpoint } from './helpers.js'

const ENDPOINT = 'https://ollama.com/api'

const SHOW_DEEPSEEK = {
  capabilities: ['completion', 'thinking', 'tools', 'vision'],
  model_info: { 'deepseek_v41.context_length': 1048576 },
  thinking: { values: [false, 'low', 'high', 'max'], default: 'high' },
}

const SHOW_NEW = {
  capabilities: ['completion', 'tools'],
  model_info: { 'brand_new.context_length': 131072 },
}

describe('mergeCatalogEntry', () => {
  const shipped: OllamaModelEntry = {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1048576,
    reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
    defaultEffort: 'max',
  }

  it('keeps the endpoint answer with the shipped display name', () => {
    const merged = mergeCatalogEntry(
      { id: 'glm-5.3', contextWindow: 1048576, reasoningEfforts: { low: 'low', high: 'high', max: 'max' }, defaultEffort: 'max' },
      shipped,
    )
    expect(merged).toEqual(shipped)
  })

  it('drops an inherited default when the endpoint re-declares the ladder without one', () => {
    const merged = mergeCatalogEntry(
      { id: 'glm-5.3', reasoningEfforts: { low: 'low', high: 'high' } },
      shipped,
    )
    expect(merged.reasoningEfforts).toEqual({ low: 'low', high: 'high' })
    expect(merged.defaultEffort).toBeUndefined()
    expect(merged.name).toBe('GLM-5.3')
    expect(merged.contextWindow).toBe(1048576)
  })

  it('inherits the shipped ladder when the endpoint said nothing about thinking', () => {
    const merged = mergeCatalogEntry({ id: 'glm-5.3' }, shipped)
    expect(merged).toEqual(shipped)
  })

  it('keeps an explicit non-reasoning answer', () => {
    const merged = mergeCatalogEntry(
      { id: 'mistral-large-3:675b', reasoningEfforts: false },
      { id: 'mistral-large-3:675b', name: 'Mistral Large 3 675B', vision: true, reasoningEfforts: false },
    )
    expect(merged).toEqual({
      id: 'mistral-large-3:675b',
      name: 'Mistral Large 3 675B',
      vision: true,
      reasoningEfforts: false,
    })
  })

  it('leaves a model the snapshot never shipped to its id, the entry id fallback', () => {
    expect(mergeCatalogEntry({ id: 'brand-new', vision: true })).toEqual({ id: 'brand-new', vision: true })
  })
})

describe('mergeLiveCatalog', () => {
  it('keeps only what the endpoint still lists, in listing order', () => {
    const merged = mergeLiveCatalog(
      [{ id: 'kimi-k3' }, { id: 'brand-new' }],
      [{ id: 'kimi-k3', name: 'Kimi K3' }, { id: 'retired-model', name: 'Retired' }],
    )
    expect(merged.map((model) => model.id)).toEqual(['kimi-k3', 'brand-new'])
    expect(merged[0]?.name).toBe('Kimi K3')
    expect(merged[1]?.name).toBeUndefined()
  })

  it('defaults to the shipped snapshot as the fallback layer', () => {
    const merged = mergeLiveCatalog(DEFAULT_MODELS.map((model) => ({ id: model.id })))
    expect(merged.map((model) => model.name)).toEqual(DEFAULT_MODELS.map((model) => model.name))
  })
})

/** A cache file holding the previous session's fetch. */
function cachedFile(snapshot: CatalogCacheSnapshot): string {
  const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
  expect(writeCatalogCache(path, snapshot)).toEqual({ ok: true })
  return path
}

describe('createLiveCatalog', () => {
  const route = ollamaEndpoint({
    listing: ['deepseek-v4.1-flash', 'brand-new'],
    shows: { 'deepseek-v4.1-flash': SHOW_DEEPSEEK, 'brand-new': SHOW_NEW },
  })

  it('serves the cached catalog for its own endpoint before any network call', () => {
    const path = cachedFile({
      endpoint: ENDPOINT,
      fetchedAt: 1,
      models: [{ id: 'deepseek-v4.1-flash', contextWindow: 1048576 }],
    })
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })

    expect(catalog.modelsFor(ENDPOINT)).toEqual([
      {
        id: 'deepseek-v4.1-flash',
        name: 'DeepSeek V4.1 Flash',
        contextWindow: 1048576,
        vision: true,
        reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
        defaultEffort: 'high',
      },
    ])
    expect(catalog.cached()).toEqual({ endpoint: ENDPOINT, fetchedAt: 1, models: 1 })
    // Another endpoint's models were never cached, so it falls back to the snapshot.
    expect(catalog.modelsFor('http://localhost:11434/api')).toBeUndefined()
  })

  it('adopts a fetched catalog, persists it, and reports the change', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })
    const before = catalog.revision()

    const result = await catalog.refresh({ endpoint: ENDPOINT, apiKey: 'secret' })

    expect(result).toEqual({ models: 2, described: 2, changed: true, cache: { ok: true } })
    expect(catalog.revision()).not.toBe(before)
    expect(catalog.modelsFor(ENDPOINT)?.map((model) => model.id)).toEqual(['deepseek-v4.1-flash', 'brand-new'])
    // The live entry wins on capability; the snapshot only lends its display name.
    expect(catalog.modelsFor(ENDPOINT)?.[0]).toEqual({
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      contextWindow: 1048576,
      vision: true,
      reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
      defaultEffort: 'high',
    })
    // A model the snapshot never shipped keeps its id as the name, and the
    // endpoint's negative thinking answer is kept as such.
    const added = catalog.modelsFor(ENDPOINT)?.[1] ?? {}
    expect(added).toEqual({
      id: 'brand-new',
      contextWindow: 131072,
      vision: false,
      reasoningEfforts: false,
    })
    expect(Object.hasOwn(added, 'name')).toBe(false)
    expect(readCatalogCache(path)).toMatchObject({ endpoint: ENDPOINT, models: [{ id: 'deepseek-v4.1-flash' }, { id: 'brand-new' }] })
    expect(readCatalogCache(path)?.fetchedAt).toBeGreaterThan(0)
  })

  it('keeps the revision stable when the endpoint answers the same catalog', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })

    await catalog.refresh({ endpoint: ENDPOINT })
    const settled = catalog.revision()
    const second = await catalog.refresh({ endpoint: ENDPOINT })

    expect(second.changed).toBe(false)
    expect(catalog.revision()).toBe(settled)
  })

  it('keeps the last good catalog when a refresh fails', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })
    await catalog.refresh({ endpoint: ENDPOINT })
    const settled = catalog.revision()
    const listed = catalog.modelsFor(ENDPOINT)

    const failing = createLiveCatalog({
      cachePath: path,
      deps: { fetch: (async () => jsonResponse({ error: 'Unauthorized' }, 401)) as unknown as typeof fetch },
    })
    await expect(failing.refresh({ endpoint: ENDPOINT })).rejects.toThrow(/401/u)

    expect(catalog.revision()).toBe(settled)
    expect(catalog.modelsFor(ENDPOINT)).toBe(listed)
    expect(failing.modelsFor(ENDPOINT)).toBeDefined()
  })

  it('drops a model the endpoint retired while its listing still names it', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const retired = ollamaEndpoint({
      listing: ['deepseek-v4.1-flash', 'retired-model'],
      shows: { 'deepseek-v4.1-flash': SHOW_DEEPSEEK },
    })
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: retired } })

    const result = await catalog.refresh({ endpoint: ENDPOINT })

    expect(result).toEqual({ models: 1, described: 1, changed: true, cache: { ok: true } })
    expect(catalog.modelsFor(ENDPOINT)?.map((model) => model.id)).toEqual(['deepseek-v4.1-flash'])
    expect(readCatalogCache(path)?.models.map((model) => model.id)).toEqual(['deepseek-v4.1-flash'])
  })

  it('refuses to adopt an empty listing, because a model picker with nothing in it is not recoverable', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })
    await catalog.refresh({ endpoint: ENDPOINT })

    const empty = createLiveCatalog({
      cachePath: path,
      deps: { fetch: ollamaEndpoint({ listing: [] }) },
    })
    await expect(empty.refresh({ endpoint: ENDPOINT })).rejects.toThrow(/listed no models/u)
    // The cache written by the earlier pass keeps serving for that endpoint.
    expect(empty.modelsFor(ENDPOINT)?.map((model) => model.id)).toEqual(['deepseek-v4.1-flash', 'brand-new'])
  })
})
