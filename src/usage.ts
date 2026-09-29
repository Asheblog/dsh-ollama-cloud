/**
 * Ollama Cloud account usage behind the `usage/read` RPC endpoint.
 *
 * The internal snapshot this module decodes is projected onto the browser's
 * wire shape (`WireUsageSnapshot`, windows keyed by id) in `rpc.ts`, which is
 * what the ecosystem's Ollama usage readers already decode.
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

import { attemptSignal } from './timeout.js'

/** Billing windows the endpoint reports, in the order selectors should show them. */
export const USAGE_WINDOW_IDS = ['monthly', 'session', 'weekly'] as const

/** One reporting period. */
export type UsageWindowId = (typeof USAGE_WINDOW_IDS)[number]

/** Largest usage reply this plugin reads; anything bigger is not a usage snapshot. */
export const USAGE_MAX_BYTES = 1048576

/** Default per-attempt budget for a usage read, matching the other non-chat requests. */
export const DEFAULT_USAGE_TIMEOUT_MS = 15000

/**
 * Below this magnitude an epoch number is read as seconds rather than
 * milliseconds (`0xe8d4a51000` is 1e12, and every millisecond instant for a
 * plausible date exceeds it while every second instant is far below).
 */
const MILLISECOND_EPOCH_FLOOR = 0xe8d4a51000

/** The endpoint has no usage surface (a local or self-hosted server). */
export const USAGE_UNSUPPORTED = 'OLLAMA_USAGE_UNSUPPORTED'

/** The endpoint answered, but not with a usable usage snapshot. */
export const USAGE_FAILED = 'OLLAMA_USAGE_FAILED'

/** One model's request count inside a window. */
export interface OllamaUsageModelCount {
  /** Provider-side model label, for example `web search` or a model id. */
  readonly name: string
  /** Requests this model made inside the window. */
  readonly requestCount: number
}

/** One billing window's consumed fraction. */
export interface OllamaUsageWindow {
  /** Reporting period this window covers. */
  readonly id: UsageWindowId
  /** Consumed fraction of the allowance; `0.891` renders as `89.1%`. */
  readonly usedFraction: number
  /** Models that spent the window, as the endpoint labelled them. */
  readonly models: readonly OllamaUsageModelCount[]
  /** Absolute instant the window resets, when the endpoint disclosed one. */
  readonly resetsAt?: string
}

/** One decoded usage snapshot. */
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
   * @param options - optional cause.
   */
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UsageError'
    this.code = code
  }

  /** Stable machine code: {@link USAGE_UNSUPPORTED}, {@link USAGE_FAILED}, `INVALID_CREDENTIAL`, `ABORTED`. */
  readonly code: string
}

/** Whether `value` is a plain object usable as a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Read the first present reset instant under any spelling the endpoint has used. */
function readResetInstant(window: Record<string, unknown>, now: number): string | undefined {
  const raw = window.resets_at ?? window.reset_at ?? window.reset ?? window.resetsAt
  if (typeof raw === 'string' && raw.length > 0) {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  } else if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    // Epoch seconds and milliseconds are told apart by magnitude: a
    // millisecond instant for any plausible date exceeds the second range.
    const milliseconds = raw < MILLISECOND_EPOCH_FLOOR ? raw * 1000 : raw
    return new Date(milliseconds).toISOString()
  }
  const after = window.reset_after_seconds ?? window.resetAfterSeconds
  if (typeof after === 'number' && Number.isFinite(after) && after >= 0) {
    return new Date(now + after * 1000).toISOString()
  }
  return undefined
}

/** Read the model request counts, skipping entries the panel cannot trust. */
function readModelCounts(window: Record<string, unknown>): OllamaUsageModelCount[] {
  const models = window.models
  if (!Array.isArray(models)) return []
  const counts: OllamaUsageModelCount[] = []
  for (const entry of models) {
    if (!isRecord(entry)) continue
    const name = entry.name
    const requestCount = entry.request_count
    if (typeof name !== 'string' || name.length === 0) continue
    if (typeof requestCount !== 'number' || !Number.isSafeInteger(requestCount) || requestCount < 0) continue
    counts.push({ name, requestCount })
  }
  return counts
}

/** Decode one window, or `undefined` when it is not a usable window. */
function decodeWindow(id: UsageWindowId, value: unknown, now: number): OllamaUsageWindow | undefined {
  if (!isRecord(value)) return undefined
  const usage = value.usage
  if (typeof usage !== 'number' || !Number.isFinite(usage) || usage < 0) return undefined
  const resetsAt = readResetInstant(value, now)
  return {
    id,
    usedFraction: usage,
    models: readModelCounts(value),
    ...resetsAt === undefined ? {} : { resetsAt },
  }
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
export function decodeUsageResponse(body: unknown, url: string, now: number): OllamaUsageSnapshot {
  const limits = isRecord(body) ? body.limits : undefined
  if (!isRecord(limits)) {
    const keys = isRecord(body) ? Object.keys(body).join(', ') : typeof body
    throw new UsageError(`${url} returned a malformed usage response (body keys: ${keys})`, USAGE_FAILED)
  }
  const windows: OllamaUsageWindow[] = []
  for (const id of USAGE_WINDOW_IDS) {
    const window = decodeWindow(id, limits[id], now)
    if (window !== undefined) windows.push(window)
  }
  if (windows.length === 0) {
    throw new UsageError(
      `${url} returned a malformed usage response (limits keys: ${Object.keys(limits).join(', ')})`,
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
 * Read one usage snapshot from the endpoint.
 * @param target - endpoint and credential for this read.
 * @param deps - injectable fetch and attribution headers.
 * @param signal - caller cancellation.
 * @returns the decoded snapshot.
 * @throws {UsageError} {@link USAGE_UNSUPPORTED} on 404, `INVALID_CREDENTIAL`
 *   on 401/403, {@link USAGE_FAILED} for any other failure, `ABORTED` when the
 *   caller cancelled.
 */
export async function readUsage(
  target: UsageTarget,
  deps: UsageDeps,
  signal?: AbortSignal,
): Promise<OllamaUsageSnapshot> {
  const base = target.baseURL.trim().replace(/\/+$/, '')
  const url = `${base}/usage`
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
      throw new UsageError(
        `Ollama Cloud usage read timed out after ${target.requestTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS}ms`,
        USAGE_FAILED,
        { cause: error },
      )
    }
    const detail = error instanceof Error && error.message.length > 0 ? `: ${error.message}` : ''
    throw new UsageError(`could not reach ${url}${detail}`, USAGE_FAILED, { cause: error })
  }

  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 404) {
      throw new UsageError('this Ollama endpoint does not report cloud usage', USAGE_UNSUPPORTED)
    }
    if (response.status === 401 || response.status === 403) {
      throw new UsageError(`${url} answered ${response.status}; check the API key`, 'INVALID_CREDENTIAL')
    }
    throw new UsageError(`${url} answered ${response.status}`, USAGE_FAILED)
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
  return decodeUsageResponse(body, url, Date.now())
}
