/**
 * Ollama Cloud account allowance behind the `usage/read` RPC endpoint.
 *
 * `GET <native base>/balance` reports, per included billing window, how much of
 * that window's allowance is *left* (`remaining_percent`, 0–100), when the
 * window resets (`resets_at`), and the purchased balance behind the allowance
 * (`purchased.balance_usd`). The endpoint is cloud-only and credentialed: a
 * local Ollama server answers 404, which is a supported answer here — "this
 * endpoint does not report cloud usage" — and never an error.
 *
 * Ollama also documents `GET /api/usage`, which is a different surface: a
 * request/token/cost time series per range (`24h`/`7d`/`30d`), with no
 * allowance and no per-model breakdown. This module deliberately does not read
 * it — the panel meters an allowance, and `/balance` is what reports one.
 *
 * The internal snapshot this module decodes is projected onto the browser's
 * wire shape (`WireUsageSnapshot`, windows keyed by id) in `rpc.ts`, which is
 * what the ecosystem's Ollama usage readers already decode. The credential is
 * resolved per read and never reaches the browser; the client half only ever
 * sees the decoded snapshot.
 *
 * A read retries once when the failure was transient (a reset socket, a rate
 * limit, a 5xx from the endpoint or from something in front of it) and reports
 * everything else immediately, because the panel has a cadence and a failure it
 * keeps showing until the next poll is worse than a moment's delay.
 *
 * The module, its error codes, and the `usage/read` endpoint it answers keep
 * the `usage` vocabulary on purpose: that is the channel contract an ecosystem
 * of provider UIs already calls (ADR 0003). What moved is which endpoint behind
 * it reports the number — `/balance`, not `/usage` — and that is the only
 * difference a reader has to know about.
 *
 * @module dsh-ollama-cloud/usage
 */
/** Billing windows the endpoint reports, in the order selectors should show them. */
export declare const USAGE_WINDOW_IDS: readonly ["monthly", "session", "weekly"];
/** One reporting period. */
export type UsageWindowId = (typeof USAGE_WINDOW_IDS)[number];
/** Allowance path on the native base; cloud-only, and a 404 on a local server. */
export declare const BALANCE_PATH = "/balance";
/** Largest usage reply this plugin reads; anything bigger is not an allowance snapshot. */
export declare const USAGE_MAX_BYTES = 1048576;
/** Default per-attempt budget for a usage read, matching the other non-chat requests. */
export declare const DEFAULT_USAGE_TIMEOUT_MS = 15000;
/**
 * Delay before the one retry a transient failure earns.
 *
 * Short on purpose: what this exists for is an upstream — or a proxy in front
 * of it — hiccup, and the panel is a background read, so the cost of waiting is
 * paid by an element nobody is staring at.
 */
export declare const RETRY_DELAY_MS = 500;
/** The endpoint has no usage surface (a local or self-hosted server). */
export declare const USAGE_UNSUPPORTED = "OLLAMA_USAGE_UNSUPPORTED";
/** The endpoint answered, but not with a usable allowance snapshot. */
export declare const USAGE_FAILED = "OLLAMA_USAGE_FAILED";
/** One billing window's consumed fraction. */
export interface OllamaUsageWindow {
    /** Reporting period this window covers. */
    readonly id: UsageWindowId;
    /** Consumed fraction of the allowance; `0.891` renders as `89.1%`. */
    readonly usedFraction: number;
    /** Absolute instant the window resets, when the endpoint disclosed one. */
    readonly resetsAt?: string;
}
/** One decoded allowance snapshot. */
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
     * @param options - optional cause, and whether the failure was transient.
     */
    constructor(message: string, code: string, options?: ErrorOptions & {
        retryable?: boolean;
    });
    /** Stable machine code: {@link USAGE_UNSUPPORTED}, {@link USAGE_FAILED}, `INVALID_CREDENTIAL`, `ABORTED`. */
    readonly code: string;
    /**
     * Whether the failure was transient: a socket that reset, a rate limit, a 5xx
     * from the endpoint or from something in front of it. One more attempt at
     * that moment could have succeeded; everything else — a refused credential, a
     * body this build cannot read — would fail identically.
     */
    readonly retryable: boolean;
}
/**
 * Decode one `/balance` response body.
 *
 * A window whose `remaining_percent` is not a finite number is dropped, and an
 * id this plugin has no seat for is ignored, because one odd row must not sink
 * the whole panel. A body that yields no window at all is malformed — and it
 * names the keys it saw, because "the endpoint changed its shape" is exactly
 * the failure a reader has to be able to diagnose from one line.
 *
 * @param body - parsed response body.
 * @param url - endpoint the body came from, for diagnostics.
 * @param now - instant the read is attributed to.
 * @returns the decoded snapshot.
 * @throws {UsageError} {@link USAGE_FAILED} when no window could be decoded.
 */
export declare function decodeBalanceResponse(body: unknown, url: string, now: number): OllamaUsageSnapshot;
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
 * Read one allowance snapshot, retrying a transient failure once.
 *
 * A read the user can see is a read that has to survive one bad moment: this
 * deployment's own experience is a proxy in front of the endpoint answering a
 * single 502, which turned into a panel reading "unavailable" until its next
 * poll. The retry is deliberately one attempt, and only for the failures that
 * are worth it — see `UsageError.retryable` — because a read that is refused
 * for a reason a retry cannot change should report that reason at once.
 *
 * @param target - endpoint and credential for this read.
 * @param deps - injectable fetch and attribution headers.
 * @param signal - caller cancellation.
 * @returns the decoded snapshot.
 * @throws {UsageError} as {@link readUsageAttempt}, with the second attempt's
 *   own failure when it fails too.
 */
export declare function readUsage(target: UsageTarget, deps: UsageDeps, signal?: AbortSignal): Promise<OllamaUsageSnapshot>;
//# sourceMappingURL=usage.d.ts.map