/**
 * Ollama web capabilities behind the harness `ctx.web` seam.
 *
 * `POST /api/web_search` and `POST /api/web_fetch` are independent of the chat
 * protocol — they are Ollama-native endpoints, so they keep using the native
 * base URL and the same credential reference the chat route resolves. Both
 * requests carry the credential, so redirects fail closed (`redirect: 'error'`)
 * rather than forwarding the bearer token to another host, and a transient
 * pre-response failure is retried once per attempt budget.
 *
 * Registering these providers changes no deployment policy: a profile selects
 * them explicitly (`web: { searchProvider: ollama-cloud }`).
 *
 * @module dsh-ollama-cloud/web
 */
import { attributionHeaders } from '@deepseek-ai/dsh-llm';
import { WebError, } from '@deepseek-ai/dsh-web';
/** Stable id both providers register under; one backend serves both capabilities. */
export const OLLAMA_WEB_PROVIDER_ID = 'ollama-cloud';
/** `/api/web_search` accepts at most ten results per call. */
export const MAX_SEARCH_RESULTS = 10;
/** Default per-attempt budget for one Ollama web request. */
export const DEFAULT_WEB_REQUEST_TIMEOUT_MS = 15000;
/** Error code for a provider-side attempt budget expiry; retried once. */
export const OLLAMA_WEB_TIMEOUT = 'OLLAMA_WEB_TIMEOUT';
/** Error code for a retryable transport failure before an HTTP response arrives. */
export const OLLAMA_WEB_TRANSPORT = 'OLLAMA_WEB_TRANSPORT';
/** Error code for a request that resolved no credential. */
export const OLLAMA_WEB_MISSING_CREDENTIAL = 'OLLAMA_WEB_MISSING_CREDENTIAL';
/**
 * Decode one `/api/web_search` reply into the seam's portable result shape.
 * Entries without a usable URL are dropped: a source must be citeable.
 * @param body - parsed response body.
 * @returns sources plus the seam-owned truncation flag.
 */
export function decodeSearchResponse(body) {
    const results = body?.results;
    if (!Array.isArray(results)) {
        throw new WebError('ollama-cloud web search answered without a "results" array', 'OLLAMA_WEB_BAD_REPLY');
    }
    const sources = [];
    for (const entry of results) {
        if (entry === null || typeof entry !== 'object')
            continue;
        const record = entry;
        if (typeof record.url !== 'string' || record.url.length === 0)
            continue;
        sources.push({
            url: record.url,
            ...typeof record.title === 'string' && record.title.length > 0 ? { title: record.title } : {},
            ...typeof record.content === 'string' && record.content.length > 0 ? { snippet: record.content } : {},
        });
    }
    return { sources, truncated: false };
}
/**
 * Decode one `/api/web_fetch` reply; Ollama returns extracted text rather than
 * raw HTML, so the body is always the text arm.
 * @param body - parsed response body.
 * @returns the extracted page text.
 */
export function decodeFetchResponse(body) {
    const content = body?.content;
    if (typeof content !== 'string') {
        throw new WebError('ollama-cloud web fetch answered without text "content"', 'OLLAMA_WEB_BAD_REPLY');
    }
    return content;
}
/** Whether a fetch rejection names the redirect policy rather than a transport failure. */
function isRedirectFailure(error) {
    let current = error;
    while (current instanceof Error) {
        if (/redirect/i.test(current.message))
            return true;
        current = current.cause;
    }
    return false;
}
/** POST one credentialed JSON call and decode the reply, retrying one transient failure. */
async function postJson(options, suffix, payload, signal) {
    const url = `${options.baseURL().replace(/\/+$/, '')}${suffix}`;
    const apiKey = await options.resolveApiKey();
    if (apiKey === undefined) {
        throw new WebError('ollama-cloud web capabilities need an API key; configure the credential reference through plugin settings', OLLAMA_WEB_MISSING_CREDENTIAL);
    }
    try {
        return await postJsonAttempt(options, url, apiKey, payload, signal);
    }
    catch (error) {
        const retryable = error instanceof WebError
            && (error.code === OLLAMA_WEB_TIMEOUT || error.code === OLLAMA_WEB_TRANSPORT);
        if (!retryable || signal?.aborted === true)
            throw error;
    }
    return postJsonAttempt(options, url, apiKey, payload, signal);
}
/** One attempt: fresh timeout budget, credential, attribution, no redirects. */
async function postJsonAttempt(options, url, apiKey, payload, callerSignal) {
    const fetchImpl = options.fetch ?? fetch;
    const timeoutMs = options.requestTimeoutMs?.() ?? DEFAULT_WEB_REQUEST_TIMEOUT_MS;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]);
    let response;
    try {
        response = await fetchImpl(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                authorization: `Bearer ${apiKey}`,
                ...(options.attribution ?? attributionHeaders)(),
            },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal,
        });
    }
    catch (error) {
        if (callerSignal?.aborted === true) {
            throw new WebError('ollama-cloud web request aborted by caller', 'ABORTED', { cause: error });
        }
        if (timeout.aborted) {
            throw new WebError(`ollama-cloud web request timed out after ${timeoutMs}ms`, OLLAMA_WEB_TIMEOUT, { cause: error });
        }
        if (isRedirectFailure(error)) {
            throw new WebError(`${url} attempted a redirect`, 'WEB_PROVIDER_ERROR', { cause: error });
        }
        const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : '';
        throw new WebError(`could not reach ${url}${detail}`, OLLAMA_WEB_TRANSPORT, { cause: error });
    }
    if (!response.ok) {
        await response.body?.cancel();
        const hint = response.status === 401 || response.status === 403 ? '; check the API key' : '';
        throw new WebError(`${url} answered ${response.status}${hint}`, 'WEB_PROVIDER_ERROR');
    }
    try {
        return { status: response.status, body: await response.json() };
    }
    catch (error) {
        throw new WebError(`${url} did not answer with JSON`, 'OLLAMA_WEB_BAD_REPLY', { cause: error });
    }
}
/** Ollama Cloud search provider; redirects fail as `WEB_PROVIDER_ERROR`. */
export class OllamaWebSearchProvider {
    options;
    id = OLLAMA_WEB_PROVIDER_ID;
    /** @param options - caller-owned resolution hooks. */
    constructor(options) {
        this.options = options;
    }
    /** @returns whether the configured base URL is parseable. */
    available() {
        return URL.canParse(this.options.baseURL());
    }
    /**
     * Run one search through `/api/web_search`.
     * @param request - query and optional result bound.
     * @param signal - caller cancellation, forwarded to the attempt.
     * @returns decoded sources.
     */
    async search(request, signal) {
        const { body } = await postJson(this.options, '/web_search', {
            query: request.query,
            ...request.maxResults === undefined ? {} : { max_results: Math.min(request.maxResults, MAX_SEARCH_RESULTS) },
        }, signal);
        return decodeSearchResponse(body);
    }
}
/** Ollama Cloud fetch provider; redirects fail as `WEB_PROVIDER_ERROR`. */
export class OllamaWebFetchProvider {
    options;
    id = OLLAMA_WEB_PROVIDER_ID;
    /** @param options - caller-owned resolution hooks. */
    constructor(options) {
        this.options = options;
    }
    /** @returns whether the configured base URL is parseable. */
    available() {
        return URL.canParse(this.options.baseURL());
    }
    /**
     * Retrieve one URL through `/api/web_fetch`.
     * @param request - the URL to fetch.
     * @param signal - caller cancellation, forwarded to the attempt.
     * @returns the extracted text body.
     */
    async fetch(request, signal) {
        const { status, body } = await postJson(this.options, '/web_fetch', { url: request.url }, signal);
        return {
            url: request.url,
            statusCode: status,
            body: { kind: 'text', content: decodeFetchResponse(body) },
            truncated: false,
        };
    }
}
//# sourceMappingURL=web.js.map