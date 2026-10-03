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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { THINKING_LEVELS } from './reasoning.js';
/** File-format generation; a document from another generation is ignored. */
export const CATALOG_CACHE_VERSION = 1;
/** Cache file name under this plugin's own directory in the harness home. */
export const CATALOG_CACHE_FILE = 'catalog.json';
/**
 * The cache file this plugin uses by default.
 * @returns `<DSH home>/cache/dsh-ollama-cloud/catalog.json`.
 */
export function defaultCatalogCachePath() {
    const home = process.env.DSH_HOME?.trim() || join(os.homedir(), '.dsh');
    return join(home, 'cache', 'dsh-ollama-cloud', CATALOG_CACHE_FILE);
}
/** Read a positive integer field, `undefined` when absent and `false` when unusable. */
function readCount(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0)
        return false;
    return value;
}
/**
 * Read one `reasoningEfforts` field.
 * @param value - raw field.
 * @returns the declared levels (`undefined` when absent, `false` for an
 *   explicit non-reasoning model), or `{ ok: false }` for an unusable value —
 *   which must not be confused with the legitimate `false`.
 */
function readEfforts(value) {
    if (value === undefined)
        return { ok: true, value: undefined };
    if (value === false)
        return { ok: true, value: false };
    if (value === null || typeof value !== 'object')
        return { ok: false };
    const offered = {};
    for (const [level, wire] of Object.entries(value)) {
        if (!THINKING_LEVELS.includes(level))
            return { ok: false };
        if (typeof wire !== 'string' || wire.length === 0)
            return { ok: false };
        offered[level] = wire;
    }
    // An `off`-only declaration is not a usable offer (nothing turns thinking on).
    if (!Object.keys(offered).some((level) => level !== 'off'))
        return { ok: false };
    return { ok: true, value: offered };
}
/** Validate one untrusted entry, returning it only when every field fits. */
function readEntry(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const record = value;
    if (typeof record.id !== 'string' || record.id.length === 0)
        return undefined;
    const entry = { id: record.id };
    if (record.name !== undefined) {
        if (typeof record.name !== 'string' || record.name.length === 0)
            return undefined;
        entry.name = record.name;
    }
    for (const field of ['contextWindow', 'maxTokens']) {
        const count = readCount(record[field]);
        if (count === false)
            return undefined;
        if (count !== undefined)
            entry[field] = count;
    }
    if (record.vision !== undefined) {
        if (typeof record.vision !== 'boolean')
            return undefined;
        entry.vision = record.vision;
    }
    const efforts = readEfforts(record.reasoningEfforts);
    if (!efforts.ok)
        return undefined;
    if (efforts.value !== undefined)
        entry.reasoningEfforts = efforts.value;
    if (record.defaultEffort !== undefined) {
        const level = record.defaultEffort;
        if (typeof level !== 'string' || !THINKING_LEVELS.includes(level))
            return undefined;
        entry.defaultEffort = level;
    }
    return entry;
}
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
export function readCatalogCache(path) {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return undefined;
    }
    if (parsed === null || typeof parsed !== 'object')
        return undefined;
    const record = parsed;
    if (record.version !== CATALOG_CACHE_VERSION)
        return undefined;
    if (typeof record.endpoint !== 'string' || record.endpoint.length === 0)
        return undefined;
    if (typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt))
        return undefined;
    if (!Array.isArray(record.models) || record.models.length === 0)
        return undefined;
    const models = [];
    for (const value of record.models) {
        const entry = readEntry(value);
        if (entry === undefined)
            return undefined;
        models.push(entry);
    }
    return { endpoint: record.endpoint, fetchedAt: record.fetchedAt, models };
}
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
export function writeCatalogCache(path, snapshot) {
    try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        const document = { version: CATALOG_CACHE_VERSION, ...snapshot };
        writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
        renameSync(temporary, path);
        return { ok: true };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
//# sourceMappingURL=catalog-cache.js.map