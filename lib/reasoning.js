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
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** Levels above `off`, in escalation order; the pool unknown strings draw from. */
const THINKABLE_LEVELS = THINKING_LEVELS.filter((level) => level !== 'off');
/** Wire spelling that switches thinking off on the OpenAI-compatible endpoint. */
export const WIRE_NONE = 'none';
/** Wire spelling used for models whose only thinking switch is a boolean `true`. */
export const WIRE_BOOLEAN_ON = 'high';
/**
 * Pin every harness level explicitly: undeclared levels become `null` rather
 * than an absent key, which pi-ai would otherwise read as supported.
 * @param offered - levels the endpoint reports, with their wire spellings.
 * @returns the complete pinned level map.
 */
export function pinEfforts(offered) {
    const pinned = {};
    for (const level of THINKING_LEVELS) {
        const wire = offered[level];
        pinned[level] = wire === undefined ? null : wire;
    }
    return pinned;
}
/**
 * Levels a pinned map offers, in escalation order.
 * @param efforts - a pinned level map.
 * @returns the offered levels.
 */
export function offeredLevels(efforts) {
    return THINKING_LEVELS.filter((level) => efforts[level] !== null);
}
/**
 * Offered levels only, shaped as the configuration-facing effort dict
 * (`Partial` map, no `null` pins). This is the form catalog entries and plugin
 * configuration carry; pinning happens later, when a pi-ai descriptor is built.
 * @param efforts - a pinned level map.
 * @returns the offered levels with their wire spellings.
 */
export function offeredEffortMap(efforts) {
    const offered = {};
    for (const level of offeredLevels(efforts)) {
        const wire = efforts[level];
        if (wire !== null)
            offered[level] = wire;
    }
    return offered;
}
/** Shape-check one raw `thinking` object from `/api/show`. */
function readThinking(thinking) {
    if (thinking === null || typeof thinking !== 'object')
        return undefined;
    const record = thinking;
    if (!Array.isArray(record.values))
        return undefined;
    return { values: record.values, default: record.default };
}
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
export function policyFromThinking(thinking) {
    const parsed = readThinking(thinking);
    if (parsed === undefined)
        return undefined;
    const offered = {};
    const wireToLevel = new Map();
    /** Cursor into THINKABLE_LEVELS: where the next unknown string lands. */
    let cursor = 0;
    for (const value of parsed.values) {
        if (value === false) {
            offered.off = WIRE_NONE;
            wireToLevel.set(WIRE_NONE, 'off');
            continue;
        }
        if (value === true) {
            offered.high ??= WIRE_BOOLEAN_ON;
            wireToLevel.set(WIRE_BOOLEAN_ON, 'high');
            continue;
        }
        if (typeof value !== 'string' || value.length === 0)
            continue;
        const known = THINKING_LEVELS.find((level) => level === value);
        if (known === 'off') {
            // Ollama reports the off switch as `false`; a literal "off" string still
            // means that switch, and the wire spelling stays `none`.
            offered.off = WIRE_NONE;
            wireToLevel.set(value, 'off');
            continue;
        }
        if (known !== undefined) {
            offered[known] = value;
            wireToLevel.set(value, known);
            cursor = Math.max(cursor, THINKABLE_LEVELS.indexOf(known) + 1);
            continue;
        }
        const free = THINKABLE_LEVELS.findIndex((level, index) => index >= cursor && offered[level] === undefined);
        const level = free === -1 ? undefined : THINKABLE_LEVELS[free];
        if (level === undefined)
            continue;
        offered[level] = value;
        wireToLevel.set(value, level);
        cursor = free + 1;
    }
    const efforts = pinEfforts(offered);
    // A model whose only reported value is `false` offers no thinking at all;
    // an `off`-only level map would give selectors a control that changes nothing.
    if (offeredLevels(efforts).every((level) => level === 'off'))
        return undefined;
    let defaultEffort;
    if (parsed.default === false)
        defaultEffort = 'off';
    else if (parsed.default === true)
        defaultEffort = 'high';
    else if (typeof parsed.default === 'string')
        defaultEffort = wireToLevel.get(parsed.default);
    // A default the model does not offer is dropped, not clamped: the provider's
    // own default is the honest fallback, and the harness accepts a missing one.
    if (defaultEffort !== undefined && efforts[defaultEffort] === null)
        defaultEffort = undefined;
    return defaultEffort === undefined ? { efforts } : { efforts, defaultEffort };
}
//# sourceMappingURL=reasoning.js.map