/**
 * The Ollama Cloud catalog: the shipped snapshot, the catalog seam the
 * connection resolution reads, and the merge policy between them.
 *
 * `DEFAULT_MODELS` is a snapshot of the models the public cloud served, taken
 * from live `GET https://ollama.com/api/tags` plus `POST https://ollama.com/api/show`
 * responses on 2026-09-29. It is **not** the authority: Ollama adds and retires
 * cloud models on its own schedule (retired ids answer HTTP 410), so the plugin
 * refreshes the catalog from the configured endpoint on every mount and serves
 * the answer for the session (see `live-catalog.ts`). The snapshot survives for
 * exactly two jobs — the layer a catalog falls back to before any endpoint has
 * answered, and the source of the display names the cloud ids never carry.
 *
 * `reasoningEfforts` mirrors the wire metadata exactly: each key is a harness
 * thinking level the picker offers, each value is the spelling Ollama receives
 * in `reasoning_effort`. Models the metadata reports as boolean-only expose
 * `off` plus a single `high` level — Ollama accepts any recognized effort for
 * them and turns it into `true`, so the level id is a label and the wire value
 * is what selects thinking on.
 *
 * @module dsh-ollama-cloud/catalog
 */

import { GENERIC_EFFORTS, type ThinkingLevel } from './reasoning.js'

/** One model entry advertised by the plugin and accepted for chat requests. */
export interface OllamaModelEntry {
  /** Model id Ollama accepts on the wire. */
  readonly id: string
  /** Display name for selectors; falls back to the id. */
  readonly name?: string
  /** Combined request and response capacity; falls back to the route default. */
  readonly contextWindow?: number
  /** Per-request output cap override; falls back to the route default. */
  readonly maxTokens?: number
  /** Whether the model accepts image input. */
  readonly vision?: boolean
  /**
   * Selectable thinking levels and the wire spelling each one sends, or
   * `false` for a model with no thinking control. Omitted keeps the built-in
   * entry's mapping when the id matches one.
   */
  readonly reasoningEfforts?: Partial<Record<ThinkingLevel, string>> | false
  /** Default level materialized when a session picks none; must be offered. */
  readonly defaultEffort?: ThinkingLevel
}

/**
 * The catalog seam the connection resolution reads.
 *
 * The implementation is the live catalog (the store that refreshes from the
 * configured endpoint); a bare `resolveConnection()` call falls back to the
 * shipped snapshot.
 */
export interface CatalogSource {
  /**
   * Identity of the catalog generation. A new value re-resolves every
   * memoized connection, which is how a catalog adopted mid-session reaches
   * the route without a reload; an unchanged value means the memoized facts
   * still hold.
   */
  revision(): unknown
  /**
   * Base catalog for one native endpoint, or `undefined` to serve the shipped
   * snapshot — because the endpoint was never interrogated, or because the
   * question was answered for a different endpoint.
   * @param nativeBaseURL - normalized native API base the route talks to.
   * @returns the endpoint's catalog, or `undefined`.
   */
  modelsFor(nativeBaseURL: string): readonly OllamaModelEntry[] | undefined
}

/**
 * Merge one endpoint-declared entry over the shipped snapshot entry for the
 * same id.
 *
 * The endpoint is the authority for what a model *is*; the snapshot only fills
 * what the endpoint did not answer, plus the display name the cloud id never
 * carries. A model whose detail request failed arrives as `{ id }`, so its
 * levels stay undeclared and it takes the standard ladder, exactly like a model
 * neither source describes.
 *
 * @param live - entry an endpoint declared.
 * @param shipped - the snapshot entry with the same id, when the snapshot has one.
 * @returns the entry the route should serve.
 */
export function mergeCatalogEntry(live: OllamaModelEntry, shipped?: OllamaModelEntry): OllamaModelEntry {
  // "Said nothing" and "said no thinking" are different answers: the latter is
  // `reasoningEfforts: false`, the former omits the field and inherits here.
  const inherited = live.reasoningEfforts === undefined ? shipped : undefined
  const reasoningEfforts = inherited === undefined ? live.reasoningEfforts : inherited.reasoningEfforts
  // A default is inherited only while the level set is: an endpoint that
  // re-declared the ladder without naming a default has answered for it.
  const defaultEffort = inherited === undefined ? live.defaultEffort : inherited.defaultEffort
  const name = shipped?.name ?? live.name
  const contextWindow = live.contextWindow ?? shipped?.contextWindow
  const maxTokens = live.maxTokens ?? shipped?.maxTokens
  const vision = live.vision ?? shipped?.vision
  return {
    id: live.id,
    ...name === undefined ? {} : { name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...vision === undefined ? {} : { vision },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    ...defaultEffort === undefined ? {} : { defaultEffort },
  }
}

/**
 * Merge a whole endpoint listing over the shipped snapshot.
 *
 * Membership comes from the live list alone: a model the endpoint no longer
 * lists is gone, however curated it once was.
 *
 * @param live - entries the endpoint declared, in listing order.
 * @param shipped - snapshot to inherit display names and unanswered fields from.
 * @returns the merged catalog, in listing order.
 */
export function mergeLiveCatalog(
  live: readonly OllamaModelEntry[],
  shipped: readonly OllamaModelEntry[] = DEFAULT_MODELS,
): OllamaModelEntry[] {
  const byId = new Map(shipped.map((model) => [model.id, model]))
  return live.map((entry) => mergeCatalogEntry(entry, byId.get(entry.id)))
}

/** The snapshot of Ollama Cloud models this plugin ships with. */
export const DEFAULT_MODELS: readonly OllamaModelEntry[] = [
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1048576,
    vision: true,
    reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
    defaultEffort: 'high',
  },
  {
    id: 'deepseek-v4-pro:0813',
    name: 'DeepSeek V4 Pro',
    contextWindow: 1048576,
    reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
    defaultEffort: 'low',
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    contextWindow: 1048576,
    vision: true,
    reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
    defaultEffort: 'max',
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    contextWindow: 262144,
    vision: true,
    reasoningEfforts: { off: 'none', high: 'high' },
    defaultEffort: 'high',
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    contextWindow: 262144,
    vision: true,
    reasoningEfforts: { off: 'none', high: 'high' },
    defaultEffort: 'high',
  },
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1048576,
    reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
    defaultEffort: 'max',
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    contextWindow: 1048576,
    vision: true,
    reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
    defaultEffort: 'max',
  },
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    contextWindow: 1048576,
    reasoningEfforts: { off: 'none', high: 'high', max: 'max' },
    defaultEffort: 'high',
  },
  {
    id: 'gpt-oss:120b',
    name: 'GPT-OSS 120B',
    contextWindow: 131072,
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
    defaultEffort: 'medium',
  },
  {
    id: 'gpt-oss:20b',
    name: 'GPT-OSS 20B',
    contextWindow: 131072,
    reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
    defaultEffort: 'medium',
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    contextWindow: 512000,
    vision: true,
    // The metadata reports the thinking capability without a ladder, so the
    // standard names are offered and no default is claimed.
    reasoningEfforts: GENERIC_EFFORTS,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    contextWindow: 196608,
    // `values: [true]` — thinking cannot be switched off on this model.
    reasoningEfforts: { high: 'high' },
    defaultEffort: 'high',
  },
  {
    id: 'nemotron-3-ultra',
    name: 'Nemotron 3 Ultra',
    contextWindow: 262144,
    reasoningEfforts: { off: 'none', high: 'high' },
    defaultEffort: 'high',
  },
  {
    id: 'nemotron-3-super',
    name: 'Nemotron 3 Super',
    contextWindow: 262144,
    reasoningEfforts: { off: 'none', high: 'high' },
    defaultEffort: 'high',
  },
  {
    id: 'nemotron-3-nano:30b',
    name: 'Nemotron 3 Nano 30B',
    contextWindow: 262144,
    reasoningEfforts: { off: 'none', high: 'high' },
    defaultEffort: 'high',
  },
  {
    id: 'gemma4:31b',
    name: 'Gemma 4 31B',
    contextWindow: 262144,
    vision: true,
    reasoningEfforts: { off: 'none', high: 'high' },
    // The model's own metadata default is `false`; keep thinking off unless asked.
    defaultEffort: 'off',
  },
  {
    id: 'mistral-large-3:675b',
    name: 'Mistral Large 3 675B',
    contextWindow: 262144,
    vision: true,
    reasoningEfforts: false,
  },
]

