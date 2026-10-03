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
 * The catalog itself is not frozen at release: at mount — and then on an
 * interval — the plugin asks the configured endpoint what it serves and adopts
 * the answer for the running session and the next boot (see `live-catalog.ts`),
 * so a model Ollama adds, retires, or re-levels reaches users without a plugin
 * update.
 *
 * @module dsh-ollama-cloud
 */
import type { Context } from '@deepseek-ai/cordis';
import { type Config as ConfigShape, type ConnectionOptions } from './config.js';
import { type ResolveCredential } from './credentials.js';
export { OllamaCloudAdapter } from './adapter.js';
export { Config, createConnectionReader, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_REFRESH_MINUTES, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, DISPLAY_NAME, IDLE_REFRESH_WATCH_MS, nativeAPIBaseURL, openAICompatibleBaseURL, PROVIDER, resolveConnection, } from './config.js';
export { createCredentialResolver } from './credentials.js';
export type { ResolveCredential } from './credentials.js';
export type { Config as ConfigShape, ConfiguredModelEntry, ConnectionOptions, Options, ResolvedModel } from './config.js';
export { DEFAULT_MODELS, mergeCatalogEntry, mergeLiveCatalog } from './catalog.js';
export { plainOptions } from './config.js';
export type { CatalogSource, OllamaModelEntry } from './catalog.js';
export { DEFAULT_DISCOVERY_TIMEOUT_MS, discoverCatalog, discoverModels, nativeBaseFrom } from './discovery.js';
export type { DiscoveredCatalog, DiscoveryDeps, DiscoveryTarget } from './discovery.js';
export { createLiveCatalog } from './live-catalog.js';
export type { CachedCatalog, LiveCatalog, LiveCatalogOptions, LiveCatalogRefresh } from './live-catalog.js';
export { CATALOG_CACHE_FILE, CATALOG_CACHE_VERSION, defaultCatalogCachePath, readCatalogCache, writeCatalogCache, } from './catalog-cache.js';
export type { CacheWriteResult, CatalogCacheSnapshot } from './catalog-cache.js';
export { CREDENTIAL_SET_ENDPOINT, CREDENTIAL_STATUS_ENDPOINT, createUsageRpcHandler, USAGE_ENDPOINT, USAGE_RPC_CHANNEL, } from './rpc.js';
export type { CredentialSetValue, CredentialStatusValue, UsageReadValue, UsageRpcHandler, WireUsageSnapshot, WireUsageWindow, } from './rpc.js';
export { toWireUsage } from './rpc.js';
export { decodeUsageResponse, readUsage, USAGE_MAX_BYTES, USAGE_UNSUPPORTED, USAGE_WINDOW_IDS, UsageError, } from './usage.js';
export type { OllamaUsageModelCount, OllamaUsageSnapshot, OllamaUsageWindow, UsageWindowId } from './usage.js';
export { GENERIC_EFFORTS, offeredLevels, pinEfforts, policyFromThinking } from './reasoning.js';
export type { ReasoningPolicy, ThinkingLevel } from './reasoning.js';
export { createOllamaCloudAuth, createPiAiProfile, toPiAiModel } from './profile.js';
export { MAX_SEARCH_RESULTS, OLLAMA_WEB_PROVIDER_ID, OllamaWebFetchProvider, OllamaWebSearchProvider } from './web.js';
/** Loader row name; also the plugin's settings namespace fallback. */
export declare const name = "llm-ollama-cloud";
/** Which pass asked for a catalog refresh; it names the log line. */
export type CatalogRefreshReason = 'mount' | 'interval';
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
 * Mount the Ollama Cloud route, its discovery surface, its web providers, and
 * the catalog refresh that keeps the route's model list current.
 * @param ctx - the plugin's context.
 * @param config - live configuration for this row.
 */
export declare function apply(ctx: Context, config: ConfigShape): void;
//# sourceMappingURL=index.d.ts.map