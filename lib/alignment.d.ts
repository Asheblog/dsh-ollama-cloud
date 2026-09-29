/**
 * The pi-ai generation this build speaks, checked against the harness that
 * drives it.
 *
 * The chat protocol this plugin streams with is **its own dependency**
 * (`@earendil-works/pi-ai`), while the adapter that calls it belongs to the
 * harness (`@deepseek-ai/dsh-llm-pi-ai`, a host-shared package the app
 * provides). pi-ai is not a shared package, so nothing keeps the two copies on
 * one generation — and when they drift, the request context they exchange
 * changes shape underneath the route. That drift is not hypothetical: the
 * 0.2.0-rc.2 harness moved the prompt and tool declarations out of the
 * `Context` fields and into the transcript, which made every chat request on
 * the 0.2.0 build of this plugin fail instantly with
 * `Cannot read properties of undefined (reading 'length')`.
 *
 * The route no longer depends on the two copies agreeing (see
 * {@link contextTolerantStreams} in ./profile.ts), but a mismatch still means
 * the harness asks for a contract this build was not written against, so this
 * module turns whatever facts it can reach into one mount-time warning that
 * names the versions. Two limits are deliberate:
 *
 * - **Best effort.** The harness manifest is read through several resolvers
 *   (the host's shared-package resolution, the app's runtime manifest, the
 *   plugin-relative resolver) and any failure is *silence*, never a throw: a
 *   host that hides its manifest must not lose a working route over a
 *   diagnostic. `reportAlignment` logs the loaded version at debug level so the
 *   facts it did reach are still inspectable.
 * - **Build-time first.** A scheduled CI check
 *   (`scripts/check-pi-ai-alignment.mjs`) watches the same boundary against the
 *   published harness, which is the reliable signal; the mount warning only
 *   helps the installations that already carry this code.
 *
 * See docs/adr/0004-pi-ai-generation-alignment.md.
 *
 * @module dsh-ollama-cloud/alignment
 */
/** The pi-ai package both sides of the boundary declare. */
export declare const PI_AI_PACKAGE = "@earendil-works/pi-ai";
/** The harness package whose declaration states the generation in use. */
export declare const HARNESS_PACKAGE = "@deepseek-ai/dsh-llm-pi-ai";
/** The manifests the judgement reads; every one is optional and may fail. */
export interface AlignmentSources {
    /** This plugin's own manifest. */
    readonly self: () => unknown;
    /** The installed harness manifest — the adapter that drives this route. */
    readonly harness: () => unknown;
    /** The pi-ai manifest of the copy this process actually loaded. */
    readonly loaded: () => unknown;
}
/** What the manifests said, with `undefined` for anything unreadable. */
export interface AlignmentFacts {
    /** The pi-ai range this build declares. */
    readonly ownRange?: string | undefined;
    /** The pi-ai range the installed harness declares. */
    readonly harnessRange?: string | undefined;
    /** The installed harness version, for the diagnostic. */
    readonly harnessVersion?: string | undefined;
    /** The version of the pi-ai copy this process loaded, when readable. */
    readonly loadedVersion?: string | undefined;
}
/**
 * Whether a range admits one version, for the range spellings this ecosystem
 * writes (`^0.87.1`, `~0.85.0`, `>=0.85.1 <0.88.0`, `0.87.1`, `||` alternatives).
 *
 * Prerelease ordering is ignored and a bare tag (`next`, `*`) admits nothing —
 * both keep the answer conservative rather than silently claiming alignment.
 * @param range - the dependency range.
 * @param version - the version to test.
 * @returns true/false, or `undefined` when the range cannot be read.
 */
export declare function rangeContainsVersion(range: string | undefined, version: string | undefined): boolean | undefined;
/**
 * Whether two ranges admit any common version.
 *
 * Decided by testing each side's lower bound against the other, which is exact
 * for the caret/tilde/inequality spellings this ecosystem writes and
 * conservative elsewhere (an unreadable side answers `undefined`, never
 * "aligned").
 * @param left - one dependency range.
 * @param right - the other dependency range.
 * @returns true/false, or `undefined` when either range cannot be read.
 */
export declare function rangesOverlap(left: string | undefined, right: string | undefined): boolean | undefined;
/**
 * The `major.minor` generation a range or version names, for diagnostics.
 * @param value - a dependency range or a version.
 * @returns the generation, or `undefined` when the text names no version.
 */
export declare function piAiGeneration(value: string | undefined): string | undefined;
/**
 * Read the harness manifest out of the app's own runtime manifest.
 *
 * The desktop host keeps its shared packages inside `app.asar`, and a profile's
 * `node_modules/@deepseek-ai/*` links can be dangling after an app update — the
 * exact state the 0.2.0 incident left behind (verified on the machine that hit
 * it). Electron's patched `fs` can read inside the archive, so this source asks
 * the runtime manifest where the harness lives instead of trusting the profile's
 * links. Exported for its own tests; nothing else should call it.
 * @returns the harness manifest, or `undefined` when the layout is unreadable.
 */
export declare function harnessManifestFromAsar(): unknown;
/**
 * Collect the alignment facts, treating every unreadable manifest as unknown.
 * @param sources - overrides for the default readers, for tests.
 * @returns the facts the warning is judged from.
 */
export declare function readAlignmentFacts(sources?: Partial<AlignmentSources>): AlignmentFacts;
/**
 * The one warning these facts deserve, if any.
 *
 * Silence is the default: an unreadable fact is not evidence of a mismatch, and
 * a warning that fires on unknown facts would train readers to ignore it. The
 * wording stays factual about what the route can absorb — the context shim
 * keeps a *pre-0.87* harness working, so the mismatch is a warning about the
 * unsupported combination rather than a prediction of failure.
 * @param facts - alignment facts gathered by {@link readAlignmentFacts}.
 * @returns the warning, or `undefined` when nothing disagrees.
 */
export declare function alignmentWarning(facts: AlignmentFacts): string | undefined;
/**
 * Report the alignment facts once, at mount.
 *
 * The warning goes through `logger.warn`; the facts behind it are always
 * inspectable at debug level, because a host that hides its harness manifest
 * makes silence ambiguous.
 * @param logger - the host logger to report through.
 * @param sources - overrides for the default readers, for tests.
 * @returns the warning, when one was logged.
 */
export declare function reportAlignment(logger: {
    warn: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
}, sources?: Partial<AlignmentSources>): string | undefined;
//# sourceMappingURL=alignment.d.ts.map