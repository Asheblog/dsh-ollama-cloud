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
import type { Volatile } from '@deepseek-ai/cordis';
import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { type CatalogSource } from './catalog.js';
import { type PinnedEfforts, type ThinkingLevel } from './reasoning.js';
/** Provider route this plugin registers. */
export declare const PROVIDER = "ollama-cloud";
/** Plugin name: the loader row id, the settings namespace, and the diagnosis prefix. */
export declare const PLUGIN_NAME = "llm-ollama-cloud";
/** Native API base the plugin talks to by default. */
export declare const DEFAULT_BASE_URL = "https://ollama.com/api";
/** Display name for selectors; also the profile's display name. */
export declare const DISPLAY_NAME = "Ollama Cloud";
/** Credential reference resolved when the configuration does not name one. */
export declare const DEFAULT_API_KEY_ENV = "OLLAMA_API_KEY";
/** Context capacity assumed for a model neither configuration nor the catalog sizes. */
export declare const DEFAULT_CONTEXT_WINDOW = 262144;
/** Output capability assumed for a model neither configuration nor the catalog sizes. */
export declare const DEFAULT_MAX_TOKENS = 32768;
/** Maximum provider idle time while one stream read is outstanding. */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Per-attempt budget for one Ollama web-capability request. */
export declare const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
/** Minutes between the periodic catalog refreshes a mounted route performs. */
export declare const DEFAULT_REFRESH_MINUTES = 1440;
/** One model entry as plugin configuration expresses it. */
export interface ConfiguredModelEntry {
    /** Model id Ollama accepts on the wire. */
    readonly id: string;
    /** Display name for selectors; falls back to the built-in name or the id. */
    readonly name?: string;
    /** Combined request and response capacity override. */
    readonly contextWindow?: number;
    /** Per-request output cap override. */
    readonly maxTokens?: number;
    /** Whether the model accepts image input. */
    readonly vision?: boolean;
    /**
     * Selectable thinking levels and the wire spelling each sends, or `false`
     * for a model without thinking control. Omitted keeps the built-in entry's
     * mapping when the id matches one; an id neither the catalog nor this entry
     * describes takes the standard ladder (`off` to `max`).
     */
    readonly reasoningEfforts?: Partial<Record<ThinkingLevel, string>> | false;
    /** Default level materialized when a session picks none; must be offered. */
    readonly defaultEffort?: ThinkingLevel;
    /** `false` hides this model, which is how a built-in entry is retired. */
    readonly enabled?: boolean;
}
/**
 * Plugin configuration in its plain (parsed) form: every field optional, no
 * live references. This is what `resolveConnection` consumes, and what the
 * tests build by hand.
 */
export interface Options {
    /** Credential reference resolved per request; empty means provider-native auth. */
    apiKeyEnv?: string;
    /** Native Ollama API base; defaults to the public Ollama Cloud endpoint. */
    baseURL?: string;
    /** Model entries merging over the built-in catalog by id. */
    models?: readonly ConfiguredModelEntry[];
    /** Route-default output capability for models without their own. */
    maxTokens?: number;
    /** Route-default context capacity for models without their own. */
    defaultContextWindow?: number;
    /** Maximum provider idle time while one stream read is outstanding. */
    streamIdleTimeoutMs?: number;
    /** Per-attempt budget for Ollama web-capability requests. */
    requestTimeoutMs?: number;
    /** Provider-owned model-request retry policy; omission uses the host defaults. */
    retryPolicy?: RetryPolicyConfig;
}
/**
 * Live plugin configuration as the harness hands it to `apply`: every
 * user-editable field is a stable {@link Volatile} reference whose value the
 * settings layer updates in place, so the plugin instance stays mounted while
 * its configuration changes. `retryPolicy` is deliberately not volatile — it
 * is captured with the adapter registration, and changing it requires a
 * reload, matching how the host treats registration-captured policy.
 *
 * `autoRefresh` and `refreshMinutes` are read by the plugin's catalog-refresh
 * scheduler, not by {@link resolveConnection}: they decide when the catalog is
 * fetched, never what the route's connection facts are, so changing them must
 * not re-resolve the route.
 */
export interface Config {
    /** Credential reference resolved per request; empty means provider-native auth. */
    apiKeyEnv: Volatile<string>;
    /** Native Ollama API base; defaults to the public Ollama Cloud endpoint. */
    baseURL: Volatile<string>;
    /** Model entries merging over the built-in catalog by id. */
    models: Volatile<readonly ConfiguredModelEntry[] | undefined>;
    /** Route-default output capability for models without their own. */
    maxTokens: Volatile<number>;
    /** Route-default context capacity for models without their own. */
    defaultContextWindow: Volatile<number>;
    /** Maximum provider idle time while one stream read is outstanding. */
    streamIdleTimeoutMs: Volatile<number>;
    /** Per-attempt budget for Ollama web-capability requests. */
    requestTimeoutMs: Volatile<number>;
    /** Provider-owned model-request retry policy; omission uses the host defaults. */
    retryPolicy?: RetryPolicyConfig;
    /**
     * Whether the catalog is refreshed from the endpoint at mount and on the
     * interval below. Off serves the disk cache (or, before any fetch, the
     * shipped snapshot) for as long as the route is mounted. A change is honored
     * by the next scheduled pass; the mount refresh has already run by then.
     */
    autoRefresh: Volatile<boolean>;
    /** Minutes between periodic catalog refreshes; `0` refreshes at mount only. */
    refreshMinutes: Volatile<number>;
}
/** Runtime schema for {@link Config}; volatile fields are user-editable. */
export declare const Config: z<Config>;
/** One model as the adapter serves it: metadata resolved, levels pinned. */
export interface ResolvedModel {
    /** Model id passed to requests. */
    readonly id: string;
    /** Display name for selectors. */
    readonly name: string;
    /** Combined request and response capacity. */
    readonly contextWindow: number;
    /** Per-request output cap when the entry declares one. */
    readonly maxTokens?: number;
    /** Whether the model accepts image input. */
    readonly vision: boolean;
    /** Every harness level, pinned: a string is the wire value, `null` unsupported. */
    readonly efforts: PinnedEfforts;
    /** Level materialized when a session picks none. */
    readonly defaultEffort?: ThinkingLevel;
}
/** Validated connection facts for one operation. */
export interface ConnectionOptions {
    /** Registered provider route. */
    readonly provider: string;
    /** Native Ollama API base; discovery and web capabilities use it as-is. */
    readonly nativeBaseURL: string;
    /** OpenAI-compatible base chat requests are sent to. */
    readonly chatBaseURL: string;
    /** Credential reference resolved per request; `undefined` means provider-native auth. */
    readonly apiKeyEnv?: CredentialRef;
    /** Models exposed to selectors and accepted for chat requests. */
    readonly models: readonly ResolvedModel[];
    /** Context capacity used when a model has no exact value. */
    readonly defaultContextWindow: number;
    /** Output capability used when a model has no exact value. */
    readonly defaultMaxTokens: number;
    /** Maximum provider idle time while one stream read is outstanding. */
    readonly streamIdleTimeoutMs: number;
    /** Per-attempt budget for Ollama web-capability requests. */
    readonly requestTimeoutMs: number;
    /** Provider-owned retry policy, already resolved. */
    readonly retryPolicy: ResolvedRetryPolicy;
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
export declare function nativeAPIBaseURL(baseURL: string): string;
/**
 * Map the native Ollama base onto the OpenAI-compatible base pi-ai talks to:
 * `https://ollama.com/api` → `https://ollama.com/v1`, a bare host gains `/v1`,
 * and a base already ending in `/v1` is kept as-is.
 * @param baseURL - native or compatible base URL.
 * @returns the OpenAI-compatible base URL.
 */
export declare function openAICompatibleBaseURL(baseURL: string): string;
/**
 * Resolve raw plugin configuration into the connection facts one operation
 * reads. Invalid configuration throws with the offending field named, so the
 * plugin fails loudly at mount or on a settings save instead of sending
 * requests somewhere unintended.
 *
 * @param config - raw configuration from the bundle row or the settings layer.
 * @param catalog - the live catalog seam; omitted means the shipped snapshot.
 * @returns validated connection facts.
 */
export declare function resolveConnection(config: Options, catalog?: CatalogSource): ConnectionOptions;
/**
 * Snapshot the live configuration into the plain form `resolveConnection`
 * consumes. Each volatile reference returns a stable snapshot that only
 * changes when its value does, which is what lets the plugin recognize an
 * unchanged configuration by identity.
 * @param config - live configuration handed to `apply`.
 * @returns the plain options for one resolution.
 */
export declare function plainOptions(config: Config): Options;
/** The volatile fields whose snapshots identify one configuration generation. */
export declare function optionReferences(config: Config): readonly Volatile<unknown>[];
/**
 * Build the per-operation connection reader the plugin hands to its adapter.
 *
 * Each volatile reference returns a stable snapshot that changes identity only
 * when its value changes, so an unchanged configuration resolves once and the
 * same {@link ConnectionOptions} object is reused — which is also what makes
 * the adapter's own snapshot memoization exact. The live catalog's revision
 * joins that identity: adopting a refreshed catalog moves it, so the route
 * re-resolves and serves the new models, context windows, and thinking levels
 * in the same session, without a reload. A configuration that stops resolving
 * after a good one is reported and the last good facts keep serving,
 * so a half-edited settings section never takes the route down mid-session;
 * before any good resolution the error propagates, because the plugin must
 * fail loudly at mount rather than run unconfigured.
 *
 * @param config - live configuration handed to `apply`.
 * @param reportInvalid - sink for a resolution failure that last-good masked.
 * @param catalog - live catalog seam; omitted resolves against the snapshot only.
 * @returns the reader every operation calls.
 */
export declare function createConnectionReader(config: Config, reportInvalid: (error: unknown) => void, catalog?: CatalogSource): () => ConnectionOptions;
//# sourceMappingURL=config.d.ts.map