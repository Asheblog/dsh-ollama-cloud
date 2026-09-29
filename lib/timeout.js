/**
 * Per-attempt request budgets shared by the non-chat Ollama calls.
 *
 * Discovery and the web capabilities each run one HTTP attempt at a time, with
 * a provider-side budget that must not outlive the attempt and must combine
 * with the caller's own cancellation. Both need the same two facts: the signal
 * to hand `fetch`, and whether the budget (rather than the caller) is what
 * ended the attempt — the difference between a retryable timeout and an
 * abort the caller asked for.
 *
 * @module dsh-ollama-cloud/timeout
 */
/**
 * Combine caller cancellation with one provider-side attempt budget.
 * @param callerSignal - the caller's cancellation, when any.
 * @param timeoutMs - this attempt's budget in milliseconds.
 * @returns the signal to hand `fetch`, and the budget's own verdict.
 */
export function attemptSignal(callerSignal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return {
        signal: callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]),
        timedOut: () => timeout.aborted,
    };
}
//# sourceMappingURL=timeout.js.map