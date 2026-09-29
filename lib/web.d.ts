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
import { type WebFetchProvider, type WebFetchRequest, type WebFetchResult, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web';
/** Stable id both providers register under; one backend serves both capabilities. */
export declare const OLLAMA_WEB_PROVIDER_ID = "ollama-cloud";
/** `/api/web_search` accepts at most ten results per call. */
export declare const MAX_SEARCH_RESULTS = 10;
/** Error code for a provider-side attempt budget expiry; retried once. */
export declare const OLLAMA_WEB_TIMEOUT = "OLLAMA_WEB_TIMEOUT";
/** Error code for a retryable transport failure before an HTTP response arrives. */
export declare const OLLAMA_WEB_TRANSPORT = "OLLAMA_WEB_TRANSPORT";
/** Error code for a request that resolved no credential. */
export declare const OLLAMA_WEB_MISSING_CREDENTIAL = "OLLAMA_WEB_MISSING_CREDENTIAL";
/** Caller-owned facts both providers resolve per operation. */
export interface OllamaWebProviderOptions {
    /** Native Ollama API base; resolved per operation so settings changes land. */
    baseURL: () => string;
    /** Credential for one request; `undefined` means the request cannot run. */
    resolveApiKey: () => Promise<string | undefined>;
    /** Per-attempt budget in milliseconds; defaults to the configured `requestTimeoutMs`. */
    requestTimeoutMs?: () => number;
    /** Fetch implementation, injectable for tests. */
    fetch?: typeof fetch;
    /** Attribution headers, injectable for tests. */
    attribution?: () => Record<string, string>;
}
/**
 * Decode one `/api/web_search` reply into the seam's portable result shape.
 * Entries without a usable URL are dropped: a source must be citeable.
 * @param body - parsed response body.
 * @returns sources plus the seam-owned truncation flag.
 */
export declare function decodeSearchResponse(body: unknown): WebSearchResult;
/**
 * Decode one `/api/web_fetch` reply; Ollama returns extracted text rather than
 * raw HTML, so the body is always the text arm.
 * @param body - parsed response body.
 * @returns the extracted page text.
 */
export declare function decodeFetchResponse(body: unknown): string;
/**
 * Shared shape of the two Ollama web providers: one backend id, one
 * caller-owned options bag, and the same local usability check. Both
 * capabilities are served by the same endpoint, so the id and the check are
 * facts about the backend, not about search or fetch separately.
 */
declare abstract class OllamaWebEndpoint {
    protected readonly options: OllamaWebProviderOptions;
    /** Stable provider id both capabilities register under. */
    readonly id = "ollama-cloud";
    /**
     * @param options - caller-owned resolution hooks.
     *   Public because the two concrete providers inherit it; the class itself is
     *   abstract and never constructed.
     */
    constructor(options: OllamaWebProviderOptions);
    /** @returns whether the configured base URL is parseable. */
    available(): boolean;
}
/** Ollama Cloud search provider; redirects fail as `WEB_PROVIDER_ERROR`. */
export declare class OllamaWebSearchProvider extends OllamaWebEndpoint implements WebSearchProvider {
    /**
     * Run one search through `/api/web_search`.
     * @param request - query and optional result bound.
     * @param signal - caller cancellation, forwarded to the attempt.
     * @returns decoded sources.
     */
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
/** Ollama Cloud fetch provider; redirects fail as `WEB_PROVIDER_ERROR`. */
export declare class OllamaWebFetchProvider extends OllamaWebEndpoint implements WebFetchProvider {
    /**
     * Retrieve one URL through `/api/web_fetch`.
     * @param request - the URL to fetch.
     * @param signal - caller cancellation, forwarded to the attempt.
     * @returns the extracted text body.
     */
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
}
export {};
//# sourceMappingURL=web.d.ts.map