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

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The pi-ai package both sides of the boundary declare. */
export const PI_AI_PACKAGE = '@earendil-works/pi-ai'

/** The harness package whose declaration states the generation in use. */
export const HARNESS_PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'

/** One parsed `major.minor.patch` triple. */
type Triple = readonly [number, number, number]

/** The manifests the judgement reads; every one is optional and may fail. */
export interface AlignmentSources {
  /** This plugin's own manifest. */
  readonly self: () => unknown
  /** The installed harness manifest — the adapter that drives this route. */
  readonly harness: () => unknown
  /** The pi-ai manifest of the copy this process actually loaded. */
  readonly loaded: () => unknown
}

/** What the manifests said, with `undefined` for anything unreadable. */
export interface AlignmentFacts {
  /** The pi-ai range this build declares. */
  readonly ownRange?: string | undefined
  /** The pi-ai range the installed harness declares. */
  readonly harnessRange?: string | undefined
  /** The installed harness version, for the diagnostic. */
  readonly harnessVersion?: string | undefined
  /** The version of the pi-ai copy this process loaded, when readable. */
  readonly loadedVersion?: string | undefined
}

const TRIPLE = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/u

/** Parse the first version-like triple of a range or version, ignoring prerelease tags. */
function parseTriple(value: string | undefined): Triple | undefined {
  const match = TRIPLE.exec(value ?? '')
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

/** Order two triples. */
function compare(left: Triple, right: Triple): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** One comparator alternative's admitted interval, or `undefined` when unreadable. */
function alternativeInterval(alternative: string): { min?: Triple; max?: Triple; maxExclusive: boolean } | undefined {
  const text = alternative.trim()
  if (text.length === 0) return undefined
  const comparators = text.split(/\s+/u)
  const interval: { min?: Triple; max?: Triple; maxExclusive: boolean } = { maxExclusive: false }
  for (const comparator of comparators) {
    const caret = /^\^(\S+)$/u.exec(comparator)
    const tilde = /^~(\S+)$/u.exec(comparator)
    const atLeast = /^>=\s*(\S+)$/u.exec(comparator) ?? /^>(\S+)$/u.exec(comparator)
    const atMost = /^<=\s*(\S+)$/u.exec(comparator) ?? /^<(\S+)$/u.exec(comparator)
    if (caret !== null) {
      const base = parseTriple(caret[1])
      if (base === undefined) return undefined
      interval.min = base
      // `^0.x.y` admits the whole 0.x line; `^1.x.y` admits the major line.
      interval.max = base[0] === 0 ? [0, base[1] + 1, 0] : [base[0] + 1, 0, 0]
      interval.maxExclusive = true
      continue
    }
    if (tilde !== null) {
      const base = parseTriple(tilde[1])
      if (base === undefined) return undefined
      interval.min = base
      interval.max = [base[0], base[1] + 1, 0]
      interval.maxExclusive = true
      continue
    }
    if (atLeast !== null) {
      const base = parseTriple(atLeast[1])
      if (base === undefined) return undefined
      interval.min = base
      continue
    }
    if (atMost !== null) {
      const base = parseTriple(atMost[1])
      if (base === undefined) return undefined
      interval.max = base
      interval.maxExclusive = comparator.startsWith('<=') ? false : true
      continue
    }
    const exact = parseTriple(comparator)
    if (exact === undefined) return undefined
    interval.min = exact
    interval.max = exact
    interval.maxExclusive = false
  }
  return interval.min === undefined && interval.max === undefined ? undefined : interval
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
export function rangeContainsVersion(range: string | undefined, version: string | undefined): boolean | undefined {
  const target = parseTriple(version)
  if (range === undefined || target === undefined) return undefined
  let read = false
  for (const alternative of range.split('||')) {
    const interval = alternativeInterval(alternative)
    if (interval === undefined) continue
    read = true
    const aboveFloor = interval.min === undefined || compare(target, interval.min) >= 0
    const belowCeiling = interval.max === undefined
      || (interval.maxExclusive ? compare(target, interval.max) < 0 : compare(target, interval.max) <= 0)
    if (aboveFloor && belowCeiling) return true
  }
  return read ? false : undefined
}

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
export function rangesOverlap(left: string | undefined, right: string | undefined): boolean | undefined {
  // Each side's floor is its first version triple, which `rangeContainsVersion`
  // reads for us; a side with no readable version stays unknown.
  const forward = rangeContainsVersion(left, right)
  const backward = rangeContainsVersion(right, left)
  if (forward === undefined || backward === undefined) return undefined
  return forward || backward
}

/**
 * The `major.minor` generation a range or version names, for diagnostics.
 * @param value - a dependency range or a version.
 * @returns the generation, or `undefined` when the text names no version.
 */
export function piAiGeneration(value: string | undefined): string | undefined {
  const triple = parseTriple(value)
  return triple === undefined ? undefined : `${triple[0]}.${triple[1]}`
}

/** Read one string dependency range out of an untyped manifest. */
function dependencyRange(manifest: unknown, name: string): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const dependencies = (manifest as { dependencies?: unknown }).dependencies
  if (typeof dependencies !== 'object' || dependencies === null) return undefined
  const range = (dependencies as Record<string, unknown>)[name]
  return typeof range === 'string' && range.length > 0 ? range : undefined
}

/** Read one string `version` out of an untyped manifest. */
function manifestVersion(manifest: unknown): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const version = (manifest as { version?: unknown }).version
  return typeof version === 'string' && version.length > 0 ? version : undefined
}

/** Read one package manifest through the host's CommonJS resolver. */
function requireManifest(specifier: string): unknown {
  return createRequire(import.meta.url)(specifier)
}

/**
 * Read the harness manifest through the ESM resolver.
 *
 * This is the resolver the plugin's own `@deepseek-ai/*` imports go through, so
 * it reaches the host's shared packages even where the profile's
 * `node_modules` links are dangling; the harness manifest exports
 * `./package.json`, which keeps the read to one resolve.
 * @returns the harness manifest, or `undefined` when the resolver cannot see it.
 */
function resolveHarnessManifest(): unknown {
  const entry = import.meta.resolve(`${HARNESS_PACKAGE}/package.json`)
  return JSON.parse(readFileSync(fileURLToPath(entry), 'utf8'))
}

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
export function harnessManifestFromAsar(): unknown {
  const resources = (process as { resourcesPath?: unknown }).resourcesPath
  if (typeof resources !== 'string' || resources.length === 0) return undefined
  const read = (relative: string): unknown =>
    JSON.parse(readFileSync(join(resources, relative), 'utf8').replace(/^﻿/u, ''))
  const runtime = read('app.asar/dsh/desktop-runtime.json') as { sharedPackages?: unknown }
  const shared = Array.isArray(runtime.sharedPackages) ? runtime.sharedPackages : []
  const entry = shared.find(
    (candidate): candidate is { path: string } =>
      typeof candidate === 'object' && candidate !== null
      && (candidate as { name?: unknown }).name === HARNESS_PACKAGE
      && typeof (candidate as { path?: unknown }).path === 'string',
  )
  if (entry === undefined) return undefined
  return read(join('app.asar/dsh', entry.path, 'package.json'))
}

/** Read one manifest by trying each resolver in turn, `undefined` when all fail. */
function firstManifest(sources: readonly ((() => unknown) | undefined)[]): unknown {
  for (const source of sources) {
    if (source === undefined) continue
    try {
      const manifest = source()
      if (manifest !== undefined) return manifest
    } catch {
      // The next resolver gets its turn; an unreadable manifest is not evidence.
    }
  }
  return undefined
}

/**
 * Collect the alignment facts, treating every unreadable manifest as unknown.
 * @param sources - overrides for the default readers, for tests.
 * @returns the facts the warning is judged from.
 */
export function readAlignmentFacts(sources: Partial<AlignmentSources> = {}): AlignmentFacts {
  const self = firstManifest([sources.self, () => requireManifest('../package.json')])
  const harness = firstManifest([
    sources.harness,
    () => requireManifest(`${HARNESS_PACKAGE}/package.json`),
    resolveHarnessManifest,
    harnessManifestFromAsar,
  ])
  const loaded = firstManifest([
    sources.loaded,
    () => {
      const entry = import.meta.resolve(PI_AI_PACKAGE)
      const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', entry)), 'utf8')) as unknown
      // The entry must still live one level under the package root; a package
      // that moved it would otherwise answer with the wrong manifest, and a
      // wrong "loaded version" is worse than an unknown one.
      return typeof manifest === 'object' && manifest !== null
        && (manifest as { name?: unknown }).name === PI_AI_PACKAGE
        ? manifest
        : undefined
    },
  ])
  return {
    ownRange: dependencyRange(self, PI_AI_PACKAGE),
    harnessRange: dependencyRange(harness, PI_AI_PACKAGE),
    harnessVersion: manifestVersion(harness),
    loadedVersion: manifestVersion(loaded),
  }
}

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
export function alignmentWarning(facts: AlignmentFacts): string | undefined {
  if (facts.harnessRange === undefined) return undefined
  const harness = `${HARNESS_PACKAGE} ${facts.harnessVersion ?? '(installed)'}`
  const loadedFits = facts.loadedVersion === undefined
    ? undefined
    : rangeContainsVersion(facts.harnessRange, facts.loadedVersion)
  const declaredFits = facts.ownRange === undefined
    ? undefined
    : rangesOverlap(facts.ownRange, facts.harnessRange)
  const detail = `the harness speaks pi-ai ${facts.harnessRange} (${harness}),`
    + ` this build declares ${facts.ownRange ?? 'nothing'}`
    + `${facts.loadedVersion === undefined ? '' : ` and loaded ${facts.loadedVersion}`}`
  if (loadedFits === false) {
    return `llm-ollama-cloud: pi-ai generation mismatch — ${detail}. The route normalizes the `
      + 'request context, so this usually still works, but the pair is outside the verified '
      + 'support matrix; install the plugin release built for this harness generation '
      + '(see docs/adr/0004-pi-ai-generation-alignment.md).'
  }
  if (declaredFits === false) {
    return `llm-ollama-cloud: pi-ai generation mismatch — ${detail}. The route normalizes the `
      + 'request context, so this usually still works, but a harness from a newer generation '
      + 'than this build may break the request; install the plugin release built for it '
      + '(see docs/adr/0004-pi-ai-generation-alignment.md).'
  }
  return undefined
}

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
export function reportAlignment(
  logger: { warn: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void },
  sources: Partial<AlignmentSources> = {},
): string | undefined {
  const facts = readAlignmentFacts(sources)
  logger.debug?.(
    'llm-ollama-cloud: pi-ai alignment facts',
    JSON.stringify({
      ownRange: facts.ownRange,
      harnessRange: facts.harnessRange,
      harnessVersion: facts.harnessVersion,
      loadedVersion: facts.loadedVersion,
    }),
  )
  const warning = alignmentWarning(facts)
  if (warning !== undefined) logger.warn(warning)
  return warning
}
