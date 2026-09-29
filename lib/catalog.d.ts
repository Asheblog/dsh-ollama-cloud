/**
 * Built-in Ollama Cloud model catalog.
 *
 * A snapshot of the models the public cloud serves, taken from live
 * `GET https://ollama.com/api/tags` plus `POST https://ollama.com/api/show`
 * responses on 2026-09-29. Ollama retires cloud models on its own schedule
 * (retired ids answer HTTP 410), so this snapshot is a starting point, not an
 * authority: every field is overridable through plugin configuration, and the
 * `llm/discoverModels` surface offers the live list for adoption.
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
/** The snapshot of Ollama Cloud models this plugin ships with. */
export declare const DEFAULT_MODELS: readonly OllamaModelEntry[];
//# sourceMappingURL=catalog.d.ts.map