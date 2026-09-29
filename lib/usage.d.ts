/**
 * Ollama Cloud account usage behind the `usage/read` RPC endpoint.
 *
 * `GET <native base>/usage` reports, per billing window, the consumed fraction
 * of the account's allowance plus the request counts of the models that spent
 * it. That endpoint is cloud-only: a local Ollama server answers 404, which is
 * a supported answer here — "this endpoint does not report cloud usage" — and
 * never an error. The credential is resolved per read and never reaches the
 * browser; the client half only ever sees the decoded snapshot.
 *
 * @module dsh-ollama-cloud/usage
 */
/** Billing windows the endpoint reports, in the order selectors should show them. */
export declare const USAGE_WINDOW_IDS: readonly ["monthly", "session", "weekly"];
/** One reporting period. */
export type UsageWindowId = (typeof USAGE_WINDOW_IDS)[number];
/** Largest usage reply this plugin reads; anything bigger is not a usage snapshot. */
export declare const USAGE_MAX_BYTES = 1048576;
/** Default per-attempt budget for a usage read, matching the other non-chat requests. */
export declare const DEFAULT_USAGE_TIMEOUT_MS = 15000;
/** The endpoint has no usage surface (a local or self-hosted server). */
export declare const USAGE_UNSUPPORTED = "OLLAMA_USAGE_UNSUPPORTED";
/** The endpoint answered, but not with a usable usage snapshot. */
export declare const USAGE_FAILED = "OLLAMA_USAGE_FAILED";
/** One model's request count inside a window. */
export interface OllamaUsageModelCount {
    /** Provider-side model label, for example `web search` or a model id. */
    readonly name: string;
    /** Requests this model made inside the window. */
    readonly requestCount: number;
}
/** One billing window's consumed fraction. */
export interface OllamaUsageWindow {
    /** Reporting period this window covers. */
    readonly id: UsageWindowId;
    /** Consumed fraction of the allowance; `0.891` renders as `89.1%`. */
    readonly usedFraction: number;
    /** Models that spent the window, as the endpoint labelled them. */
    readonly models: readonly OllamaUsageModelCount[];
    /** Absolute instant the window resets, when the endpoint disclosed one. */
    readonly resetsAt?: string;
}
/** One decoded usage snapshot. */
export interface OllamaUsageSnapshot {
    /** When this plugin read the endpoint. */
    readonly fetchedAt: string;
    /** Windows the endpoint reported, in {@link USAGE_WINDOW_IDS} order. */
    readonly windows: readonly OllamaUsageWindow[];
}
/** Typed usage failure carrying a stable machine code. */
export declare class UsageError extends Error {
    /**
     * @param message - human-readable failure summary.
     * @param code - stable machine code from this module or the harness taxonomy.
     * @param options - optional cause.
     */
    constructor(message: string, code: string, options?: ErrorOptions);
    /** Stable machine code: {@link USAGE_UNSUPPORTED}, {@link USAGE_FAILED}, `INVALID_CREDENTIAL`, `ABORTED`. */
    readonly code: string;
}
/**
 * Decode one `/usage` response body.
 *
 * A window whose `usage` is not a finite non-negative number is dropped, and a
 * single malformed model entry is skipped, because one odd row must not sink
 * the whole panel. A body that yields no window at all is malformed.
 *
 * @param body - parsed response body.
 * @param url - endpoint the body came from, for diagnostics.
 * @param now - instant used to turn relative resets into absolute ones.
 * @returns the decoded snapshot.
 * @throws {UsageError} {@link USAGE_FAILED} when no window could be decoded.
 */
export declare function decodeUsageResponse(body: unknown, url: string, now: number): OllamaUsageSnapshot;
/** Endpoint and credential for one usage read. */
export interface UsageTarget {
    /** Native Ollama API base, e.g. `https://ollama.com/api`. */
    readonly baseURL: string;
    /** Credential for this read, when one resolved. */
    readonly apiKey?: string;
    /** Per-attempt budget in milliseconds. */
    readonly requestTimeoutMs?: number;
}
/** Injectable effects so tests can drive a read without a network. */
export interface UsageDeps {
    /** Fetch implementation; defaults to the global one. */
    readonly fetch: typeof fetch;
    /** Harness attribution headers; defaults to none. */
    readonly attribution?: () => Record<string, string>;
}
/**
 * Read one usage snapshot from the endpoint.
 * @param target - endpoint and credential for this read.
 * @param deps - injectable fetch and attribution headers.
 * @param signal - caller cancellation.
 * @returns the decoded snapshot.
 * @throws {UsageError} {@link USAGE_UNSUPPORTED} on 404, `INVALID_CREDENTIAL`
 *   on 401/403, {@link USAGE_FAILED} for any other failure, `ABORTED` when the
 *   caller cancelled.
 */
export declare function readUsage(target: UsageTarget, deps: UsageDeps, signal?: AbortSignal): Promise<OllamaUsageSnapshot>;
//# sourceMappingURL=usage.d.ts.map