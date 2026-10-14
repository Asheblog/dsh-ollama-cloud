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

import { attemptSignal } from './timeout.js'

/** Billing windows the endpoint reports, in the order selectors should show them. */
export const USAGE_WINDOW_IDS = ['monthly', 'session', 'weekly'] as const

/** One reporting period. */
export type UsageWindowId = (typeof USAGE_WINDOW_IDS)[number]

/** Allowance path on the native base; cloud-only, and a 404 on a local server. */
export const BALANCE_PATH = '/balance'

/** Largest usage reply this plugin reads; anything bigger is not an allowance snapshot. */
export const USAGE_MAX_BYTES = 1048576

/** Default per-attempt budget for a usage read, matching the other non-chat requests. */
export const DEFAULT_USAGE_TIMEOUT_MS = 15000

/**
 * Delay before the one retry a transient failure earns.
 *
 * Short on purpose: what this exists for is an upstream — or a proxy in front
 * of it — hiccup, and the panel is a background read, so the cost of waiting is
 * paid by an element nobody is staring at.
 */
export const RETRY_DELAY_MS = 500

/** The endpoint has no usage surface (a local or self-hosted server). */
export const USAGE_UNSUPPORTED = 'OLLAMA_USAGE_UNSUPPORTED'

/** The endpoint answered, but not with a usable allowance snapshot. */
export const USAGE_FAILED = 'OLLAMA_USAGE_FAILED'

/** One billing window's consumed fraction. */
export interface OllamaUsageWindow {
  /** Reporting period this window covers. */
  readonly id: UsageWindowId
  /** Consumed fraction of the allowance; `0.891` renders as `89.1%`. */
  readonly usedFraction: number
  /** Absolute instant the window resets, when the endpoint disclosed one. */
  readonly resetsAt?: string
}

/** One decoded allowance snapshot. */
export interface OllamaUsageSnapshot {
  /** When this plugin read the endpoint. */
  readonly fetchedAt: string
  /** Windows the endpoint reported, in {@link USAGE_WINDOW_IDS} order. */
  readonly windows: readonly OllamaUsageWindow[]
}

/** Typed usage failure carrying a stable machine code. */
export class UsageError extends Error {
  /**
   * @param message - human-readable failure summary.
   * @param code - stable machine code from this module or the harness taxonomy.
   * @param options - optional cause, and whether the failure was transient.
   */
  constructor(message: string, code: string, options?: ErrorOptions & { retryable?: boolean }) {
    super(message, options)
    this.name = 'UsageError'
    this.code = code
    this.retryable = options?.retryable === true
  }

  /** Stable machine code: {@link USAGE_UNSUPPORTED}, {@link USAGE_FAILED}, `INVALID_CREDENTIAL`, `ABORTED`. */
  readonly code: string

  /**
   * Whether the failure was transient: a socket that reset, a rate limit, a 5xx
   * from the endpoint or from something in front of it. One more attempt at
   * that moment could have succeeded; everything else — a refused credential, a
   * body this build cannot read — would fail identically.
   */
  readonly retryable: boolean
}

/** Whether `value` is a plain object usable as a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Turn one `remaining_percent` reading into the consumed fraction the panel
 * meters.
 *
 * The endpoint reports what is left and the panel meters what was spent, so
 * the two are complements. A reading is a percentage with two decimals, and
 * the complement of one is not exact in binary floating point — `95.55` leaves
 * `0.04449999999999996` — so it is rounded to six decimals, which keeps the
 * number the endpoint meant on the wire and at the panel's own rounding to a
 * tenth. A reading outside the range is clamped rather than dropped: an
 * overshoot is an artefact of a percentage, not a missing window, and blanking
 * a panel over `100.4%` would hide a reading that is fine.
 *
 * @param remainingPercent - the window's remaining allowance, as reported.
 * @returns the consumed fraction, in `0..1`.
 */
function consumedFraction(remainingPercent: number): number {
  const clamped = Math.min(100, Math.max(0, remainingPercent))
  return Math.round(((100 - clamped) / 100) * 1e6) / 1e6
}

/**
 * Read the window's reset instant, normalized to ISO.
 *
 * An instant the panel cannot read is *no* instant rather than a failure: the
 * panel then falls back to the cadence it documents for that window, which is
 * a worse label than the endpoint's own but never a wrong one.
 */
function readResetInstant(window: Record<string, unknown>): string | undefined {
  const raw = window.resets_at
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

/** Decode one window, or `undefined` when it is not a usable window. */
function decodeWindow(id: UsageWindowId, value: unknown): OllamaUsageWindow | undefined {
  if (!isRecord(value)) return undefined
  const remaining = value.remaining_percent
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return undefined
  const resetsAt = readResetInstant(value)
  return {
    id,
    usedFraction: consumedFraction(remaining),
    ...resetsAt === undefined ? {} : { resetsAt },
  }
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
export function decodeBalanceResponse(body: unknown, url: string, now: number): OllamaUsageSnapshot {
  const included = isRecord(body) ? body.included : undefined
  if (!isRecord(included)) {
    const keys = isRecord(body) ? Object.keys(body).join(', ') : typeof body
    throw new UsageError(`${url} returned a malformed usage response (body keys: ${keys})`, USAGE_FAILED)
  }
  const windows: OllamaUsageWindow[] = []
  for (const id of USAGE_WINDOW_IDS) {
    const window = decodeWindow(id, included[id])
    if (window !== undefined) windows.push(window)
  }
  if (windows.length === 0) {
    throw new UsageError(
      `${url} returned a malformed usage response (included keys: ${Object.keys(included).join(', ')})`,
      USAGE_FAILED,
    )
  }
  return { fetchedAt: new Date(now).toISOString(), windows }
}

/** Endpoint and credential for one usage read. */
export interface UsageTarget {
  /** Native Ollama API base, e.g. `https://ollama.com/api`. */
  readonly baseURL: string
  /** Credential for this read, when one resolved. */
  readonly apiKey?: string
  /** Per-attempt budget in milliseconds. */
  readonly requestTimeoutMs?: number
}

/** Injectable effects so tests can drive a read without a network. */
export interface UsageDeps {
  /** Fetch implementation; defaults to the global one. */
  readonly fetch: typeof fetch
  /** Harness attribution headers; defaults to none. */
  readonly attribution?: () => Record<string, string>
}

/**
 * Whether a refusal status is worth one more attempt: 429 is a rate limit, and
 * a 5xx is the endpoint — or a proxy in front of it — being briefly unwell.
 * Every other status is an answer that will not change (a refused credential, a
 * surface this endpoint does not have).
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * One attempt at the read.
 * @param target - endpoint and credential for this read.
 * @param deps - injectable fetch and attribution headers.
 * @param signal - caller cancellation.
 * @returns the decoded snapshot.
 * @throws {UsageError} {@link USAGE_UNSUPPORTED} on 404, `INVALID_CREDENTIAL`
 *   on 401/403, {@link USAGE_FAILED} for any other failure, `ABORTED` when the
 *   caller cancelled. A transient failure is marked `retryable`.
 */
async function readUsageAttempt(
  target: UsageTarget,
  deps: UsageDeps,
  signal?: AbortSignal,
): Promise<OllamaUsageSnapshot> {
  const base = target.baseURL.trim().replace(/\/+$/, '')
  const url = `${base}${BALANCE_PATH}`
  const attempt = attemptSignal(signal, target.requestTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS)

  let response: Response
  try {
    response = await deps.fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...deps.attribution?.() ?? {},
        ...target.apiKey === undefined ? {} : { authorization: `Bearer ${target.apiKey}` },
      },
      redirect: 'error',
      signal: attempt.signal,
    })
  } catch (error) {
    if (signal?.aborted === true) {
      throw new UsageError('Ollama Cloud usage read aborted by caller', 'ABORTED', { cause: error })
    }
    if (attempt.timedOut()) {
      // Deliberately not retryable: this attempt already spent the whole
      // budget, and retrying a slow upstream doubles the time the user watches
      // a spinner with nothing to suggest the answer would differ.
      throw new UsageError(
        `Ollama Cloud usage read timed out after ${target.requestTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS}ms`,
        USAGE_FAILED,
        { cause: error },
      )
    }
    const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : ''
    throw new UsageError(`could not reach ${url}${detail}`, USAGE_FAILED, { cause: error, retryable: true })
  }

  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 404) {
      throw new UsageError('this Ollama endpoint does not report cloud usage', USAGE_UNSUPPORTED)
    }
    if (response.status === 401 || response.status === 403) {
      throw new UsageError(`${url} answered ${response.status}; check the API key`, 'INVALID_CREDENTIAL')
    }
    throw new UsageError(`${url} answered ${response.status}`, USAGE_FAILED, {
      retryable: isTransientStatus(response.status),
    })
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > USAGE_MAX_BYTES) {
    await response.body?.cancel()
    throw new UsageError(`${url} answered ${declaredLength} bytes, over the usage budget`, USAGE_FAILED)
  }

  let text: string
  try {
    text = await response.text()
  } catch (error) {
    throw new UsageError(`could not read the usage reply from ${url}`, USAGE_FAILED, { cause: error })
  }
  if (text.length > USAGE_MAX_BYTES) {
    throw new UsageError(`${url} answered more than ${USAGE_MAX_BYTES} characters`, USAGE_FAILED)
  }

  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch (error) {
    throw new UsageError(`${url} did not answer with JSON`, USAGE_FAILED, { cause: error })
  }
  return decodeBalanceResponse(body, url, Date.now())
}

/**
 * Whether the caller has cancelled.
 *
 * Read through a function on purpose: TypeScript's control-flow narrowing keeps
 * believing what a first `signal.aborted` check concluded, even across an
 * `await` — and across an `await` is exactly when the answer changes.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
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
export async function readUsage(
  target: UsageTarget,
  deps: UsageDeps,
  signal?: AbortSignal,
): Promise<OllamaUsageSnapshot> {
  try {
    return await readUsageAttempt(target, deps, signal)
  } catch (error) {
    if (!(error instanceof UsageError) || !error.retryable || isAborted(signal)) throw error
    await new Promise<void>((resolve) => {
      setTimeout(resolve, RETRY_DELAY_MS)
    })
    // The caller may have given up while this attempt waited.
    if (isAborted(signal)) throw error
    return await readUsageAttempt(target, deps, signal)
  }
}
