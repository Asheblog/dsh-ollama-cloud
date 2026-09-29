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
 * @module dsh-ollama-cloud/profile
 */
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { DISPLAY_NAME, PROVIDER } from './config.js';
/** Request-level bound on base64-encoded image payload (matches the host default). */
export const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20971520;
/** Total-pixel budget preserving the complete 2048px normalized attachment. */
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4194304;
/** Raw encoded-byte target before inline base64 expansion (1 MiB). */
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1048576;
/** Cost is unknown to this route; every Ollama Cloud call reports zero here. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
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
};
/**
 * Build one pi-ai model descriptor for the OpenAI Chat Completions surface.
 * @param model - resolved catalog model.
 * @param connection - connection facts the descriptor defaults from.
 * @param baseUrl - OpenAI-compatible base the descriptor pins.
 * @returns the descriptor pi-ai streams with.
 */
export function toPiAiModel(model, connection, baseUrl) {
    const reasoning = Object.values(model.efforts).some((wire) => wire !== null && wire !== undefined);
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
    };
}
/**
 * Provider auth for pi-ai itself. Ollama has no ambient credential discovery
 * here: the harness credentials seam resolves the configured reference per
 * request and passes it as the request-level `apiKey` override, which pi-ai
 * treats as authoritative. This declaration only answers status questions —
 * an empty store means "not configured", never "use OPENAI_API_KEY".
 * @returns provider auth with an empty credential path.
 */
function ollamaAuth() {
    return {
        apiKey: {
            name: `${DISPLAY_NAME} API key`,
            resolve: ({ credential }) => Promise.resolve(credential?.key === undefined
                ? { auth: {} }
                : { auth: { apiKey: credential.key }, source: DISPLAY_NAME }),
        },
    };
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
export function createOllamaCloudAuth() {
    const stored = new Map();
    return {
        credentials: {
            read: (providerId) => Promise.resolve(stored.get(providerId)),
            list: () => Promise.resolve([...stored].map(([providerId, credential]) => ({ providerId, type: credential.type }))),
            async modify(providerId, mutate) {
                const next = await mutate(stored.get(providerId));
                if (next !== undefined)
                    stored.set(providerId, next);
                return stored.get(providerId);
            },
            delete: (providerId) => {
                stored.delete(providerId);
                return Promise.resolve();
            },
        },
        authContext: {
            env: () => Promise.resolve(undefined),
            fileExists: () => Promise.resolve(false),
        },
    };
}
/**
 * Resolve the complete pi-ai provider profile for one connection snapshot.
 * @param connection - validated connection facts.
 * @returns the profile the official adapter consumes.
 */
export function createPiAiProfile(connection) {
    const models = connection.models.map((model) => toPiAiModel(model, connection, connection.chatBaseURL));
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
            api: openAICompletionsApi(),
        }),
        configuredMaxTokens: new Map(connection.models.flatMap((model) => model.maxTokens === undefined ? [] : [[model.id, model.maxTokens]])),
        modelErrors: new Map(),
    };
}
//# sourceMappingURL=profile.js.map