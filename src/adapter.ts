/**
 * The `ollama-cloud` route adapter.
 *
 * Chat behavior is delegated wholesale to the official `PiAiAdapter`, whose
 * OpenAI Chat Completions implementation is what actually talks to Ollama:
 * this class owns only the Ollama-specific facts around it — the connection
 * snapshot, the model catalog, and the per-model default thinking level the
 * harness materializes when a session picks none.
 *
 * A rebuild happens whenever the connection object identity changes, which is
 * exactly when the live configuration resolved new facts; everything already
 * in flight keeps the snapshot it started under.
 *
 * @module dsh-ollama-cloud/adapter
 */

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type PreparedAdapterCall,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai'

import { DISPLAY_NAME, type ConnectionOptions, type ResolvedModel } from './config.js'
import { createOllamaCloudAuth, createPiAiProfile } from './profile.js'

/** Hooks the plugin owns; every one of them re-reads live state per operation. */
export interface OllamaCloudAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => ConnectionOptions
  /** Resolve the credential for one connection snapshot; `undefined` defers to pi-ai auth. */
  resolveApiKey: (connection: ConnectionOptions) => Promise<string | undefined>
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
  /** Observe replay state degrading to provider-neutral conversion. */
  onReplayDegrade?: PiAiAdapterOptions['onReplayDegrade']
}

/** One adapter-owned snapshot: the facts and the delegated adapter built from them. */
interface AdapterSnapshot {
  readonly options: ConnectionOptions
  readonly adapter: PiAiAdapter
}

/** Advertise one catalog model to selectors. */
function toModelInfo(provider: string, model: ResolvedModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name,
    inputModalities: model.vision ? ['text', 'image'] : ['text'],
  }
}

/**
 * Materialize the catalog's default thinking level into resolved model info.
 *
 * The level is per model, while the pi-ai profile carries at most one route
 * default, so the adapter attaches it here — and only when the model actually
 * offers it, because the harness rejects a default outside the offered set.
 * @param info - metadata resolved by the delegated adapter.
 * @param modelId - exact model id the metadata belongs to.
 * @param connection - the snapshot's connection facts.
 * @returns the info, with a default effort when the catalog declares one.
 */
function withDefaultEffort(
  info: LlmResolvedModelInfo,
  modelId: string,
  connection: ConnectionOptions,
): LlmResolvedModelInfo {
  const preferred = connection.models.find((model) => model.id === modelId)?.defaultEffort
  if (preferred === undefined || info.reasoning === undefined) return info
  const id = ReasoningEffortId(preferred)
  if (!info.reasoning.efforts.some((effort) => effort.id === id)) return info
  return { ...info, reasoning: { ...info.reasoning, defaultEffort: id } }
}

/** The Ollama Cloud chat adapter: Ollama facts around the official pi-ai adapter. */
export class OllamaCloudAdapter extends LlmAdapter {
  /** One auth injection for the whole plugin instance, stable across rebuilds. */
  private readonly auth = createOllamaCloudAuth()

  private snapshot: AdapterSnapshot | undefined

  /** @param config - the plugin-owned resolution hooks. */
  constructor(private readonly config: OllamaCloudAdapterOptions) {
    super()
  }

  /** The delegated adapter for the current connection facts. */
  private current(): AdapterSnapshot {
    const options = this.config.options()
    if (this.snapshot !== undefined && this.snapshot.options === options) return this.snapshot
    const profile = createPiAiProfile(options)
    const profiles = new Map([[options.provider, profile]])
    const adapter = new PiAiAdapter({
      profiles: () => profiles,
      resolveApiKey: () => this.config.resolveApiKey(options),
      auth: this.auth,
      ...this.config.resolveAttachments === undefined
        ? {}
        : { resolveAttachments: this.config.resolveAttachments },
      ...this.config.onReplayDegrade === undefined
        ? {}
        : { onReplayDegrade: this.config.onReplayDegrade },
    })
    this.snapshot = { options, adapter }
    return this.snapshot
  }

  /** @returns this route's display metadata. */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: DISPLAY_NAME }
  }

  /** @returns the registration-captured retry policy for this route. */
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined {
    return this.current().options.retryPolicy
  }

  /** @returns the catalog this route advertises to selectors. */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.current().options.models.map((model) => toModelInfo(provider, model))
  }

  /** @returns the model metadata, including the catalog's default thinking level. */
  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const snapshot = this.current()
    const info = await snapshot.adapter.resolveModel(provider, model, signal)
    return withDefaultEffort(info, model, snapshot.options)
  }

  /** @returns model metadata and a stream bound to the same adapter generation. */
  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const snapshot = this.current()
    const prepared = await snapshot.adapter.prepareCall(provider, model, signal)
    return {
      model: withDefaultEffort(prepared.model, model, snapshot.options),
      stream: (options: GenerateOptions) => prepared.stream(options),
    }
  }

  /** @returns the chunk stream from the delegated adapter. */
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.current().adapter.stream(options)
  }
}
