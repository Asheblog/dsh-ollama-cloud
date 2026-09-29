/**
 * Plugin configuration and the one explicit resolution into connection facts.
 *
 * Every field is optional and every resolution is pure, so the same function
 * serves the bundle-row config, the user-settings layer above it, and the
 * tests. `models` merges over the built-in catalog by id: adding a model newer
 * than the shipped snapshot is one entry, and a built-in model is hidden with
 * `enabled: false` rather than by restating the whole catalog.
 *
 * @module dsh-ollama-cloud/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

import { DEFAULT_MODELS, type OllamaModelEntry } from './catalog.js'
import { pinEfforts, THINKING_LEVELS, type PinnedEfforts, type ThinkingLevel } from './reasoning.js'

/** Provider route this plugin registers. */
export const PROVIDER = 'ollama-cloud'

/** Native API base the plugin talks to by default. */
export const DEFAULT_BASE_URL = 'https://ollama.com/api'

/** Display name for selectors; also the profile's display name. */
export const DISPLAY_NAME = 'Ollama Cloud'

/** Credential reference resolved when the configuration does not name one. */
export const DEFAULT_API_KEY_ENV = 'OLLAMA_API_KEY'

/** Context capacity assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_CONTEXT_WINDOW = 262144

/** Output capability assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_MAX_TOKENS = 32768

/** Maximum provider idle time while one stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000

/** Per-attempt budget for one Ollama web-capability request. */
export const DEFAULT_WEB_REQUEST_TIMEOUT_MS = 15000

/** One model entry as plugin configuration expresses it. */
export interface ConfiguredModelEntry {
  /** Model id Ollama accepts on the wire. */
  readonly id: string
  /** Display name for selectors; falls back to the built-in name or the id. */
  readonly name?: string
  /** Combined request and response capacity override. */
  readonly contextWindow?: number
  /** Per-request output cap override. */
  readonly maxTokens?: number
  /** Whether the model accepts image input. */
  readonly vision?: boolean
  /**
   * Selectable thinking levels and the wire spelling each sends, or `false`
   * for a model without thinking control. Omitted keeps the built-in entry's
   * mapping when the id matches one; an id no built-in entry matches defaults
   * to `false`.
   */
  readonly reasoningEfforts?: Partial<Record<ThinkingLevel, string>> | false
  /** Default level materialized when a session picks none; must be offered. */
  readonly defaultEffort?: ThinkingLevel
  /** `false` hides this model, which is how a built-in entry is retired. */
  readonly enabled?: boolean
}

/**
 * Plugin configuration in its plain (parsed) form: every field optional, no
 * live references. This is what `resolveConnection` consumes, and what the
 * tests build by hand.
 */
export interface Options {
  /** Credential reference resolved per request; empty means provider-native auth. */
  apiKeyEnv?: string
  /** Native Ollama API base; defaults to the public Ollama Cloud endpoint. */
  baseURL?: string
  /** Model entries merging over the built-in catalog by id. */
  models?: readonly ConfiguredModelEntry[]
  /** Route-default output capability for models without their own. */
  maxTokens?: number
  /** Route-default context capacity for models without their own. */
  defaultContextWindow?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /** Per-attempt budget for Ollama web-capability requests. */
  webRequestTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses the host defaults. */
  retryPolicy?: RetryPolicyConfig
}

/**
 * Live plugin configuration as the harness hands it to `apply`: every
 * user-editable field is a stable {@link Volatile} reference whose value the
 * settings layer updates in place, so the plugin instance stays mounted while
 * its configuration changes. `retryPolicy` is deliberately not volatile — it
 * is captured with the adapter registration, and changing it requires a
 * reload, matching how the host treats registration-captured policy.
 */
export interface Config {
  /** Credential reference resolved per request; empty means provider-native auth. */
  apiKeyEnv: Volatile<string>
  /** Native Ollama API base; defaults to the public Ollama Cloud endpoint. */
  baseURL: Volatile<string>
  /** Model entries merging over the built-in catalog by id. */
  models: Volatile<readonly ConfiguredModelEntry[] | undefined>
  /** Route-default output capability for models without their own. */
  maxTokens: Volatile<number>
  /** Route-default context capacity for models without their own. */
  defaultContextWindow: Volatile<number>
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: Volatile<number>
  /** Per-attempt budget for Ollama web-capability requests. */
  webRequestTimeoutMs: Volatile<number>
  /** Provider-owned model-request retry policy; omission uses the host defaults. */
  retryPolicy?: RetryPolicyConfig
}

const modelEntrySchema = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  vision: z.boolean(),
  reasoningEfforts: z.union([z.const(false), z.dict(z.string())]),
  defaultEffort: z.union(THINKING_LEVELS.map((level) => z.const(level))),
  enabled: z.boolean().default(true),
})

/** Runtime schema for {@link Config}; volatile fields are user-editable. */
export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
  models: z.array(modelEntrySchema).volatile(),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  streamIdleTimeoutMs: z.number().step(1).min(1).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
  webRequestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_WEB_REQUEST_TIMEOUT_MS).volatile(),
  retryPolicy: RetryPolicySchema,
}) as unknown as z<Config>

/** One model as the adapter serves it: metadata resolved, levels pinned. */
export interface ResolvedModel {
  /** Model id passed to requests. */
  readonly id: string
  /** Display name for selectors. */
  readonly name: string
  /** Combined request and response capacity. */
  readonly contextWindow: number
  /** Per-request output cap when the entry declares one. */
  readonly maxTokens?: number
  /** Whether the model accepts image input. */
  readonly vision: boolean
  /** Every harness level, pinned: a string is the wire value, `null` unsupported. */
  readonly efforts: PinnedEfforts
  /** Level materialized when a session picks none. */
  readonly defaultEffort?: ThinkingLevel
}

/** Validated connection facts for one operation. */
export interface ConnectionOptions {
  /** Registered provider route. */
  readonly provider: string
  /** Native Ollama API base; discovery and web capabilities use it as-is. */
  readonly nativeBaseURL: string
  /** OpenAI-compatible base chat requests are sent to. */
  readonly chatBaseURL: string
  /** Credential reference resolved per request; `undefined` means provider-native auth. */
  readonly apiKeyEnv?: CredentialRef
  /** Models exposed to selectors and accepted for chat requests. */
  readonly models: readonly ResolvedModel[]
  /** Context capacity used when a model has no exact value. */
  readonly defaultContextWindow: number
  /** Output capability used when a model has no exact value. */
  readonly defaultMaxTokens: number
  /** Maximum provider idle time while one stream read is outstanding. */
  readonly streamIdleTimeoutMs: number
  /** Per-attempt budget for Ollama web-capability requests. */
  readonly webRequestTimeoutMs: number
  /** Provider-owned retry policy, already resolved. */
  readonly retryPolicy: ResolvedRetryPolicy
}

/**
 * Normalize a configured endpoint into the native Ollama API base.
 *
 * The documented value is the native base (`https://ollama.com/api`), but a
 * bare host is the shape users type first, so it gains `/api`; a `/v1` base
 * (the OpenAI-compatible spelling) maps back to `/api`; an explicit custom
 * path is kept, because only the deployment knows its own layout.
 *
 * @param baseURL - configured endpoint.
 * @returns the native API base.
 */
export function nativeAPIBaseURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/api')) return normalized
  if (normalized.endsWith('/v1')) return `${normalized.slice(0, -'/v1'.length)}/api`
  try {
    const url = new URL(normalized)
    if (url.pathname === '/' || url.pathname === '') return `${normalized}/api`
  } catch {
    // Not a URL at all: assertBaseURL rejects it with a better message.
  }
  return normalized
}

/**
 * Map the native Ollama base onto the OpenAI-compatible base pi-ai talks to:
 * `https://ollama.com/api` → `https://ollama.com/v1`, a bare host gains `/v1`,
 * and a base already ending in `/v1` is kept as-is.
 * @param baseURL - native or compatible base URL.
 * @returns the OpenAI-compatible base URL.
 */
export function openAICompatibleBaseURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) return normalized
  if (normalized.endsWith('/api')) return `${normalized.slice(0, -'/api'.length)}/v1`
  return `${normalized}/v1`
}

/** Refuse a base URL that is not a usable http(s) endpoint. */
function assertBaseURL(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`ollama-cloud: baseURL "${raw}" is not a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ollama-cloud: baseURL "${raw}" must use http or https`)
  }
  return raw.replace(/\/+$/, '')
}

/** Refuse a numeric override that is not a positive count. */
function assertPositive(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`ollama-cloud: ${field} must be a positive integer, got ${String(value)}`)
  }
  return value
}

/** Validate one declared effort dict and turn it into the offered-level form. */
function resolveEfforts(
  modelId: string,
  declared: Partial<Record<ThinkingLevel, string>>,
): Partial<Record<ThinkingLevel, string>> {
  const offered: Partial<Record<ThinkingLevel, string>> = {}
  for (const [level, wire] of Object.entries(declared)) {
    if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
      throw new Error(`ollama-cloud: model "${modelId}" declares unknown reasoning level "${level}"`)
    }
    if (typeof wire !== 'string' || wire.trim().length === 0) {
      throw new Error(`ollama-cloud: model "${modelId}" reasoning level "${level}" needs a non-empty wire value`)
    }
    offered[level as ThinkingLevel] = wire
  }
  if (!Object.keys(offered).some((level) => level !== 'off')) {
    throw new Error(
      `ollama-cloud: model "${modelId}" reasoningEfforts offers no level beyond "off";`
      + ' declare a thinking level or set reasoningEfforts to false',
    )
  }
  return offered
}

/** Resolve one model entry over its built-in counterpart, when any. */
function resolveModel(
  id: string,
  entry: ConfiguredModelEntry | undefined,
  base: OllamaModelEntry | undefined,
  defaults: { contextWindow: number; maxTokens: number },
): ResolvedModel {
  const name = entry?.name?.trim() || base?.name || id
  const contextWindow = assertPositive(
    entry?.contextWindow ?? base?.contextWindow ?? defaults.contextWindow,
    `model "${id}" contextWindow`,
  )
  const maxTokens = assertPositive(entry?.maxTokens ?? base?.maxTokens, `model "${id}" maxTokens`)
  const declared = entry?.reasoningEfforts ?? base?.reasoningEfforts
  const efforts = declared === undefined || declared === false
    ? pinEfforts({})
    : pinEfforts(resolveEfforts(id, declared))
  const declaredDefault = entry?.defaultEffort
  if (declaredDefault !== undefined && efforts[declaredDefault] === null) {
    throw new Error(
      `ollama-cloud: model "${id}" defaultEffort "${declaredDefault}" is not one of its offered levels`,
    )
  }
  // A default is inherited from the built-in entry only while the override
  // leaves the level set alone: editing the levels is the user's statement
  // about what the model takes, so a default that no longer fits is dropped
  // rather than repaired.
  const inheritedDefault = entry?.reasoningEfforts === undefined ? base?.defaultEffort : undefined
  const defaultEffort = declaredDefault
    ?? (inheritedDefault !== undefined && efforts[inheritedDefault] !== null ? inheritedDefault : undefined)

  return {
    id,
    name,
    contextWindow: contextWindow ?? defaults.contextWindow,
    ...maxTokens === undefined ? {} : { maxTokens },
    vision: entry?.vision ?? base?.vision ?? false,
    efforts,
    ...defaultEffort === undefined ? {} : { defaultEffort },
  }
}

/** Merge configured entries over the built-in catalog. */
function resolveModels(config: Options, defaults: { contextWindow: number; maxTokens: number }): ResolvedModel[] {
  const overrides = new Map<string, ConfiguredModelEntry>()
  for (const entry of config.models ?? []) {
    const id = entry?.id?.trim()
    if (id === undefined || id.length === 0) {
      throw new Error('ollama-cloud: every configured model entry needs a non-empty id')
    }
    if (overrides.has(id)) {
      throw new Error(`ollama-cloud: duplicate model id "${id}" in the configured models list`)
    }
    overrides.set(id, entry)
  }

  const models: ResolvedModel[] = []
  for (const base of DEFAULT_MODELS) {
    const override = overrides.get(base.id)
    overrides.delete(base.id)
    if (override?.enabled === false) continue
    models.push(resolveModel(base.id, override, base, defaults))
  }
  for (const [id, entry] of overrides) {
    if (entry?.enabled === false) continue
    models.push(resolveModel(id, entry, undefined, defaults))
  }
  return models
}

/**
 * Resolve raw plugin configuration into the connection facts one operation
 * reads. Invalid configuration throws with the offending field named, so the
 * plugin fails loudly at mount or on a settings save instead of sending
 * requests somewhere unintended.
 * @param config - raw configuration from the bundle row or the settings layer.
 * @returns validated connection facts.
 */
export function resolveConnection(config: Options): ConnectionOptions {
  const nativeBaseURL = nativeAPIBaseURL(assertBaseURL((config.baseURL ?? DEFAULT_BASE_URL).trim()))
  const defaultContextWindow = assertPositive(
    config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    'defaultContextWindow',
  ) ?? DEFAULT_CONTEXT_WINDOW
  const defaultMaxTokens = assertPositive(config.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens') ?? DEFAULT_MAX_TOKENS
  const streamIdleTimeoutMs = assertPositive(
    config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    'streamIdleTimeoutMs',
  ) ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  const webRequestTimeoutMs = assertPositive(
    config.webRequestTimeoutMs ?? DEFAULT_WEB_REQUEST_TIMEOUT_MS,
    'webRequestTimeoutMs',
  ) ?? DEFAULT_WEB_REQUEST_TIMEOUT_MS

  const rawRef = (config.apiKeyEnv ?? DEFAULT_API_KEY_ENV).trim()
  const apiKeyEnv = rawRef.length === 0 ? undefined : credentialRef(rawRef)

  return {
    provider: PROVIDER,
    nativeBaseURL,
    chatBaseURL: openAICompatibleBaseURL(nativeBaseURL),
    ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
    models: resolveModels(config, { contextWindow: defaultContextWindow, maxTokens: defaultMaxTokens }),
    defaultContextWindow,
    defaultMaxTokens,
    streamIdleTimeoutMs,
    webRequestTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-ollama-cloud retryPolicy'),
  }
}

/**
 * Snapshot the live configuration into the plain form `resolveConnection`
 * consumes. Each volatile reference returns a stable snapshot that only
 * changes when its value does, which is what lets the plugin recognize an
 * unchanged configuration by identity.
 * @param config - live configuration handed to `apply`.
 * @returns the plain options for one resolution.
 */
export function plainOptions(config: Config): Options {
  const models = config.models.get()
  return {
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    ...models === undefined ? {} : { models },
    maxTokens: config.maxTokens.get(),
    defaultContextWindow: config.defaultContextWindow.get(),
    streamIdleTimeoutMs: config.streamIdleTimeoutMs.get(),
    webRequestTimeoutMs: config.webRequestTimeoutMs.get(),
    ...config.retryPolicy === undefined ? {} : { retryPolicy: config.retryPolicy },
  }
}

/** The volatile fields whose snapshots identify one configuration generation. */
export function optionReferences(config: Config): readonly Volatile<unknown>[] {
  return [
    config.apiKeyEnv,
    config.baseURL,
    config.models,
    config.maxTokens,
    config.defaultContextWindow,
    config.streamIdleTimeoutMs,
    config.webRequestTimeoutMs,
  ]
}

/**
 * Build the per-operation connection reader the plugin hands to its adapter.
 *
 * Each volatile reference returns a stable snapshot that changes identity only
 * when its value changes, so an unchanged configuration resolves once and the
 * same {@link ConnectionOptions} object is reused — which is also what makes
 * the adapter's own snapshot memoization exact. A configuration that stops
 * resolving after a good one is reported and the last good facts keep serving,
 * so a half-edited settings section never takes the route down mid-session;
 * before any good resolution the error propagates, because the plugin must
 * fail loudly at mount rather than run unconfigured.
 *
 * @param config - live configuration handed to `apply`.
 * @param reportInvalid - sink for a resolution failure that last-good masked.
 * @returns the reader every operation calls.
 */
export function createConnectionReader(
  config: Config,
  reportInvalid: (error: unknown) => void,
): () => ConnectionOptions {
  const references = optionReferences(config)
  let lastSnapshots: readonly unknown[] | undefined
  let lastGood: ConnectionOptions | undefined
  return () => {
    const snapshots = references.map((reference) => reference.get())
    if (lastGood !== undefined && lastSnapshots !== undefined
      && snapshots.every((snapshot, index) => snapshot === lastSnapshots?.[index])) {
      return lastGood
    }
    try {
      const connection = resolveConnection(plainOptions(config))
      lastSnapshots = snapshots
      lastGood = connection
      return connection
    } catch (error) {
      if (lastGood === undefined) throw error
      reportInvalid(error)
      lastSnapshots = snapshots
      return lastGood
    }
  }
}
