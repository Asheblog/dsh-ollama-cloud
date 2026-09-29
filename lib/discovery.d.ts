/**
 * Ollama-native model discovery behind `llm/discoverModels`.
 *
 * The chat protocol runs on the OpenAI-compatible `/v1` surface delegated to
 * pi-ai, but the catalog lives on the native `/api` surface: `GET /api/tags`
 * lists what the endpoint serves and `POST /api/show` enriches one model with
 * its context window and capabilities. Both are anonymous on the public cloud
 * and use the configured credential when one exists, so a self-hosted or
 * gated endpoint works too.
 *
 * Discovery is advisory: the harness offers the answer for adoption and never
 * stores it, and a model whose detail request fails stays listed with the id
 * the listing gave.
 *
 * @module dsh-ollama-cloud/discovery
 */
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm';
import type { OllamaModelEntry } from './catalog.js';
/** Default per-request budget for one discovery call. */
export declare const DEFAULT_DISCOVERY_TIMEOUT_MS = 15000;
/**
 * Normalize the endpoint a configuration surface names into the native base
 * discovery talks to.
 *
 * A draft profile carries the endpoint the way a user typed it — a bare host,
 * an OpenAI-compatible `/v1` base, or the native `/api` base — so the draft is
 * run through the same normalization the plugin's own configuration uses
 * ({@link nativeAPIBaseURL}), and an absent draft falls back to the configured
 * route's base.
 *
 * @param baseURL - draft endpoint from a configuration surface, when any.
 * @param fallback - the configured route's native base.
 * @returns the native base URL to interrogate.
 */
export declare function nativeBaseFrom(baseURL: string | undefined, fallback: string): string;
/**
 * Decode one `/api/tags` response into the model ids it lists.
 * @param body - parsed response body.
 * @returns de-duplicated model ids in listing order.
 */
export declare function decodeTagsResponse(body: unknown): string[];
/**
 * Decode one `/api/show` response into a catalog entry carrying the fields
 * that endpoint discloses: context window, vision input, and thinking levels.
 *
 * A model that reports the thinking capability without a level list gets the
 * boolean treatment (`off` plus one `high` level) because that is how Ollama
 * answers such models: any recognized effort switches thinking on.
 *
 * @param id - model id the response belongs to.
 * @param body - parsed response body.
 * @returns the entry, with unset fields omitted.
 */
export declare function decodeShowResponse(id: string, body: unknown): OllamaModelEntry;
/** One endpoint description discovery needs; mirrors the adapter's connection. */
export interface DiscoveryTarget {
    /** Native Ollama API base, e.g. `https://ollama.com/api`. */
    readonly baseURL: string;
    /** Credential for this pass, when one resolved. */
    readonly apiKey?: string;
    /** Per-request budget in milliseconds. */
    readonly requestTimeoutMs?: number;
}
/** Injectable effects, so tests can drive discovery without a network. */
export interface DiscoveryDeps {
    /** Fetch implementation; defaults to the global one. */
    readonly fetch: typeof fetch;
    /** Harness attribution headers; defaults to none. */
    readonly attribution?: () => Record<string, string>;
}
/**
 * List the endpoint's models and describe each with `/api/show` metadata.
 *
 * Only models the endpoint describes become candidates: adoption copies the
 * context window and modalities into configuration, so a guess would be worse
 * than an omission — and a stale listing entry that answers 410 is exactly
 * what a user must not be offered. A refused listing fails the whole call, so
 * a configuration surface reports the endpoint problem instead of showing an
 * empty catalog.
 *
 * @param target - endpoint and credential for this pass.
 * @param deps - injectable fetch and attribution headers.
 * @param signal - caller cancellation.
 * @returns discovery candidates in listing order.
 */
export declare function discoverModels(target: DiscoveryTarget, deps: DiscoveryDeps, signal?: AbortSignal): Promise<LlmDiscoveredModel[]>;
//# sourceMappingURL=discovery.d.ts.map