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
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_MODELS } from './catalog.js';
import { GENERIC_EFFORTS, pinEfforts, THINKING_LEVELS } from './reasoning.js';
/** Provider route this plugin registers. */
export const PROVIDER = 'ollama-cloud';
/** Plugin name: the loader row id, the settings namespace, and the diagnosis prefix. */
export const PLUGIN_NAME = 'llm-ollama-cloud';
/** Native API base the plugin talks to by default. */
export const DEFAULT_BASE_URL = 'https://ollama.com/api';
/** Display name for selectors; also the profile's display name. */
export const DISPLAY_NAME = 'Ollama Cloud';
/** Credential reference resolved when the configuration does not name one. */
export const DEFAULT_API_KEY_ENV = 'OLLAMA_API_KEY';
/** Context capacity assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_CONTEXT_WINDOW = 262144;
/** Output capability assumed for a model neither configuration nor the catalog sizes. */
export const DEFAULT_MAX_TOKENS = 32768;
/** Maximum provider idle time while one stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Per-attempt budget for one Ollama web-capability request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
/** Minutes between the periodic catalog refreshes a mounted route performs. */
export const DEFAULT_REFRESH_MINUTES = 1440;
const modelEntrySchema = z.object({
    id: z.string().required(),
    name: z.string(),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    vision: z.boolean(),
    reasoningEfforts: z.union([z.const(false), z.dict(z.string())]),
    defaultEffort: z.union(THINKING_LEVELS.map((level) => z.const(level))),
    enabled: z.boolean().default(true),
});
/** Runtime schema for {@link Config}; volatile fields are user-editable. */
export const Config = z.object({
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
    baseURL: z.string().default(DEFAULT_BASE_URL).volatile(),
    models: z.array(modelEntrySchema).volatile(),
    maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS).volatile(),
    defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
    streamIdleTimeoutMs: z.number().step(1).min(1).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
    requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS).volatile(),
    retryPolicy: RetryPolicySchema,
    autoRefresh: z.boolean().default(true).volatile(),
    refreshMinutes: z.number().step(1).min(0).default(DEFAULT_REFRESH_MINUTES).volatile(),
});
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
export function nativeAPIBaseURL(baseURL) {
    const normalized = baseURL.replace(/\/+$/, '');
    if (normalized.endsWith('/api'))
        return normalized;
    if (normalized.endsWith('/v1'))
        return `${normalized.slice(0, -'/v1'.length)}/api`;
    try {
        const url = new URL(normalized);
        if (url.pathname === '/' || url.pathname === '')
            return `${normalized}/api`;
    }
    catch {
        // Not a URL at all: assertBaseURL rejects it with a better message.
    }
    return normalized;
}
/**
 * Map the native Ollama base onto the OpenAI-compatible base pi-ai talks to:
 * `https://ollama.com/api` → `https://ollama.com/v1`, a bare host gains `/v1`,
 * and a base already ending in `/v1` is kept as-is.
 * @param baseURL - native or compatible base URL.
 * @returns the OpenAI-compatible base URL.
 */
export function openAICompatibleBaseURL(baseURL) {
    const normalized = baseURL.replace(/\/+$/, '');
    if (normalized.endsWith('/v1'))
        return normalized;
    if (normalized.endsWith('/api'))
        return `${normalized.slice(0, -'/api'.length)}/v1`;
    return `${normalized}/v1`;
}
/** Refuse a base URL that is not a usable http(s) endpoint. */
function assertBaseURL(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`ollama-cloud: baseURL "${raw}" is not a valid URL`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`ollama-cloud: baseURL "${raw}" must use http or https`);
    }
    return raw.replace(/\/+$/, '');
}
function assertPositive(value, field) {
    if (value === undefined)
        return undefined;
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
        throw new Error(`ollama-cloud: ${field} must be a positive integer, got ${String(value)}`);
    }
    return value;
}
/** Validate one declared effort dict and turn it into the offered-level form. */
function resolveEfforts(modelId, declared) {
    const offered = {};
    for (const [level, wire] of Object.entries(declared)) {
        if (!THINKING_LEVELS.includes(level)) {
            throw new Error(`ollama-cloud: model "${modelId}" declares unknown reasoning level "${level}"`);
        }
        if (typeof wire !== 'string' || wire.trim().length === 0) {
            throw new Error(`ollama-cloud: model "${modelId}" reasoning level "${level}" needs a non-empty wire value`);
        }
        offered[level] = wire;
    }
    if (!Object.keys(offered).some((level) => level !== 'off')) {
        throw new Error(`ollama-cloud: model "${modelId}" reasoningEfforts offers no level beyond "off";`
            + ' declare a thinking level or set reasoningEfforts to false');
    }
    return offered;
}
/** Resolve one model entry over its built-in counterpart, when any. */
function resolveModel(id, entry, base, defaults) {
    const name = entry?.name?.trim() || base?.name || id;
    const contextWindow = assertPositive(entry?.contextWindow ?? base?.contextWindow ?? defaults.contextWindow, `model "${id}" contextWindow`);
    const maxTokens = assertPositive(entry?.maxTokens ?? base?.maxTokens, `model "${id}" maxTokens`);
    const declared = entry?.reasoningEfforts ?? base?.reasoningEfforts;
    // Nothing declares this model's levels: it is a model neither the catalog nor
    // the user has described, so it takes the generic ladder rather than silently
    // losing the effort control the composer would otherwise offer. Ollama
    // accepts these names for any model and falls back to its own default for one
    // that does not use them. A model that truly cannot think says so explicitly
    // with `reasoningEfforts: false`.
    const efforts = declared === false
        ? pinEfforts({})
        : declared === undefined
            ? pinEfforts(GENERIC_EFFORTS)
            : pinEfforts(resolveEfforts(id, declared));
    const declaredDefault = entry?.defaultEffort;
    if (declaredDefault !== undefined && efforts[declaredDefault] === null) {
        throw new Error(`ollama-cloud: model "${id}" defaultEffort "${declaredDefault}" is not one of its offered levels`);
    }
    // A default is inherited from the built-in entry only while the override
    // leaves the level set alone: editing the levels is the user's statement
    // about what the model takes, so a default that no longer fits is dropped
    // rather than repaired.
    const inheritedDefault = entry?.reasoningEfforts === undefined ? base?.defaultEffort : undefined;
    const defaultEffort = declaredDefault
        ?? (inheritedDefault !== undefined && efforts[inheritedDefault] !== null ? inheritedDefault : undefined);
    return {
        id,
        name,
        contextWindow: contextWindow ?? defaults.contextWindow,
        ...maxTokens === undefined ? {} : { maxTokens },
        vision: entry?.vision ?? base?.vision ?? false,
        efforts,
        ...defaultEffort === undefined ? {} : { defaultEffort },
    };
}
/**
 * Merge configured entries over one base catalog.
 *
 * The base is whatever the caller established as the catalog authority — the
 * endpoint's live answer, or the shipped snapshot when no endpoint has been
 * read — and configuration always wins over it by id.
 *
 * @param config - plain plugin configuration.
 * @param defaults - route-level context and output defaults.
 * @param base - catalog the configured entries merge over.
 * @returns the models the route serves, in base order with new ids appended.
 */
function resolveModels(config, defaults, base) {
    const overrides = new Map();
    for (const entry of config.models ?? []) {
        const id = entry?.id?.trim();
        if (id === undefined || id.length === 0) {
            throw new Error('ollama-cloud: every configured model entry needs a non-empty id');
        }
        if (overrides.has(id)) {
            throw new Error(`ollama-cloud: duplicate model id "${id}" in the configured models list`);
        }
        overrides.set(id, entry);
    }
    const models = [];
    for (const shipped of base) {
        const override = overrides.get(shipped.id);
        overrides.delete(shipped.id);
        if (override?.enabled === false)
            continue;
        models.push(resolveModel(shipped.id, override, shipped, defaults));
    }
    for (const [id, entry] of overrides) {
        if (entry?.enabled === false)
            continue;
        models.push(resolveModel(id, entry, undefined, defaults));
    }
    return models;
}
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
export function resolveConnection(config, catalog) {
    const nativeBaseURL = nativeAPIBaseURL(assertBaseURL((config.baseURL ?? DEFAULT_BASE_URL).trim()));
    const defaultContextWindow = assertPositive(config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW, 'defaultContextWindow') ?? DEFAULT_CONTEXT_WINDOW;
    const defaultMaxTokens = assertPositive(config.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens') ?? DEFAULT_MAX_TOKENS;
    const streamIdleTimeoutMs = assertPositive(config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, 'streamIdleTimeoutMs') ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    const requestTimeoutMs = assertPositive(config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs') ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const rawRef = (config.apiKeyEnv ?? DEFAULT_API_KEY_ENV).trim();
    const apiKeyEnv = rawRef.length === 0 ? undefined : credentialRef(rawRef);
    // The endpoint answer is the catalog whenever this endpoint has one; the
    // snapshot is what a route serves before the first successful refresh.
    const base = catalog?.modelsFor(nativeBaseURL) ?? DEFAULT_MODELS;
    return {
        provider: PROVIDER,
        nativeBaseURL,
        chatBaseURL: openAICompatibleBaseURL(nativeBaseURL),
        ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
        models: resolveModels(config, { contextWindow: defaultContextWindow, maxTokens: defaultMaxTokens }, base),
        defaultContextWindow,
        defaultMaxTokens,
        streamIdleTimeoutMs,
        requestTimeoutMs,
        retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-ollama-cloud retryPolicy'),
    };
}
/**
 * Snapshot the live configuration into the plain form `resolveConnection`
 * consumes. Each volatile reference returns a stable snapshot that only
 * changes when its value does, which is what lets the plugin recognize an
 * unchanged configuration by identity.
 * @param config - live configuration handed to `apply`.
 * @returns the plain options for one resolution.
 */
export function plainOptions(config) {
    const models = config.models.get();
    return {
        apiKeyEnv: config.apiKeyEnv.get(),
        baseURL: config.baseURL.get(),
        ...models === undefined ? {} : { models },
        maxTokens: config.maxTokens.get(),
        defaultContextWindow: config.defaultContextWindow.get(),
        streamIdleTimeoutMs: config.streamIdleTimeoutMs.get(),
        requestTimeoutMs: config.requestTimeoutMs.get(),
        ...config.retryPolicy === undefined ? {} : { retryPolicy: config.retryPolicy },
    };
}
/** The volatile fields whose snapshots identify one configuration generation. */
export function optionReferences(config) {
    return [
        config.apiKeyEnv,
        config.baseURL,
        config.models,
        config.maxTokens,
        config.defaultContextWindow,
        config.streamIdleTimeoutMs,
        config.requestTimeoutMs,
    ];
}
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
export function createConnectionReader(config, reportInvalid, catalog) {
    const references = optionReferences(config);
    let lastSnapshots;
    let lastGood;
    return () => {
        const snapshots = [...references.map((reference) => reference.get()), catalog?.revision()];
        if (lastGood !== undefined && lastSnapshots !== undefined
            && snapshots.every((snapshot, index) => snapshot === lastSnapshots?.[index])) {
            return lastGood;
        }
        try {
            const connection = resolveConnection(plainOptions(config), catalog);
            lastSnapshots = snapshots;
            lastGood = connection;
            return connection;
        }
        catch (error) {
            if (lastGood === undefined)
                throw error;
            reportInvalid(error);
            lastSnapshots = snapshots;
            return lastGood;
        }
    };
}
//# sourceMappingURL=config.js.map