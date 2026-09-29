/**
 * The pi-ai profile and model descriptors this plugin hands to the official
 * `PiAiAdapter`.
 *
 * Chat runs on pi-ai's OpenAI Chat Completions implementation against the
 * `/v1` surface, so the descriptors carry exactly the wire contract Ollama
 * needs: `max_tokens` (not `max_completion_tokens`), `reasoning_effort`, and
 * streaming usage, with `system` kept as the system role. Every reasoning
 * level is pinned in `thinkingLevelMap` — `null` for unsupported, the exact
 * wire spelling otherwise — because pi-ai treats an absent map key as
 * "supported" for the base levels.
 *
 * The protocol is wrapped in {@link contextTolerantStreams}: this plugin's
 * pi-ai is its own dependency, while the harness that drives it is the app's,
 * and the two only agree on the request context if their generations match.
 * See docs/adr/0004-pi-ai-generation-alignment.md.
 *
 * @module dsh-ollama-cloud/profile
 */

import { createProvider, normalizeContext, type Api, type Credential, type CredentialStore, type AuthContext, type Model, type ProviderAuth, type ProviderStreams } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'

import type { ConnectionOptions, ResolvedModel } from './config.js'
import { DISPLAY_NAME, PROVIDER } from './config.js'

/** Request-level bound on base64-encoded image payload (matches the host default). */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20971520

/** Total-pixel budget preserving the complete 2048px normalized attachment. */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4194304

/** Raw encoded-byte target before inline base64 expansion (1 MiB). */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1048576

/** Cost is unknown to this route; every Ollama Cloud call reports zero here. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const

/**
 * Wire-compatibility switches Ollama's OpenAI-compatible surface needs:
 * `system` role (no `developer`), `max_tokens`, `reasoning_effort` with the
 * OpenAI thinking dialect, streaming usage, and no `store`.
 */
const OLLAMA_COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  maxTokensField: 'max_tokens',
  thinkingFormat: 'openai',
} as const

/**
 * Build one pi-ai model descriptor for the OpenAI Chat Completions surface.
 * @param model - resolved catalog model.
 * @param connection - connection facts the descriptor defaults from.
 * @param baseUrl - OpenAI-compatible base the descriptor pins.
 * @returns the descriptor pi-ai streams with.
 */
export function toPiAiModel(model: ResolvedModel, connection: ConnectionOptions, baseUrl: string): Model<Api> {
  const reasoning = Object.values(model.efforts).some((wire) => wire !== null && wire !== undefined)
  return {
    id: model.id,
    name: model.name,
    api: 'openai-completions',
    provider: PROVIDER,
    baseUrl,
    reasoning,
    ...reasoning ? { thinkingLevelMap: { ...model.efforts } } : {},
    input: model.vision ? ['text', 'image'] : ['text'],
    cost: { ...NO_COST },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens ?? connection.defaultMaxTokens,
    compat: { ...OLLAMA_COMPAT },
  } as Model<Api>
}

/**
 * Provider auth for pi-ai itself. Ollama has no ambient credential discovery
 * here: the harness credentials seam resolves the configured reference per
 * request and passes it as the request-level `apiKey` override, which pi-ai
 * treats as authoritative. This declaration only answers status questions —
 * an empty store means "not configured", never "use OPENAI_API_KEY".
 * @returns provider auth with an empty credential path.
 */
function ollamaAuth(): ProviderAuth {
  return {
    apiKey: {
      name: `${DISPLAY_NAME} API key`,
      resolve: ({ credential }) => Promise.resolve(
        credential?.key === undefined
          ? { auth: {} }
          : { auth: { apiKey: credential.key }, source: DISPLAY_NAME },
      ),
    },
  }
}

/** The two auth injectables a pi-ai collection is built with. */
export interface OllamaCloudAuthInjection {
  /** Durable storage for credentials pi-ai itself writes; empty for this route. */
  readonly credentials: CredentialStore
  /** Ambient lookups; this route answers none, so nothing leaks in from the environment. */
  readonly authContext: AuthContext
}

/**
 * Create the in-memory auth services for the Ollama Cloud pi-ai adapter.
 *
 * This process-local store starts empty and is never written: the route has
 * no login flow (the API key lives in the harness credentials seam), and an
 * ambient source is deliberately absent so a stray `OPENAI_API_KEY` can never
 * authenticate an Ollama request.
 *
 * @returns auth services with an empty credential store and no ambient sources.
 */
export function createOllamaCloudAuth(): OllamaCloudAuthInjection {
  const stored = new Map<string, Credential>()
  return {
    credentials: {
      read: (providerId) => Promise.resolve(stored.get(providerId)),
      list: () => Promise.resolve(
        [...stored].map(([providerId, credential]) => ({ providerId, type: credential.type })),
      ),
      async modify(providerId, mutate) {
        const next = await mutate(stored.get(providerId))
        if (next !== undefined) stored.set(providerId, next)
        return stored.get(providerId)
      },
      delete: (providerId) => {
        stored.delete(providerId)
        return Promise.resolve()
      },
    },
    authContext: {
      env: () => Promise.resolve(undefined),
      fileExists: () => Promise.resolve(false),
    },
  }
}

/**
 * Wrap one protocol implementation so a host generation that still passes the
 * pre-0.87 `Context` — a `systemPrompt` and a separate `tools` list beside the
 * messages — reaches it as the transcript pi-ai 0.87 expects.
 *
 * pi-ai 0.87 moved the prompt and the tool declarations into the transcript:
 * its `Models` collection folds them with `normalizeContext()` before the
 * request reaches a provider, and its API implementations read the result.
 * The 0.1.x collections folded nothing — they handed the raw `Context` straight
 * to the provider — so an implementation from the newer generation *silently
 * drops the system prompt and every tool declaration* when an older harness
 * drives it, and an implementation from the older generation dies with
 * `Cannot read properties of undefined (reading 'length')` when the newer
 * harness does (the 0.2.0 incident). Normalizing here costs one idempotent
 * call — `normalizeContext()` on an already-normalized transcript is a no-op —
 * and lets one release serve both host generations.
 *
 * @param streams - the protocol implementation the route streams with.
 * @returns the same protocol, tolerant of the pre-0.87 context shape.
 */
export function contextTolerantStreams(streams: ProviderStreams): ProviderStreams {
  return {
    // Spread first so optional capabilities (deferred fetch/cancel) survive the
    // wrap; a protocol that gains one must not lose it to this shim.
    ...streams,
    stream: (model, context, options) => streams.stream(model, normalizeContext(context), options),
    streamSimple: (model, context, options) => streams.streamSimple(model, normalizeContext(context), options),
  }
}

/**
 * Resolve the complete pi-ai provider profile for one connection snapshot.
 * @param connection - validated connection facts.
 * @returns the profile the official adapter consumes.
 */
export function createPiAiProfile(connection: ConnectionOptions): ResolvedPiAiProviderProfile {
  const models = connection.models.map((model) => toPiAiModel(model, connection, connection.chatBaseURL))
  return {
    provider: PROVIDER,
    displayName: DISPLAY_NAME,
    ...connection.apiKeyEnv === undefined ? {} : { apiKeyEnv: connection.apiKeyEnv },
    baseURL: connection.chatBaseURL,
    defaultContextWindow: connection.defaultContextWindow,
    defaultMaxTokens: connection.defaultMaxTokens,
    defaultInput: ['text'],
    streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
    maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: connection.retryPolicy,
    piProvider: createProvider({
      id: PROVIDER,
      name: DISPLAY_NAME,
      baseUrl: connection.chatBaseURL,
      auth: ollamaAuth(),
      models,
      api: contextTolerantStreams(openAICompletionsApi()),
    }),
    configuredMaxTokens: new Map(
      connection.models.flatMap((model) => model.maxTokens === undefined ? [] : [[model.id, model.maxTokens]]),
    ),
    modelErrors: new Map(),
  }
}
