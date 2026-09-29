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
import { nativeAPIBaseURL } from './config.js';
import { GENERIC_EFFORTS, offeredEffortMap, policyFromThinking } from './reasoning.js';
/** Default per-request budget for one discovery call. */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15000;
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
export function nativeBaseFrom(baseURL, fallback) {
    const trimmed = baseURL?.trim() ?? '';
    return trimmed.length === 0 ? fallback : nativeAPIBaseURL(trimmed);
}
/** Detail requests one discovery pass keeps in flight. */
const DETAIL_CONCURRENCY = 6;
/** Read one model id out of a `/api/tags` entry. */
function tagModelId(entry) {
    if (entry === null || typeof entry !== 'object')
        return undefined;
    const record = entry;
    const candidate = typeof record.name === 'string' ? record.name : record.model;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}
/**
 * Decode one `/api/tags` response into the model ids it lists.
 * @param body - parsed response body.
 * @returns de-duplicated model ids in listing order.
 */
export function decodeTagsResponse(body) {
    const models = body?.models;
    if (!Array.isArray(models)) {
        throw new Error('ollama-cloud discovery: /api/tags answered without a "models" array');
    }
    const ids = [];
    const seen = new Set();
    for (const entry of models) {
        const id = tagModelId(entry);
        if (id === undefined || seen.has(id))
            continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}
/** Read the context window out of `/api/show` `model_info` keys. */
function readContextWindow(body) {
    const info = body.model_info;
    if (info === null || typeof info !== 'object')
        return undefined;
    for (const [key, value] of Object.entries(info)) {
        if (!key.endsWith('context_length'))
            continue;
        if (typeof value === 'number' && Number.isFinite(value) && value > 0)
            return value;
    }
    return undefined;
}
/**
 * Read the capability list out of a `/api/show` body. `undefined` means the
 * endpoint said nothing, which is not the same answer as an empty list: an
 * absent vision capability is a negative capability, a missing field is
 * unknown, and adoption copies the difference into configuration.
 */
function readCapabilities(body) {
    const capabilities = body.capabilities;
    if (!Array.isArray(capabilities))
        return undefined;
    return capabilities.filter((entry) => typeof entry === 'string');
}
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
export function decodeShowResponse(id, body) {
    const record = (body ?? {});
    const capabilities = readCapabilities(record);
    const contextWindow = readContextWindow(record);
    const policy = policyFromThinking(record.thinking);
    // The endpoint may name the thinking capability without a ladder: the
    // standard names apply, and no default is claimed because none was declared.
    const efforts = policy === undefined
        ? capabilities?.includes('thinking') === true ? GENERIC_EFFORTS : false
        : offeredEffortMap(policy.efforts);
    const defaultEffort = policy?.defaultEffort;
    return {
        id,
        ...contextWindow === undefined ? {} : { contextWindow },
        ...capabilities === undefined ? {} : { vision: capabilities.includes('vision') },
        reasoningEfforts: efforts,
        ...defaultEffort === undefined ? {} : { defaultEffort },
    };
}
/**
 * Enrich one catalog entry into a discovery candidate.
 * @param entry - entry decoded from `/api/show`, when the request succeeded.
 * @param id - model id from the listing.
 * @returns the candidate metadata for adoption.
 */
function toDiscoveredModel(entry, id) {
    const input = entry.vision === undefined
        ? undefined
        : entry.vision === true
            ? ['text', 'image']
            : ['text'];
    return {
        id,
        name: id,
        ...entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow },
        ...input === undefined ? {} : { inputModalities: input },
    };
}
/** One request attempt carrying one timeout, combined with caller cancellation. */
function attemptSignal(callerSignal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]);
}
/** POST one JSON call and parse its reply, or report the status. */
async function postJson(url, payload, headers, deps, signal, timeoutMs) {
    const response = await deps.fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: attemptSignal(signal, timeoutMs),
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${url} answered ${response.status}`);
    }
    return await response.json();
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
export async function discoverModels(target, deps, signal) {
    const base = target.baseURL.replace(/\/+$/, '');
    const timeoutMs = target.requestTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
    const headers = {
        accept: 'application/json',
        ...deps.attribution?.() ?? {},
        ...target.apiKey === undefined ? {} : { authorization: `Bearer ${target.apiKey}` },
    };
    const listing = await deps.fetch(`${base}/tags`, {
        headers,
        redirect: 'error',
        signal: attemptSignal(signal, timeoutMs),
    });
    if (!listing.ok) {
        await listing.body?.cancel();
        throw new Error(`ollama-cloud discovery: ${base}/tags answered ${listing.status}`);
    }
    const ids = decodeTagsResponse(await listing.json());
    const candidates = [];
    for (let start = 0; start < ids.length; start += DETAIL_CONCURRENCY) {
        const batch = ids.slice(start, start + DETAIL_CONCURRENCY);
        const details = await Promise.all(batch.map(async (id) => {
            try {
                const body = await postJson(`${base}/show`, { model: id }, headers, deps, signal, timeoutMs);
                return decodeShowResponse(id, body);
            }
            catch (error) {
                if (signal?.aborted === true)
                    throw error;
                return undefined;
            }
        }));
        for (const [index, entry] of details.entries()) {
            const id = batch[index];
            if (id === undefined || entry === undefined)
                continue;
            candidates.push(toDiscoveredModel(entry, id));
        }
    }
    return candidates;
}
//# sourceMappingURL=discovery.js.map