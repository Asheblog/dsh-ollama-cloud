/**
 * Ollama Cloud for DeepSeek Harness.
 *
 * One plugin instance owns the `ollama-cloud` route: chat runs through the
 * official pi-ai adapter against Ollama's OpenAI-compatible `/v1` surface,
 * model discovery reads the native `/api` surface, and the Ollama web
 * search/fetch endpoints register as `ctx.web` providers. The thinking levels
 * each model offers come from the model's own wire metadata, so the composer's
 * effort selector adjusts real capability instead of a guess.
 *
 * @module dsh-ollama-cloud
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Config as ConfigShape, type ConnectionOptions } from './config.js';
import { type ResolveCredential } from './credentials.js';
export { OllamaCloudAdapter } from './adapter.js';
export { Config, createConnectionReader, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, DISPLAY_NAME, nativeAPIBaseURL, openAICompatibleBaseURL, PROVIDER, resolveConnection, } from './config.js';
export { createCredentialResolver } from './credentials.js';
export type { ResolveCredential } from './credentials.js';
export type { Config as ConfigShape, ConfiguredModelEntry, ConnectionOptions, Options, ResolvedModel } from './config.js';
export { DEFAULT_MODELS } from './catalog.js';
export { plainOptions } from './config.js';
export type { OllamaModelEntry } from './catalog.js';
export { DEFAULT_DISCOVERY_TIMEOUT_MS, discoverModels, nativeBaseFrom } from './discovery.js';
export { GENERIC_EFFORTS, offeredLevels, pinEfforts, policyFromThinking } from './reasoning.js';
export type { ReasoningPolicy, ThinkingLevel } from './reasoning.js';
export { createOllamaCloudAuth, createPiAiProfile, toPiAiModel } from './profile.js';
export { MAX_SEARCH_RESULTS, OLLAMA_WEB_PROVIDER_ID, OllamaWebFetchProvider, OllamaWebSearchProvider } from './web.js';
/** Loader row name; also the plugin's settings namespace fallback. */
export declare const name = "llm-ollama-cloud";
/** The route lives on the LLM seam. */
export declare const inject: string[];
/** Default settings namespace when the loader does not supply an entry id. */
export declare const DEFAULT_SETTINGS_NAMESPACE = "llm-ollama-cloud";
/**
 * Build the credential resolution a chat request needs.
 *
 * A route that names a reference fails loud when it is unset — handing pi-ai
 * `undefined` would let it pick up an unrelated ambient key and bill another
 * tenant — while a route that names none (a local Ollama server) sends no
 * auth at all.
 *
 * @param resolveCredential - the per-request seam resolver.
 * @returns the route's key resolver.
 */
export declare function createRouteApiKeyResolver(resolveCredential: ResolveCredential): (facts: ConnectionOptions) => Promise<string | undefined>;
/**
 * Mount the Ollama Cloud route, its discovery surface, and its web providers.
 * @param ctx - the plugin's context.
 * @param config - live configuration for this row.
 */
export declare function apply(ctx: Context, config: ConfigShape): void;
//# sourceMappingURL=index.d.ts.map