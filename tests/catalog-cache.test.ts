import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  CATALOG_CACHE_VERSION,
  defaultCatalogCachePath,
  readCatalogCache,
  writeCatalogCache,
  type CatalogCacheSnapshot,
} from '../src/catalog-cache.js'

const SNAPSHOT: CatalogCacheSnapshot = {
  endpoint: 'https://ollama.com/api',
  fetchedAt: 1_759_000_000_000,
  models: [
    {
      id: 'glm-5.3',
      contextWindow: 1048576,
      reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
      defaultEffort: 'max',
    },
    { id: 'brand-new', vision: true },
  ],
}

/** A fresh directory per case, so cases never share cache bytes. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ollama-cloud-cache-'))
}

function write(path: string, body: unknown): void {
  writeFileSync(path, JSON.stringify(body), 'utf8')
}

describe('catalog cache', () => {
  it('round-trips one endpoint snapshot', () => {
    const path = join(tempDir(), 'catalog.json')
    expect(writeCatalogCache(path, SNAPSHOT)).toEqual({ ok: true })
    expect(readCatalogCache(path)).toEqual(SNAPSHOT)
  })

  it('reports a write it cannot perform instead of throwing at its caller', () => {
    const dir = tempDir()
    const blocker = join(dir, 'not-a-directory')
    writeFileSync(blocker, 'held by a file', 'utf8')

    const result = writeCatalogCache(join(blocker, 'catalog.json'), SNAPSHOT)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })

  it('reads nothing back from bytes it did not write', () => {
    const dir = tempDir()
    const path = join(dir, 'catalog.json')

    writeFileSync(path, '{ not json', 'utf8')
    expect(readCatalogCache(path)).toBeUndefined()

    write(path, { version: CATALOG_CACHE_VERSION + 1, ...SNAPSHOT })
    expect(readCatalogCache(path)).toBeUndefined()

    write(path, { version: CATALOG_CACHE_VERSION, endpoint: '', fetchedAt: 1, models: [] })
    expect(readCatalogCache(path)).toBeUndefined()

    write(path, { version: CATALOG_CACHE_VERSION, endpoint: 'https://ollama.com/api', fetchedAt: 'now', models: [] })
    expect(readCatalogCache(path)).toBeUndefined()

    write(path, { version: CATALOG_CACHE_VERSION, ...SNAPSHOT, models: [{ id: '' }] })
    expect(readCatalogCache(path)).toBeUndefined()

    write(path, { version: CATALOG_CACHE_VERSION, ...SNAPSHOT, models: [{ id: 'x', reasoningEfforts: { low: 3 } }] })
    expect(readCatalogCache(path)).toBeUndefined()

    expect(readCatalogCache(join(dir, 'missing.json'))).toBeUndefined()
  })

  it('keeps a snapshot that carries only what the endpoint answered', () => {
    const path = join(tempDir(), 'catalog.json')
    write(path, {
      version: CATALOG_CACHE_VERSION,
      endpoint: 'https://ollama.com/api',
      fetchedAt: 1,
      models: [{ id: 'minimax-m2.7', reasoningEfforts: false }, { id: 'mystery' }],
    })
    expect(readCatalogCache(path)?.models).toEqual([{ id: 'minimax-m2.7', reasoningEfforts: false }, { id: 'mystery' }])
  })

  it('places the default cache under the harness home', () => {
    const home = process.env.DSH_HOME ?? ''
    expect(home.length).toBeGreaterThan(0)
    expect(defaultCatalogCachePath().replaceAll('\\', '/')).toBe(
      `${home.replaceAll('\\', '/')}/cache/dsh-ollama-cloud/catalog.json`,
    )
  })

  it('falls back to the user home when no harness home is named', () => {
    vi.stubEnv('DSH_HOME', '')
    try {
      expect(defaultCatalogCachePath().replaceAll('\\', '/')).toMatch(
        /(\.dsh\/cache\/dsh-ollama-cloud\/catalog\.json)$/u,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
