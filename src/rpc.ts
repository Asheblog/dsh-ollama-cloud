/**
 * The client-connection RPC surface the browser card reads.
 *
 * The card must never hold the API key, so every credentialed read happens
 * here: `usage/read` resolves the route's credential per call, `credential/set`
 * writes a new one through the harness credentials seam, and
 * `credential/status` answers presence and writability without the value. The
 * channel and endpoint names follow the convention the ecosystem's Ollama
 * provider plugins used (`/ollama-cloud` + `usage/read`), which keeps one
 * vocabulary across them; the channel is this plugin's own, so no other plugin
 * has to exist for the card to work.
 *
 * A failure reply never carries the secret, and the reference a write targets
 * is the configured one — a client cannot redirect a write to another seam
 * entry it names.
 *
 * @module dsh-ollama-cloud/rpc
 */

import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'

import { PLUGIN_NAME, type ConnectionOptions } from './config.js'
import type { ResolveCredential } from './credentials.js'
import { nativeBaseFrom } from './discovery.js'
import {
  readUsage,
  USAGE_UNSUPPORTED,
  UsageError,
  type OllamaUsageModelCount,
  type OllamaUsageSnapshot,
} from './usage.js'

/** Channel the browser half registers and calls under. */
export const USAGE_RPC_CHANNEL = '/ollama-cloud'

/** Read one usage snapshot. */
export const USAGE_ENDPOINT = 'usage/read'

/** Report whether the route's credential is configured, without its value. */
export const CREDENTIAL_STATUS_ENDPOINT = 'credential/status'

/** Store a credential under the route's configured reference. */
export const CREDENTIAL_SET_ENDPOINT = 'credential/set'

/**
 * Failure reply the connection seam serializes as `{ok:false, error}`.
 * `details` is required by the seam's envelope, so an empty object stands in
 * for "no extra facts"; nothing here ever carries a secret.
 */
export interface RpcFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: Record<string, unknown>
  }
}

/** Success reply the connection seam serializes as `{ok:true, value}`. */
export interface RpcSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** One RPC reply. */
export type RpcReply<T> = RpcSuccess<T> | RpcFailure

/** One window in the wire shape the ecosystem's Ollama usage readers decode. */
export interface WireUsageWindow {
  /** Consumed fraction of the allowance. */
  readonly usage: number
  /** Models that spent the window. */
  readonly models: readonly OllamaUsageModelCount[]
  /** Absolute instant the window resets, when the endpoint disclosed one. */
  readonly resetsAt?: string
}

/**
 * Wire shape of one usage snapshot: windows keyed by id.
 *
 * Provider UIs built for the ecosystem's Ollama plugin decode exactly this
 * (`fetchedAt` plus optional `session`/`weekly`/`monthly` objects), so the
 * channel serves it verbatim rather than this plugin's internal list form.
 */
export interface WireUsageSnapshot {
  /** When the host read the endpoint. */
  readonly fetchedAt: string
  /** Rolling session window, when reported. */
  readonly session?: WireUsageWindow
  /** Rolling weekly window, when reported. */
  readonly weekly?: WireUsageWindow
  /** Monthly window, when reported. */
  readonly monthly?: WireUsageWindow
}

/**
 * Project one internal snapshot onto the wire shape.
 * @param snapshot - decoded snapshot.
 * @returns the windows keyed by id.
 */
export function toWireUsage(snapshot: OllamaUsageSnapshot): WireUsageSnapshot {
  const windows: Partial<Record<'session' | 'weekly' | 'monthly', WireUsageWindow>> = {}
  for (const window of snapshot.windows) {
    windows[window.id] = {
      usage: window.usedFraction,
      models: window.models.map((model) => ({ name: model.name, requestCount: model.requestCount })),
      ...window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt },
    }
  }
  return { fetchedAt: snapshot.fetchedAt, ...windows }
}

/** `usage/read` value: a snapshot, or the endpoint has no usage surface. */
export type UsageReadValue =
  | { readonly status: 'ok'; readonly usage: WireUsageSnapshot }
  | { readonly status: 'unsupported' }

/** `credential/status` value: presence and writability, never the value. */
export interface CredentialStatusValue {
  /** Reference the route resolves, when it names one. */
  readonly reference: string | undefined
  /** Whether a usable value resolves right now (store or environment). */
  readonly configured: boolean
  /** Whether the credentials seam could currently store a value here. */
  readonly writable: boolean
}

/** `credential/set` value: the state after the write. */
export interface CredentialSetValue {
  /** Whether a usable value resolves after the write. */
  readonly configured: boolean
  /** Whether another write could currently succeed. */
  readonly writable: boolean
}

/** Every value this channel answers with. */
export type UsageRpcValue = UsageReadValue | CredentialStatusValue | CredentialSetValue

/** The handler the connection service calls for one endpoint. */
export type UsageRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<RpcReply<UsageRpcValue>>

/** Everything the handler resolves per call, so settings changes land immediately. */
export interface UsageRpcOptions {
  /** Current validated connection facts. */
  readonly connection: () => ConnectionOptions
  /** The non-throwing credential resolver every read shares. */
  readonly resolveCredential: ResolveCredential
  /** The credentials service, when this deployment has one. */
  readonly credentials: () => CredentialProvider | undefined
  /** Fetch implementation, injectable for tests. */
  readonly fetch: typeof fetch
  /** Attribution headers for outbound requests. */
  readonly attribution: () => Record<string, string>
}

/** Build one failure reply. */
function failure(code: string, message: string): RpcFailure {
  return { ok: false, error: { code, message, details: {} } }
}

/** Whether `value` is a plain object usable as a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Decode one optional non-empty string field. */
function optionalString(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Decode a `usage/read` request: draft endpoint and one-shot key, both optional. */
function decodeUsageRequest(payload: unknown): { baseURL?: string; apiKey?: string } | undefined {
  if (!isRecord(payload)) return undefined
  const baseURL = optionalString(payload.baseURL)
  const apiKey = optionalString(payload.apiKey)
  if (baseURL === null || apiKey === null) return undefined
  return {
    ...baseURL === undefined ? {} : { baseURL },
    ...apiKey === undefined ? {} : { apiKey },
  }
}

/** Decode a `credential/set` request: the value, and an optional reference to confirm. */
function decodeCredentialSetRequest(payload: unknown): { value: string; ref?: string } | undefined {
  if (!isRecord(payload)) return undefined
  const value = payload.value
  const ref = optionalString(payload.ref)
  if (typeof value !== 'string' || value.length === 0 || ref === null) return undefined
  return { value, ...ref === undefined ? {} : { ref } }
}

/** Answer `usage/read` for one request. */
async function readUsageReply(
  options: UsageRpcOptions,
  payload: unknown,
  signal: AbortSignal | undefined,
): Promise<RpcReply<UsageReadValue>> {
  const request = decodeUsageRequest(payload)
  if (request === undefined) return failure('invalid-request', 'invalid Ollama Cloud usage request')
  const facts = options.connection()
  const apiKey = request.apiKey
    ?? (facts.apiKeyEnv === undefined ? undefined : await options.resolveCredential(facts.apiKeyEnv))
  try {
    const usage = await readUsage(
      {
        baseURL: nativeBaseFrom(request.baseURL, facts.nativeBaseURL),
        ...apiKey === undefined ? {} : { apiKey },
        requestTimeoutMs: facts.requestTimeoutMs,
      },
      { fetch: options.fetch, attribution: options.attribution },
      signal,
    )
    return { ok: true, value: { status: 'ok', usage: toWireUsage(usage) } }
  } catch (error) {
    if (error instanceof UsageError && error.code === USAGE_UNSUPPORTED) {
      return { ok: true, value: { status: 'unsupported' } }
    }
    if (error instanceof UsageError) return failure(error.code, error.message)
    throw error
  }
}

/** Answer `credential/status` for the configured route. */
async function credentialStatusReply(options: UsageRpcOptions): Promise<RpcSuccess<CredentialStatusValue>>
{
  const facts = options.connection()
  const reference = facts.apiKeyEnv
  let configured = false
  let writable = false
  const credentials = options.credentials()
  if (reference !== undefined && credentials !== undefined) {
    try {
      const info = await credentials.describe(credentialRef(reference))
      configured = info.configured === true
      writable = info.writable === true
    } catch {
      // A store that cannot answer leaves both facts false; the environment
      // check below still reports a configured value.
    }
  }
  if (!configured && reference !== undefined) {
    configured = (await options.resolveCredential(credentialRef(reference))) !== undefined
  }
  return { ok: true, value: { reference, configured, writable } }
}

/** Answer `credential/set` for the configured route. */
async function credentialSetReply(
  options: UsageRpcOptions,
  payload: unknown,
): Promise<RpcReply<CredentialSetValue>> {
  const request = decodeCredentialSetRequest(payload)
  if (request === undefined) return failure('invalid-request', 'invalid Ollama Cloud credential request')
  const reference = options.connection().apiKeyEnv
  if (reference === undefined) {
    return failure(
      'invalid-request',
      'this route resolves no credential reference; name one in apiKeyEnv before storing a key',
    )
  }
  if (request.ref !== undefined && request.ref !== reference) {
    return failure(
      'invalid-request',
      `this route stores its credential under "${reference}", not "${request.ref}"`,
    )
  }
  const credentials = options.credentials()
  if (credentials === undefined) {
    return failure(
      'unavailable',
      'this deployment has no credentials service; export the reference instead of storing it',
    )
  }
  let key: string
  try {
    key = assertUsableApiKey(request.value, PLUGIN_NAME, reference)
  } catch (error) {
    return failure('INVALID_CREDENTIAL', error instanceof Error ? error.message : 'the key is unusable')
  }
  try {
    await credentials.set(credentialRef(reference), key)
    const info = await credentials.describe(credentialRef(reference))
    return { ok: true, value: { configured: info.configured === true, writable: info.writable === true } }
  } catch (error) {
    return failure('internal', error instanceof Error ? error.message : 'storing the credential failed')
  }
}

/**
 * Build the handler for this plugin's RPC channel.
 * @param options - live resolution hooks.
 * @returns the handler to register with `connection.rpc.handle`.
 */
export function createUsageRpcHandler(options: UsageRpcOptions): UsageRpcHandler {
  return async (endpoint, payload, signal) => {
    if (endpoint === USAGE_ENDPOINT) return readUsageReply(options, payload, signal)
    if (endpoint === CREDENTIAL_STATUS_ENDPOINT) return credentialStatusReply(options)
    if (endpoint === CREDENTIAL_SET_ENDPOINT) return credentialSetReply(options, payload)
    // The wording matches what provider UIs match on to suggest a host restart.
    return failure('unknown-endpoint', `unknown Ollama Cloud endpoint: ${endpoint}`)
  }
}
