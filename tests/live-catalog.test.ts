import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readCatalogCache, writeCatalogCache, type CatalogCacheSnapshot } from '../src/catalog-cache.js'
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

    const result = await catalog.refresh({ baseURL: ENDPOINT, apiKey: 'secret' })

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

    await catalog.refresh({ baseURL: ENDPOINT })
    const settled = catalog.revision()
    const second = await catalog.refresh({ baseURL: ENDPOINT })

    expect(second.changed).toBe(false)
    expect(catalog.revision()).toBe(settled)
  })

  it('keeps the last good catalog when a refresh fails', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })
    await catalog.refresh({ baseURL: ENDPOINT })
    const settled = catalog.revision()
    const listed = catalog.modelsFor(ENDPOINT)

    const failing = createLiveCatalog({
      cachePath: path,
      deps: { fetch: (async () => jsonResponse({ error: 'Unauthorized' }, 401)) as unknown as typeof fetch },
    })
    await expect(failing.refresh({ baseURL: ENDPOINT })).rejects.toThrow(/401/u)

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

    const result = await catalog.refresh({ baseURL: ENDPOINT })

    expect(result).toEqual({ models: 1, described: 1, changed: true, cache: { ok: true } })
    expect(catalog.modelsFor(ENDPOINT)?.map((model) => model.id)).toEqual(['deepseek-v4.1-flash'])
    expect(readCatalogCache(path)?.models.map((model) => model.id)).toEqual(['deepseek-v4.1-flash'])
  })

  it('refuses to adopt an empty listing, because a model picker with nothing in it is not recoverable', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ollama-cloud-live-')), 'catalog.json')
    const catalog = createLiveCatalog({ cachePath: path, deps: { fetch: route } })
    await catalog.refresh({ baseURL: ENDPOINT })

    const empty = createLiveCatalog({
      cachePath: path,
      deps: { fetch: ollamaEndpoint({ listing: [] }) },
    })
    await expect(empty.refresh({ baseURL: ENDPOINT })).rejects.toThrow(/listed no models/u)
    // The cache written by the earlier pass keeps serving for that endpoint.
    expect(empty.modelsFor(ENDPOINT)?.map((model) => model.id)).toEqual(['deepseek-v4.1-flash', 'brand-new'])
  })
})
