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
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type ResolvedRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { type PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai';
import { type ConnectionOptions } from './config.js';
/** Hooks the plugin owns; every one of them re-reads live state per operation. */
export interface OllamaCloudAdapterOptions {
    /** Current validated connection facts; called once per operation. */
    options: () => ConnectionOptions;
    /** Resolve the credential for one connection snapshot; `undefined` defers to pi-ai auth. */
    resolveApiKey: (connection: ConnectionOptions) => Promise<string | undefined>;
    /** Resolve the optional durable attachment service at request time. */
    resolveAttachments?: () => AttachmentStore | undefined;
    /** Observe replay state degrading to provider-neutral conversion. */
    onReplayDegrade?: PiAiAdapterOptions['onReplayDegrade'];
}
/** The Ollama Cloud chat adapter: Ollama facts around the official pi-ai adapter. */
export declare class OllamaCloudAdapter extends LlmAdapter {
    private readonly config;
    /** One auth injection for the whole plugin instance, stable across rebuilds. */
    private readonly auth;
    private snapshot;
    /** @param config - the plugin-owned resolution hooks. */
    constructor(config: OllamaCloudAdapterOptions);
    /** The delegated adapter for the current connection facts. */
    private current;
    /** @returns this route's display metadata. */
    providerInfo(provider: string): LlmProviderInfo;
    /** @returns the registration-captured retry policy for this route. */
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
    /** @returns the catalog this route advertises to selectors. */
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    /** @returns the model metadata, including the catalog's default thinking level. */
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /** @returns model metadata and a stream bound to the same adapter generation. */
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    /** @returns the chunk stream from the delegated adapter. */
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=adapter.d.ts.map