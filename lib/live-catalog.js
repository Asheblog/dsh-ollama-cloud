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
import { mergeLiveCatalog } from './catalog.js';
import { defaultCatalogCachePath, readCatalogCache, writeCatalogCache, } from './catalog-cache.js';
import { discoverCatalog } from './discovery.js';
/**
 * Build the catalog store for one plugin instance.
 *
 * The cache is read once, here, so the very first model list a session serves
 * is already the endpoint's last answer rather than the shipped snapshot.
 *
 * @param options - cache location and transport.
 * @returns the store.
 */
export function createLiveCatalog(options) {
    const cachePath = options.cachePath ?? defaultCatalogCachePath();
    let snapshot = readCatalogCache(cachePath);
    let effective = snapshot === undefined
        ? undefined
        : mergeLiveCatalog(snapshot.models);
    let revision = 0;
    return {
        revision: () => revision,
        modelsFor: (nativeBaseURL) => (snapshot?.endpoint === nativeBaseURL ? effective : undefined),
        cached: () => snapshot === undefined
            ? undefined
            : { endpoint: snapshot.endpoint, fetchedAt: snapshot.fetchedAt, models: snapshot.models.length },
        async refresh(target, signal) {
            const { entries, described } = await discoverCatalog(target, options.deps, signal);
            const endpoint = target.baseURL.replace(/\/+$/, '');
            // An empty listing is a hiccup, not a catalog: adopting it would blank
            // the model picker with nothing to recover from, so the previous catalog
            // keeps serving and the next pass can succeed.
            if (entries.length === 0) {
                throw new Error(`ollama-cloud: ${endpoint} listed no models`);
            }
            const next = mergeLiveCatalog(entries);
            const changed = JSON.stringify(next) !== JSON.stringify(effective);
            snapshot = { endpoint, fetchedAt: Date.now(), models: entries };
            effective = next;
            // The revision is the catalog's identity, not the fetch's: a pass that
            // confirmed the catalog must not rebuild every adapter for nothing.
            if (changed)
                revision += 1;
            return {
                models: entries.length,
                described: described.length,
                changed,
                cache: writeCatalogCache(cachePath, snapshot),
            };
        },
    };
}
//# sourceMappingURL=live-catalog.js.map