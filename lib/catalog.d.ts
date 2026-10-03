/**
 * The Ollama Cloud catalog: the shipped snapshot, the catalog seam the
 * connection resolution reads, and the merge policy between them.
 *
 * `DEFAULT_MODELS` is a snapshot of the models the public cloud served, taken
 * from live `GET https://ollama.com/api/tags` plus `POST https://ollama.com/api/show`
 * responses on 2026-09-29. It is **not** the authority: Ollama adds and retires
 * cloud models on its own schedule (retired ids answer HTTP 410), so the plugin
 * refreshes the catalog from the configured endpoint on every mount and serves
 * the answer for the session (see `live-catalog.ts`). The snapshot survives for
 * exactly two jobs — the layer a catalog falls back to before any endpoint has
 * answered, and the source of the display names the cloud ids never carry.
 *
 * `reasoningEfforts` mirrors the wire metadata exactly: each key is a harness
 * thinking level the picker offers, each value is the spelling Ollama receives
 * in `reasoning_effort`. Models the metadata reports as boolean-only expose
 * `off` plus a single `high` level — Ollama accepts any recognized effort for
 * them and turns it into `true`, so the level id is a label and the wire value
 * is what selects thinking on.
 *
 * @module dsh-ollama-cloud/catalog
 */
import { type ThinkingLevel } from './reasoning.js';
/** One model entry advertised by the plugin and accepted for chat requests. */
export interface OllamaModelEntry {
    /** Model id Ollama accepts on the wire. */
    readonly id: string;
    /** Display name for selectors; falls back to the id. */
    readonly name?: string;
    /** Combined request and response capacity; falls back to the route default. */
    readonly contextWindow?: number;
    /** Per-request output cap override; falls back to the route default. */
    readonly maxTokens?: number;
    /** Whether the model accepts image input. */
    readonly vision?: boolean;
    /**
     * Selectable thinking levels and the wire spelling each one sends, or
     * `false` for a model with no thinking control. Omitted keeps the built-in
     * entry's mapping when the id matches one.
     */
    readonly reasoningEfforts?: Partial<Record<ThinkingLevel, string>> | false;
    /** Default level materialized when a session picks none; must be offered. */
    readonly defaultEffort?: ThinkingLevel;
}
/**
 * The catalog seam the connection resolution reads.
 *
 * The implementation is the live catalog (the store that refreshes from the
 * configured endpoint); a bare `resolveConnection()` call falls back to the
 * shipped snapshot.
 */
export interface CatalogSource {
    /**
     * Identity of the catalog generation. A new value re-resolves every
     * memoized connection, which is how a catalog adopted mid-session reaches
     * the route without a reload; an unchanged value means the memoized facts
     * still hold.
     */
    revision(): unknown;
    /**
     * Base catalog for one native endpoint, or `undefined` to serve the shipped
     * snapshot — because the endpoint was never interrogated, or because the
     * question was answered for a different endpoint.
     * @param nativeBaseURL - normalized native API base the route talks to.
     * @returns the endpoint's catalog, or `undefined`.
     */
    modelsFor(nativeBaseURL: string): readonly OllamaModelEntry[] | undefined;
}
/**
 * Merge one endpoint-declared entry over the shipped snapshot entry for the
 * same id.
 *
 * The endpoint is the authority for what a model *is*; the snapshot only fills
 * what the endpoint did not answer, plus the display name the cloud id never
 * carries. A model whose detail request failed arrives as `{ id }`, so its
 * levels stay undeclared and it takes the standard ladder, exactly like a model
 * neither source describes.
 *
 * @param live - entry an endpoint declared.
 * @param shipped - the snapshot entry with the same id, when the snapshot has one.
 * @returns the entry the route should serve.
 */
export declare function mergeCatalogEntry(live: OllamaModelEntry, shipped?: OllamaModelEntry): OllamaModelEntry;
/**
 * Merge a whole endpoint listing over the shipped snapshot.
 *
 * Membership comes from the live list alone: a model the endpoint no longer
 * lists is gone, however curated it once was.
 *
 * @param live - entries the endpoint declared, in listing order.
 * @param shipped - snapshot to inherit display names and unanswered fields from.
 * @returns the merged catalog, in listing order.
 */
export declare function mergeLiveCatalog(live: readonly OllamaModelEntry[], shipped?: readonly OllamaModelEntry[]): OllamaModelEntry[];
/** The snapshot of Ollama Cloud models this plugin ships with. */
export declare const DEFAULT_MODELS: readonly OllamaModelEntry[];
//# sourceMappingURL=catalog.d.ts.map