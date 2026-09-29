/**
 * Ollama thinking metadata → DeepSeek Harness reasoning levels.
 *
 * Ollama reports the selectable thinking levels per model through
 * `POST /api/show` (`thinking.values` + `thinking.default`), and the harness
 * exposes its own fixed level vocabulary (`off`, `minimal`, `low`, `medium`,
 * `high`, `xhigh`, `max`) to the composer and to request validation. This
 * module is the whole translation between the two: it never invents a level
 * the endpoint did not report, and it pins every harness level explicitly so
 * pi-ai's asymmetric defaulting (an absent key counts as supported for the
 * five base levels but unsupported for `xhigh`/`max`) can never leak through.
 *
 * @module dsh-ollama-cloud/reasoning
 */
/** Harness/pi-ai thinking levels in escalation order. */
export declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** One selectable thinking level. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/** Wire spelling that switches thinking off on the OpenAI-compatible endpoint. */
export declare const WIRE_NONE = "none";
/** Wire spelling used for models whose only thinking switch is a boolean `true`. */
export declare const WIRE_BOOLEAN_ON = "high";
/** Every harness level mapped to its wire spelling, `null` meaning "not offered". */
export type PinnedEfforts = Record<ThinkingLevel, string | null>;
/** One model's resolved reasoning capability. */
export interface ReasoningPolicy {
    /** Every harness level, pinned: a string is the wire value, `null` is unsupported. */
    readonly efforts: PinnedEfforts;
    /** Default level the harness materializes when the caller picks none. */
    readonly defaultEffort?: ThinkingLevel;
}
/**
 * Pin every harness level explicitly: undeclared levels become `null` rather
 * than an absent key, which pi-ai would otherwise read as supported.
 * @param offered - levels the endpoint reports, with their wire spellings.
 * @returns the complete pinned level map.
 */
export declare function pinEfforts(offered: Partial<Record<ThinkingLevel, string>>): PinnedEfforts;
/**
 * Levels a pinned map offers, in escalation order.
 * @param efforts - a pinned level map.
 * @returns the offered levels.
 */
export declare function offeredLevels(efforts: PinnedEfforts): ThinkingLevel[];
/**
 * Offered levels only, shaped as the configuration-facing effort dict
 * (`Partial` map, no `null` pins). This is the form catalog entries and plugin
 * configuration carry; pinning happens later, when a pi-ai descriptor is built.
 * @param efforts - a pinned level map.
 * @returns the offered levels with their wire spellings.
 */
export declare function offeredEffortMap(efforts: PinnedEfforts): Partial<Record<ThinkingLevel, string>>;
/**
 * Translate one model's raw `thinking` metadata into a reasoning policy.
 *
 * `false` maps to the `off` level (wire `none`), `true` maps to a single
 * `high` level — Ollama accepts any recognized effort for boolean models and
 * treats it as "think", so the level id is ours to choose and the wire value
 * is the only thing that matters. Unknown level strings keep their exact wire
 * spelling and occupy the next free standard level, so a future Ollama level
 * (say `ultra`) stays selectable without inventing a harness level id.
 *
 * @param thinking - raw `thinking` value from a `/api/show` response.
 * @returns the policy, or `undefined` when the model offers no thinking control.
 */
export declare function policyFromThinking(thinking: unknown): ReasoningPolicy | undefined;
//# sourceMappingURL=reasoning.d.ts.map