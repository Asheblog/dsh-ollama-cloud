/**
 * Ollama Cloud for DeepSeek Harness.
 *
 * One plugin instance owns the `ollama-cloud` route: chat runs through the
 * official pi-ai adapter against Ollama's OpenAI-compatible `/v1` surface,
 * model discovery reads the native `/api` surface, and the Ollama web
 * search/fetch endpoints register as `ctx.web` providers. The thinking levels
 * each model offers come from the model's own wire metadata, so the composer's
 * effort selector adjusts real capability instead of a guess.
 *
 * @module dsh-ollama-cloud
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: makes `ctx.fiber.entry` (the loader row this plugin runs as)
// visible, which is how the plugin learns its own settings namespace.
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: makes `ctx.connection` (the browser session's RPC registry) visible.
import type {} from '@deepseek-ai/dsh-client-connection'
import { attributionHeaders, LlmError, type LlmDiscoveredModel, type LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'

import { OllamaCloudAdapter } from './adapter.js'
import {
  createConnectionReader,
  DISPLAY_NAME,
  PLUGIN_NAME,
  PROVIDER,
  type Config as ConfigShape,
  type ConnectionOptions,
} from './config.js'
import { createCredentialResolver, type ResolveCredential } from './credentials.js'
import { discoverModels, nativeBaseFrom } from './discovery.js'
import { createUsageRpcHandler, USAGE_RPC_CHANNEL } from './rpc.js'
import { OllamaWebFetchProvider, OllamaWebSearchProvider } from './web.js'

export { OllamaCloudAdapter } from './adapter.js'
export {
  Config,
  createConnectionReader,
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DISPLAY_NAME,
  nativeAPIBaseURL,
  openAICompatibleBaseURL,
  PROVIDER,
  resolveConnection,
} from './config.js'
export { createCredentialResolver } from './credentials.js'
export type { ResolveCredential } from './credentials.js'
export type { Config as ConfigShape, ConfiguredModelEntry, ConnectionOptions, Options, ResolvedModel } from './config.js'
export { DEFAULT_MODELS } from './catalog.js'
export { plainOptions } from './config.js'
export type { OllamaModelEntry } from './catalog.js'
export { DEFAULT_DISCOVERY_TIMEOUT_MS, discoverModels, nativeBaseFrom } from './discovery.js'
export {
  CREDENTIAL_SET_ENDPOINT,
  CREDENTIAL_STATUS_ENDPOINT,
  createUsageRpcHandler,
  USAGE_ENDPOINT,
  USAGE_RPC_CHANNEL,
} from './rpc.js'
export type {
  CredentialSetValue,
  CredentialStatusValue,
  UsageReadValue,
  UsageRpcHandler,
  WireUsageSnapshot,
  WireUsageWindow,
} from './rpc.js'
export { toWireUsage } from './rpc.js'
export {
  decodeUsageResponse,
  readUsage,
  USAGE_MAX_BYTES,
  USAGE_UNSUPPORTED,
  USAGE_WINDOW_IDS,
  UsageError,
} from './usage.js'
export type { OllamaUsageModelCount, OllamaUsageSnapshot, OllamaUsageWindow, UsageWindowId } from './usage.js'
export { GENERIC_EFFORTS, offeredLevels, pinEfforts, policyFromThinking } from './reasoning.js'
export type { ReasoningPolicy, ThinkingLevel } from './reasoning.js'
export { createOllamaCloudAuth, createPiAiProfile, toPiAiModel } from './profile.js'
export { MAX_SEARCH_RESULTS, OLLAMA_WEB_PROVIDER_ID, OllamaWebFetchProvider, OllamaWebSearchProvider } from './web.js'

/** Loader row name; also the plugin's settings namespace fallback. */
export const name = PLUGIN_NAME

/** The route lives on the LLM seam. */
export const inject = ['llm']

/** Default settings namespace when the loader does not supply an entry id. */
export const DEFAULT_SETTINGS_NAMESPACE = PLUGIN_NAME

/**
 * Build the credential resolution a chat request needs.
 *
 * A route that names a reference fails loud when it is unset — handing pi-ai
 * `undefined` would let it pick up an unrelated ambient key and bill another
 * tenant — while a route that names none (a local Ollama server) sends no
 * auth at all.
 *
 * @param resolveCredential - the per-request seam resolver.
 * @returns the route's key resolver.
 */
export function createRouteApiKeyResolver(
  resolveCredential: ResolveCredential,
): (facts: ConnectionOptions) => Promise<string | undefined> {
  return async (facts) => {
    const reference = facts.apiKeyEnv
    if (reference === undefined) return undefined
    const key = await resolveCredential(reference)
    if (key !== undefined) return key
    throw new LlmError(
      `llm-ollama-cloud: no API key for provider route "${PROVIDER}";`
      + ` its configuration resolves "${reference}", which is not set —`
      + ' store it through the credentials service (the Models page or plugin settings) or export it,'
      + ' and clear the reference only if the endpoint authenticates on its own',
      'MISSING_CREDENTIAL',
    )
  }
}

/**
 * Mount the Ollama Cloud route, its discovery surface, and its web providers.
 * @param ctx - the plugin's context.
 * @param config - live configuration for this row.
 */
export function apply(ctx: Context, config: ConfigShape): void {
  const connection = createConnectionReader(config, (error) => {
    ctx.logger.warn('llm-ollama-cloud: configuration is invalid; keeping the last good connection facts')
    ctx.logger.warn(error)
  })
  // Resolve once at mount so an unusable row config fails loudly instead of
  // surfacing as a request-time error nobody attributes to configuration.
  connection()

  const settingsNs = ctx.fiber.entry?.options.id ?? DEFAULT_SETTINGS_NAMESPACE
  const resolveCredential = createCredentialResolver(ctx, name)

  /** The configured key, or `undefined` when nothing usable is set. */
  const storedKey = async (facts: ConnectionOptions): Promise<string | undefined> => {
    const reference = facts.apiKeyEnv
    return reference === undefined ? undefined : resolveCredential(reference)
  }

  const resolveApiKey = createRouteApiKeyResolver(resolveCredential)

  const adapter = new OllamaCloudAdapter({
    options: connection,
    resolveApiKey,
    resolveAttachments: () => ctx.get('attachments'),
  })

  ctx.llm.registerConfigurableProviders([{
    provider: PROVIDER,
    displayName: DISPLAY_NAME,
    settingsNs,
    settingsPath: [],
  }])
  ctx.llm.registerAdapter([PROVIDER], adapter)

  /**
   * Interrogate one endpoint for its model catalog. A configuration surface
   * may pass the draft endpoint and a one-shot key; otherwise the configured
   * route's endpoint and stored credential answer, and the public cloud
   * metadata endpoints need no credential at all.
   */
  ctx.llm.registerModelDiscovery(settingsNs, async (request: LlmModelDiscoveryRequest, signal) => {
    const facts = connection()
    const baseURL = nativeBaseFrom(request.baseURL, facts.nativeBaseURL)
    const apiKey = request.apiKey ?? await storedKey(facts)
    const discovered: readonly LlmDiscoveredModel[] = await discoverModels(
      {
        baseURL,
        ...apiKey === undefined ? {} : { apiKey },
        requestTimeoutMs: facts.requestTimeoutMs,
      },
      { fetch, attribution: attributionHeaders },
      signal,
    )
    return discovered
  })

  // Optional surface: a headless composition has no browser session, so the
  // usage channel simply never mounts there and everything else keeps working.
  ctx.inject(['connection'], (connectionCtx) => {
    const handler = createUsageRpcHandler({
      connection,
      resolveCredential,
      credentials: () => ctx.get('credentials'),
      fetch,
      attribution: attributionHeaders,
    })
    connectionCtx.effect(() => {
      try {
        return connectionCtx.connection.rpc.handle(USAGE_RPC_CHANNEL, handler)
      } catch (error) {
        // Loud instead of silent: the browser card then reports a restart hint,
        // and this line names the composition change that fixes it.
        ctx.logger.warn(
          'llm-ollama-cloud: the usage channel could not mount on the connection service;'
          + ' the connection row needs `webServer` in its inject (this bundle patch adds it)',
        )
        ctx.logger.warn(error)
        return () => {}
      }
    }, 'llm-ollama-cloud: usage RPC channel')
  })

  // Optional capability: a headless composition without the web seam simply
  // has no search/fetch to offer, and everything else keeps working.
  ctx.inject(['web'], (webCtx) => {
    const options = {
      baseURL: () => connection().nativeBaseURL,
      resolveApiKey: () => storedKey(connection()),
      requestTimeoutMs: () => connection().requestTimeoutMs,
    }
    webCtx.effect(() => {
      const disposeSearch = webCtx.web.registerSearchProvider(new OllamaWebSearchProvider(options))
      const disposeFetch = webCtx.web.registerFetchProvider(new OllamaWebFetchProvider(options))
      return () => {
        disposeFetch()
        disposeSearch()
      }
    }, 'llm-ollama-cloud: web providers')
  })
}
