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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import os from 'node:os'

import type { OllamaModelEntry } from './catalog.js'
import { THINKING_LEVELS, type ThinkingLevel } from './reasoning.js'

/** File-format generation; a document from another generation is ignored. */
export const CATALOG_CACHE_VERSION = 1

/** Cache file name under this plugin's own directory in the harness home. */
export const CATALOG_CACHE_FILE = 'catalog.json'

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
  readonly endpoint: string
  /** When the fetch happened, in epoch milliseconds. */
  readonly fetchedAt: number
  /** Models the endpoint listed, enriched by `/api/show` where it answered. */
  readonly models: readonly OllamaModelEntry[]
}

/** Outcome of one cache write. A failure is reported, never thrown. */
export type CacheWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

/** A mutable view of a catalog entry, for validating one field at a time. */
type MutableEntry = { -readonly [K in keyof OllamaModelEntry]: OllamaModelEntry[K] }

/**
 * The cache file this plugin uses by default.
 * @returns `<DSH home>/cache/dsh-ollama-cloud/catalog.json`.
 */
export function defaultCatalogCachePath(): string {
  const home = process.env.DSH_HOME?.trim() || join(os.homedir(), '.dsh')
  return join(home, 'cache', 'dsh-ollama-cloud', CATALOG_CACHE_FILE)
}

/** Read a positive integer field, `undefined` when absent and `false` when unusable. */
function readCount(value: unknown): number | undefined | false {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return false
  return value
}

/**
 * Read one `reasoningEfforts` field.
 * @param value - raw field.
 * @returns the declared levels (`undefined` when absent, `false` for an
 *   explicit non-reasoning model), or `{ ok: false }` for an unusable value —
 *   which must not be confused with the legitimate `false`.
 */
function readEfforts(
  value: unknown,
): { readonly ok: true; readonly value: Partial<Record<ThinkingLevel, string>> | false | undefined } | { readonly ok: false } {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === false) return { ok: true, value: false }
  if (value === null || typeof value !== 'object') return { ok: false }
  const offered: Partial<Record<ThinkingLevel, string>> = {}
  for (const [level, wire] of Object.entries(value as Record<string, unknown>)) {
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) return { ok: false }
    if (typeof wire !== 'string' || wire.length === 0) return { ok: false }
    offered[level as ThinkingLevel] = wire
  }
  // An `off`-only declaration is not a usable offer (nothing turns thinking on).
  if (!Object.keys(offered).some((level) => level !== 'off')) return { ok: false }
  return { ok: true, value: offered }
}

/** Validate one untrusted entry, returning it only when every field fits. */
function readEntry(value: unknown): OllamaModelEntry | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return undefined

  const entry: MutableEntry = { id: record.id }
  if (record.name !== undefined) {
    if (typeof record.name !== 'string' || record.name.length === 0) return undefined
    entry.name = record.name
  }
  for (const field of ['contextWindow', 'maxTokens'] as const) {
    const count = readCount(record[field])
    if (count === false) return undefined
    if (count !== undefined) entry[field] = count
  }
  if (record.vision !== undefined) {
    if (typeof record.vision !== 'boolean') return undefined
    entry.vision = record.vision
  }
  const efforts = readEfforts(record.reasoningEfforts)
  if (!efforts.ok) return undefined
  if (efforts.value !== undefined) entry.reasoningEfforts = efforts.value
  if (record.defaultEffort !== undefined) {
    const level = record.defaultEffort
    if (typeof level !== 'string' || !(THINKING_LEVELS as readonly string[]).includes(level)) return undefined
    entry.defaultEffort = level as ThinkingLevel
  }
  return entry
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
export function readCatalogCache(path: string): CatalogCacheSnapshot | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== CATALOG_CACHE_VERSION) return undefined
  if (typeof record.endpoint !== 'string' || record.endpoint.length === 0) return undefined
  if (typeof record.fetchedAt !== 'number' || !Number.isFinite(record.fetchedAt)) return undefined
  if (!Array.isArray(record.models) || record.models.length === 0) return undefined

  const models: OllamaModelEntry[] = []
  for (const value of record.models) {
    const entry = readEntry(value)
    if (entry === undefined) return undefined
    models.push(entry)
  }
  return { endpoint: record.endpoint, fetchedAt: record.fetchedAt, models }
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
export function writeCatalogCache(path: string, snapshot: CatalogCacheSnapshot): CacheWriteResult {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.tmp`
    const document = { version: CATALOG_CACHE_VERSION, ...snapshot }
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, path)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
