/**
 * Built-in Ollama Cloud model catalog.
 *
 * A snapshot of the models the public cloud serves, taken from live
 * `GET https://ollama.com/api/tags` plus `POST https://ollama.com/api/show`
 * responses on 2026-09-29. Ollama retires cloud models on its own schedule
 * (retired ids answer HTTP 410), so this snapshot is a starting point, not an
 * authority: every field is overridable through plugin configuration, and the
 * `llm/discoverModels` surface offers the live list for adoption.
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

