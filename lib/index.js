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
 * The catalog itself is not frozen at release: at mount — and then on an
 * interval — the plugin asks the configured endpoint what it serves and adopts
 * the answer for the running session and the next boot (see `live-catalog.ts`),
 * so a model Ollama adds, retires, or re-levels reaches users without a plugin
 * update.
 *
 * @module dsh-ollama-cloud
 */
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm';
import { OllamaCloudAdapter } from './adapter.js';
import { reportAlignment } from './alignment.js';
import { createConnectionReader, DISPLAY_NAME, IDLE_REFRESH_WATCH_MS, PLUGIN_NAME, PROVIDER, } from './config.js';
import { createCredentialResolver } from './credentials.js';
import { discoverModels, nativeBaseFrom } from './discovery.js';
import { createLiveCatalog } from './live-catalog.js';
import { createUsageRpcHandler, USAGE_RPC_CHANNEL } from './rpc.js';
import { OllamaWebFetchProvider, OllamaWebSearchProvider } from './web.js';
export { OllamaCloudAdapter } from './adapter.js';
export { Config, createConnectionReader, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_REFRESH_MINUTES, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, DISPLAY_NAME, IDLE_REFRESH_WATCH_MS, nativeAPIBaseURL, openAICompatibleBaseURL, PROVIDER, resolveConnection, } from './config.js';
export { createCredentialResolver } from './credentials.js';
export { DEFAULT_MODELS, mergeCatalogEntry, mergeLiveCatalog } from './catalog.js';
export { plainOptions } from './config.js';
export { DEFAULT_DISCOVERY_TIMEOUT_MS, discoverCatalog, discoverModels, nativeBaseFrom } from './discovery.js';
export { createLiveCatalog } from './live-catalog.js';
export { CATALOG_CACHE_FILE, CATALOG_CACHE_VERSION, defaultCatalogCachePath, readCatalogCache, writeCatalogCache, } from './catalog-cache.js';
export { CREDENTIAL_SET_ENDPOINT, CREDENTIAL_STATUS_ENDPOINT, createUsageRpcHandler, USAGE_ENDPOINT, USAGE_RPC_CHANNEL, } from './rpc.js';
export { toWireUsage } from './rpc.js';
export { decodeUsageResponse, readUsage, USAGE_MAX_BYTES, USAGE_UNSUPPORTED, USAGE_WINDOW_IDS, UsageError, } from './usage.js';
export { GENERIC_EFFORTS, offeredLevels, pinEfforts, policyFromThinking } from './reasoning.js';
export { createOllamaCloudAuth, createPiAiProfile, toPiAiModel } from './profile.js';
export { MAX_SEARCH_RESULTS, OLLAMA_WEB_PROVIDER_ID, OllamaWebFetchProvider, OllamaWebSearchProvider } from './web.js';
/** Loader row name; also the plugin's settings namespace fallback. */
export const name = PLUGIN_NAME;
/** The route lives on the LLM seam. */
export const inject = ['llm'];
/** Default settings namespace when the loader does not supply an entry id. */
export const DEFAULT_SETTINGS_NAMESPACE = PLUGIN_NAME;
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
export function createRouteApiKeyResolver(resolveCredential) {
    return async (facts) => {
        const reference = facts.apiKeyEnv;
        if (reference === undefined)
            return undefined;
        const key = await resolveCredential(reference);
        if (key !== undefined)
            return key;
        throw new LlmError(`llm-ollama-cloud: no API key for provider route "${PROVIDER}";`
            + ` its configuration resolves "${reference}", which is not set —`
            + ' store it through the credentials service (the Models page or plugin settings) or export it,'
            + ' and clear the reference only if the endpoint authenticates on its own', 'MISSING_CREDENTIAL');
    };
}
/**
 * Mount the Ollama Cloud route, its discovery surface, its web providers, and
 * the catalog refresh that keeps the route's model list current.
 * @param ctx - the plugin's context.
 * @param config - live configuration for this row.
 */
export function apply(ctx, config) {
    const catalog = createLiveCatalog({
        deps: { fetch, attribution: attributionHeaders },
    });
    const connection = createConnectionReader(config, (error) => {
        ctx.logger.warn('llm-ollama-cloud: configuration is invalid; keeping the last good connection facts');
        ctx.logger.warn(error);
    }, catalog);
    // Resolve once at mount so an unusable row config fails loudly instead of
    // surfacing as a request-time error nobody attributes to configuration.
    connection();
    // The route streams through this package's own pi-ai while the harness that
    // drives it belongs to the app, so the two can drift across app releases.
    // Say so in the log at mount instead of letting the drift surface later as a
    // cryptic request failure (the 0.2.0 incident, ADR 0004).
    reportAlignment(ctx.logger);
    const settingsNs = ctx.fiber.entry?.options.id ?? DEFAULT_SETTINGS_NAMESPACE;
    const resolveCredential = createCredentialResolver(ctx, name);
    /** The configured key, or `undefined` when nothing usable is set. */
    const storedKey = async (facts) => {
        const reference = facts.apiKeyEnv;
        return reference === undefined ? undefined : resolveCredential(reference);
    };
    /**
     * Ask the configured endpoint what it serves and adopt the answer.
     *
     * Ollama adds and retires cloud models on its own schedule, so this — not the
     * shipped snapshot — is what keeps the model list and every model's thinking
     * levels current. Nothing here is fatal: a failure leaves the catalog in use
     * exactly as it was, and the next pass (or the next boot) tries again.
     */
    let refreshing = false;
    const refreshCatalog = async (reason) => {
        if (refreshing)
            return;
        refreshing = true;
        try {
            const facts = connection();
            const apiKey = await storedKey(facts);
            const result = await catalog.refresh({
                baseURL: facts.nativeBaseURL,
                ...apiKey === undefined ? {} : { apiKey },
                requestTimeoutMs: facts.requestTimeoutMs,
            });
            const unpersisted = result.cache.ok ? '' : `; cache not written (${result.cache.error})`;
            ctx.logger.info(`llm-ollama-cloud: ${reason} catalog refresh: ${result.models} models,`
                + ` ${result.described} described by /api/show,`
                + ` ${result.changed ? 'catalog changed' : 'catalog unchanged'}${unpersisted}`);
        }
        catch (error) {
            ctx.logger.warn(`llm-ollama-cloud: ${reason} catalog refresh failed;`
                + ' the catalog already in use keeps serving (the next pass retries)');
            ctx.logger.warn(error);
        }
        finally {
            refreshing = false;
        }
    };
    const resolveApiKey = createRouteApiKeyResolver(resolveCredential);
    const adapter = new OllamaCloudAdapter({
        options: connection,
        resolveApiKey,
        resolveAttachments: () => ctx.get('attachments'),
    });
    ctx.llm.registerConfigurableProviders([{
            provider: PROVIDER,
            displayName: DISPLAY_NAME,
            settingsNs,
            settingsPath: [],
        }]);
    ctx.llm.registerAdapter([PROVIDER], adapter);
    /**
     * Interrogate one endpoint for its model catalog. A configuration surface
     * may pass the draft endpoint and a one-shot key; otherwise the configured
     * route's endpoint and stored credential answer, and the public cloud
     * metadata endpoints need no credential at all.
     */
    ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
        const facts = connection();
        const baseURL = nativeBaseFrom(request.baseURL, facts.nativeBaseURL);
        const apiKey = request.apiKey ?? await storedKey(facts);
        const discovered = await discoverModels({
            baseURL,
            ...apiKey === undefined ? {} : { apiKey },
            requestTimeoutMs: facts.requestTimeoutMs,
        }, { fetch, attribution: attributionHeaders }, signal);
        return discovered;
    });
    // Optional surface: a headless composition has no browser session, so the
    // usage channel simply never mounts there and everything else keeps working.
    ctx.inject(['connection'], (connectionCtx) => {
        const handler = createUsageRpcHandler({
            connection,
            resolveCredential,
            credentials: () => ctx.get('credentials'),
            fetch,
            attribution: attributionHeaders,
        });
        connectionCtx.effect(() => {
            try {
                return connectionCtx.connection.rpc.handle(USAGE_RPC_CHANNEL, handler);
            }
            catch (error) {
                // Loud instead of silent: the browser card then reports a restart hint,
                // and this line names the composition change that fixes it.
                ctx.logger.warn('llm-ollama-cloud: the usage channel could not mount on the connection service;'
                    + ' the connection row needs `webServer` in its inject (this bundle patch adds it)');
                ctx.logger.warn(error);
                return () => { };
            }
        }, 'llm-ollama-cloud: usage RPC channel');
    });
    // Optional capability: a headless composition without the web seam simply
    // has no search/fetch to offer, and everything else keeps working.
    ctx.inject(['web'], (webCtx) => {
        const options = {
            baseURL: () => connection().nativeBaseURL,
            resolveApiKey: () => storedKey(connection()),
            requestTimeoutMs: () => connection().requestTimeoutMs,
        };
        webCtx.effect(() => {
            const disposeSearch = webCtx.web.registerSearchProvider(new OllamaWebSearchProvider(options));
            const disposeFetch = webCtx.web.registerFetchProvider(new OllamaWebFetchProvider(options));
            return () => {
                disposeFetch();
                disposeSearch();
            };
        }, 'llm-ollama-cloud: web providers');
    });
    // Say which catalog this session starts from. The cache is what makes the
    // first model list already the endpoint's last answer, so a failure to reach
    // the endpoint at mount is a delay, not a regression.
    const cached = catalog.cached();
    ctx.logger.info(cached === undefined
        ? 'llm-ollama-cloud: no cached catalog yet; serving the shipped snapshot until the endpoint answers'
        : `llm-ollama-cloud: serving the cached catalog of ${cached.endpoint}`
            + ` (${cached.models} models, fetched ${new Date(cached.fetchedAt).toISOString()})`);
    if (config.autoRefresh.get()) {
        // Deliberately not awaited: a slow endpoint must not hold up the boot, and
        // the model list is already correct from the cache (or the snapshot).
        void refreshCatalog('mount');
    }
    // The scheduler re-reads the live configuration twice per pass — once to
    // decide how long to wait, once when the timer fires to decide what that
    // pass does — so a change never has to survive a whole interval, and
    // switching the refresh off takes effect at the next tick instead of
    // requiring a reload. While it is off (or mount-only) the chain keeps
    // ticking on the idle cadence without touching the network, which is what
    // makes switching it back on work the same way.
    ctx.effect(() => {
        let stopped = false;
        let timer;
        /** Minutes to schedule: `0` means this pass must not fetch. */
        const intervalMinutes = () => (config.autoRefresh.get() ? config.refreshMinutes.get() : 0);
        const arm = () => {
            if (stopped)
                return;
            const scheduled = intervalMinutes();
            timer = setTimeout(() => {
                if (intervalMinutes() > 0)
                    void refreshCatalog('interval');
                arm();
            }, scheduled > 0 ? scheduled * 60_000 : IDLE_REFRESH_WATCH_MS);
            timer.unref?.();
        };
        arm();
        return () => {
            stopped = true;
            if (timer !== undefined)
                clearTimeout(timer);
        };
    }, 'llm-ollama-cloud: catalog refresh timer');
}
//# sourceMappingURL=index.js.map