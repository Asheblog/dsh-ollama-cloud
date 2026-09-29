/**
 * The client-connection RPC surface the browser card reads.
 *
 * The card must never hold the API key, so every credentialed read happens
 * here: `usage/read` resolves the route's credential per call, `credential/set`
 * writes a new one through the harness credentials seam, and
 * `credential/status` answers presence and writability without the value. The
 * channel name, endpoint names, and reply envelopes match what the ecosystem's
 * Ollama provider UIs already call (`/ollama-cloud` + `usage/read`), so an
 * installed provider UI reads this plugin's usage without knowing about it.
 *
 * A failure reply never carries the secret, and the reference a write targets
 * is the configured one — a client cannot redirect a write to another seam
 * entry it names.
 *
 * @module dsh-ollama-cloud/rpc
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm';
import { nativeBaseFrom } from './discovery.js';
import { readUsage, USAGE_UNSUPPORTED, UsageError } from './usage.js';
/** Channel the browser half registers and calls under. */
export const USAGE_RPC_CHANNEL = '/ollama-cloud';
/** Read one usage snapshot. */
export const USAGE_ENDPOINT = 'usage/read';
/** Report whether the route's credential is configured, without its value. */
export const CREDENTIAL_STATUS_ENDPOINT = 'credential/status';
/** Store a credential under the route's configured reference. */
export const CREDENTIAL_SET_ENDPOINT = 'credential/set';
/** Build one failure reply. */
function failure(code, message) {
    return { ok: false, error: { code, message, details: {} } };
}
/** Whether `value` is a plain object usable as a record. */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Decode one optional non-empty string field. */
function optionalString(value) {
    if (value === undefined || value === null)
        return undefined;
    return typeof value === 'string' && value.length > 0 ? value : null;
}
/** Decode a `usage/read` request: draft endpoint and one-shot key, both optional. */
function decodeUsageRequest(payload) {
    if (!isRecord(payload))
        return undefined;
    const baseURL = optionalString(payload.baseURL);
    const apiKey = optionalString(payload.apiKey);
    if (baseURL === null || apiKey === null)
        return undefined;
    return {
        ...baseURL === undefined ? {} : { baseURL },
        ...apiKey === undefined ? {} : { apiKey },
    };
}
/** Decode a `credential/set` request: the value, and an optional reference to confirm. */
function decodeCredentialSetRequest(payload) {
    if (!isRecord(payload))
        return undefined;
    const value = payload.value;
    const ref = optionalString(payload.ref);
    if (typeof value !== 'string' || value.length === 0 || ref === null)
        return undefined;
    return { value, ...ref === undefined ? {} : { ref } };
}
/** Answer `usage/read` for one request. */
async function readUsageReply(options, payload, signal) {
    const request = decodeUsageRequest(payload);
    if (request === undefined)
        return failure('invalid-request', 'invalid Ollama Cloud usage request');
    const facts = options.connection();
    const apiKey = request.apiKey
        ?? (facts.apiKeyEnv === undefined ? undefined : await options.resolveCredential(facts.apiKeyEnv));
    try {
        const usage = await readUsage({
            baseURL: nativeBaseFrom(request.baseURL, facts.nativeBaseURL),
            ...apiKey === undefined ? {} : { apiKey },
            requestTimeoutMs: facts.requestTimeoutMs,
        }, { fetch: options.fetch, attribution: options.attribution }, signal);
        return { ok: true, value: { status: 'ok', usage } };
    }
    catch (error) {
        if (error instanceof UsageError && error.code === USAGE_UNSUPPORTED) {
            return { ok: true, value: { status: 'unsupported' } };
        }
        if (error instanceof UsageError)
            return failure(error.code, error.message);
        throw error;
    }
}
/** Answer `credential/status` for the configured route. */
async function credentialStatusReply(options) {
    const facts = options.connection();
    const reference = facts.apiKeyEnv;
    let configured = false;
    let writable = false;
    const credentials = options.credentials();
    if (reference !== undefined && credentials !== undefined) {
        try {
            const info = await credentials.describe(credentialRef(reference));
            configured = info.configured === true;
            writable = info.writable === true;
        }
        catch {
            // A store that cannot answer leaves both facts false; the environment
            // check below still reports a configured value.
        }
    }
    if (!configured && reference !== undefined) {
        configured = (await options.resolveCredential(credentialRef(reference))) !== undefined;
    }
    return { ok: true, value: { reference, configured, writable } };
}
/** Answer `credential/set` for the configured route. */
async function credentialSetReply(options, payload) {
    const request = decodeCredentialSetRequest(payload);
    if (request === undefined)
        return failure('invalid-request', 'invalid Ollama Cloud credential request');
    const reference = options.connection().apiKeyEnv;
    if (reference === undefined) {
        return failure('invalid-request', 'this route resolves no credential reference; name one in apiKeyEnv before storing a key');
    }
    if (request.ref !== undefined && request.ref !== reference) {
        return failure('invalid-request', `this route stores its credential under "${reference}", not "${request.ref}"`);
    }
    const credentials = options.credentials();
    if (credentials === undefined) {
        return failure('unavailable', 'this deployment has no credentials service; export the reference instead of storing it');
    }
    let key;
    try {
        key = assertUsableApiKey(request.value, 'llm-ollama-cloud', reference);
    }
    catch (error) {
        return failure('INVALID_CREDENTIAL', error instanceof Error ? error.message : 'the key is unusable');
    }
    try {
        await credentials.set(credentialRef(reference), key);
        const info = await credentials.describe(credentialRef(reference));
        return { ok: true, value: { configured: info.configured === true, writable: info.writable === true } };
    }
    catch (error) {
        return failure('internal', error instanceof Error ? error.message : 'storing the credential failed');
    }
}
/**
 * Build the handler for this plugin's RPC channel.
 * @param options - live resolution hooks.
 * @returns the handler to register with `connection.rpc.handle`.
 */
export function createUsageRpcHandler(options) {
    return async (endpoint, payload, signal) => {
        if (endpoint === USAGE_ENDPOINT)
            return readUsageReply(options, payload, signal);
        if (endpoint === CREDENTIAL_STATUS_ENDPOINT)
            return credentialStatusReply(options);
        if (endpoint === CREDENTIAL_SET_ENDPOINT)
            return credentialSetReply(options, payload);
        // The wording matches what provider UIs match on to suggest a host restart.
        return failure('unknown-endpoint', `unknown Ollama Cloud endpoint: ${endpoint}`);
    };
}
//# sourceMappingURL=rpc.js.map