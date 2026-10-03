/**
 * The route's self-updating catalog.
 *
 * Ollama adds and retires cloud models on its own schedule, so a shipped
 * snapshot cannot be the truth a release freezes: this module owns the pass
 * that asks the configured endpoint what it serves, adopts the answer, and
 * keeps it across restarts. One refresh reads `GET <base>/tags` for membership
 * and `POST <base>/show` per model for the context window, the input
 * modalities, and the thinking ladder plus default that model itself declares —
 * so both the model list *and* the reasoning effort a model really takes come
 * from the endpoint, never from a table maintained by hand.
 *
 * Adoption is layered, and every layer is honest about what it knows:
 *
 *   user configuration   `models:` entries merge over whatever base is below
 *   live endpoint        what `/api/tags` + `/api/show` answered just now
 *   disk cache           the same, from the last refresh of this endpoint
 *   shipped snapshot     only for ids the endpoint has never described
 *
 * The revision counter is what makes a mid-session refresh visible: the
 * connection reader memoizes on it, so adopting a catalog re-resolves the route
 * and the model picker, the effort levels, and the request path all move to the
 * new catalog without a restart.
 *
 * @module dsh-ollama-cloud/live-catalog
 */

import { mergeLiveCatalog, type CatalogSource, type OllamaModelEntry } from './catalog.js'
import {
  defaultCatalogCachePath,
  readCatalogCache,
  writeCatalogCache,
  type CacheWriteResult,
  type CatalogCacheSnapshot,
} from './catalog-cache.js'
import { discoverCatalog, type DiscoveryDeps, type DiscoveryTarget } from './discovery.js'

/** What one refresh did, for the caller's log line. */
export interface LiveCatalogRefresh {
  /** Models the endpoint listed. */
  readonly models: number
  /** Models the endpoint described through `/api/show`. */
  readonly described: number
  /** Whether the served catalog differs from the one before this pass. */
  readonly changed: boolean
  /** Whether the refreshed catalog reached the disk cache. */
  readonly cache: CacheWriteResult
}

/** What the cache currently holds, for diagnostics. */
export interface CachedCatalog {
  /** Endpoint the cached entries came from. */
  readonly endpoint: string
  /** When that fetch happened, in epoch milliseconds. */
  readonly fetchedAt: number
  /** How many models the fetch listed. */
  readonly models: number
}

/** Construction inputs for {@link createLiveCatalog}. */
export interface LiveCatalogOptions {
  /** Cache file; defaults to {@link defaultCatalogCachePath}. */
  readonly cachePath?: string
  /** Injectable transport, so tests drive refreshes without a network. */
  readonly deps: DiscoveryDeps
}

/** The catalog store the plugin mounts and the connection resolution reads. */
export interface LiveCatalog extends CatalogSource {
  /**
   * Interrogate the endpoint, adopt what it answers, and persist it.
   *
   * Fails loudly (rejects) when the endpoint cannot be read: the caller keeps
   * serving the catalog it already had, which is strictly better than serving
   * a half-answered one. An empty listing is refused for the same reason —
   * membership shrinks by retirement, it does not disappear.
   *
   * @param target - the endpoint, credential, and per-request budget, exactly
   *   what the discovery surface interrogates.
   * @param signal - caller cancellation.
   * @returns what the pass did.
   */
  refresh(target: DiscoveryTarget, signal?: AbortSignal): Promise<LiveCatalogRefresh>
  /** The cached snapshot in use, or `undefined` when nothing was cached yet. */
  cached(): CachedCatalog | undefined
}

/**
 * Build the catalog store for one plugin instance.
 *
 * The cache is read once, here, so the very first model list a session serves
 * is already the endpoint's last answer rather than the shipped snapshot.
 *
 * @param options - cache location and transport.
 * @returns the store.
 */
export function createLiveCatalog(options: LiveCatalogOptions): LiveCatalog {
  const cachePath = options.cachePath ?? defaultCatalogCachePath()
  let snapshot: CatalogCacheSnapshot | undefined = readCatalogCache(cachePath)
  let effective: readonly OllamaModelEntry[] | undefined = snapshot === undefined
    ? undefined
    : mergeLiveCatalog(snapshot.models)
  let revision = 0

  return {
    revision: () => revision,
    modelsFor: (nativeBaseURL) => (snapshot?.endpoint === nativeBaseURL ? effective : undefined),
    cached: () => snapshot === undefined
      ? undefined
      : { endpoint: snapshot.endpoint, fetchedAt: snapshot.fetchedAt, models: snapshot.models.length },
    async refresh(target, signal) {
      const { entries, described } = await discoverCatalog(target, options.deps, signal)
      const endpoint = target.baseURL.replace(/\/+$/, '')
      // An empty listing is a hiccup, not a catalog: adopting it would blank
      // the model picker with nothing to recover from, so the previous catalog
      // keeps serving and the next pass can succeed.
      if (entries.length === 0) {
        throw new Error(`ollama-cloud: ${endpoint} listed no models`)
      }

      const next = mergeLiveCatalog(entries)
      const changed = JSON.stringify(next) !== JSON.stringify(effective)
      snapshot = { endpoint, fetchedAt: Date.now(), models: entries }
      effective = next
      // The revision is the catalog's identity, not the fetch's: a pass that
      // confirmed the catalog must not rebuild every adapter for nothing.
      if (changed) revision += 1
      return {
        models: entries.length,
        described: described.length,
        changed,
        cache: writeCatalogCache(cachePath, snapshot),
      }
    },
  }
}
