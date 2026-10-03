/**
 * Disk cache for the catalog an endpoint declared.
 *
 * The endpoint is this route's catalog authority, but a harness boots before —
 * and sometimes without — a reachable endpoint. This file is what a restart
 * serves its first model list from: the refresh at mount then only has to
 * confirm the list, a session started offline still offers the models the
 * endpoint listed last, and a plugin update does not throw that knowledge away.
 * It lives under the harness home rather than inside the installed package, so
 * reinstalling the plugin keeps it.
 *
 * Both directions are best-effort by contract: a file this module cannot read
 * is "no cache", and a file it cannot write is reported to its caller — neither
 * may take the route down, because the running session already holds the
 * catalog in memory.
 *
 * @module dsh-ollama-cloud/catalog-cache
 */
import type { OllamaModelEntry } from './catalog.js';
/** File-format generation; a document from another generation is ignored. */
export declare const CATALOG_CACHE_VERSION = 1;
/** Cache file name under this plugin's own directory in the harness home. */
export declare const CATALOG_CACHE_FILE = "catalog.json";
/**
 * One endpoint's fetched catalog, as the endpoint declared it.
 *
 * The entries are the *endpoint's* answers, not the merged catalog: the
 * shipped snapshot's display names and any future change to the merge policy
 * are re-applied on load, so a plugin update improves the catalog it serves
 * without a new fetch.
 */
export interface CatalogCacheSnapshot {
    /** Native API base the entries came from, as the route normalizes it. */
    readonly endpoint: string;
    /** When the fetch happened, in epoch milliseconds. */
    readonly fetchedAt: number;
    /** Models the endpoint listed, enriched by `/api/show` where it answered. */
    readonly models: readonly OllamaModelEntry[];
}
/** Outcome of one cache write. A failure is reported, never thrown. */
export type CacheWriteResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly error: string;
};
/**
 * The cache file this plugin uses by default.
 *
 * The path comes from the harness's own home resolution
 * (`@deepseek-ai/dsh-home-paths`: an explicitly configured home, then
 * `$DSH_HOME`, then `~/.dsh`), so this plugin's cache lives under the same root
 * as every other piece of harness user data instead of guessing at it.
 *
 * @returns `<harness home>/cache/dsh-ollama-cloud/catalog.json`.
 */
export declare function defaultCatalogCachePath(): string;
/**
 * Read the cached catalog, or nothing when there is none to trust.
 *
 * A missing, unreadable, malformed, or foreign-generation file all read as
 * `undefined`: the caller then serves the shipped snapshot until the endpoint
 * answers again. The whole document is validated — a single unusable entry
 * discards the file rather than serving a partially-trusted catalog — and an
 * empty listing is not a catalog, because a boot that shows no model at all
 * cannot be recovered from in the UI.
 *
 * @param path - cache file to read.
 * @returns the snapshot the file holds, or `undefined`.
 */
export declare function readCatalogCache(path: string): CatalogCacheSnapshot | undefined;
/**
 * Write the cached catalog, reporting a failure instead of throwing.
 *
 * The write is atomic (a temporary file then a rename), so a concurrent reader
 * — another profile, or this plugin's next boot — sees either the previous
 * document or the new one, never a torn mix.
 *
 * @param path - cache file to write.
 * @param snapshot - the catalog one endpoint just declared.
 * @returns `{ ok: true }`, or the failure to report.
 */
export declare function writeCatalogCache(path: string, snapshot: CatalogCacheSnapshot): CacheWriteResult;
//# sourceMappingURL=catalog-cache.d.ts.map