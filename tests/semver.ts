/**
 * Version ordering for the manifest release matrix.
 *
 * `src/alignment.ts` deliberately compares **triples only**: it answers "do two
 * dependency ranges admit a common generation", where a prerelease tag is noise.
 * That is the wrong instrument for `dsh.compatibility.dshReleases`, whose
 * verdicts have to agree with the installer's own semver judgement — and there
 * `0.2.1-alpha.3` sits *below* `0.2.1-rc.1`, while a triple comparison calls
 * them equal. Upstream has published `0.2.1-alpha.*`, so the difference is not
 * hypothetical.
 *
 * This module implements exactly what that judgement needs — semver precedence
 * including prerelease identifiers — and nothing else (no ranges, no build
 * metadata). A range spelling it does not understand answers `undefined`, which
 * the test treats as a failure rather than as agreement.
 *
 * @module dsh-ollama-cloud/tests/semver
 */

/** One parsed `major.minor.patch[-pre]` version. */
interface ParsedVersion {
  readonly core: readonly [number, number, number]
  /** Prerelease identifiers in order; empty for a release version. */
  readonly pre: readonly string[]
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u

/** Parse one version, or `undefined` when it is not a plain semver version. */
function parse(value: string): ParsedVersion | undefined {
  const match = VERSION.exec(value.trim())
  if (match === null) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : (match[4].split('.').filter((part) => part.length > 0)),
  }
}

/** Whether a prerelease identifier is numeric (compared as a number, not a string). */
function isNumeric(identifier: string): boolean {
  return /^\d+$/u.test(identifier)
}

/** Order two prerelease identifiers per semver; a release sorts above any prerelease. */
function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue
    const numericA = isNumeric(a)
    const numericB = isNumeric(b)
    if (numericA && numericB) {
      const difference = Number(a) - Number(b)
      if (difference !== 0) return difference < 0 ? -1 : 1
      continue
    }
    // Numeric identifiers sort below alphanumeric ones.
    if (numericA) return -1
    if (numericB) return 1
    return a < b ? -1 : 1
  }
  return 0
}

/**
 * Compare two versions by semver precedence.
 * @param left - one version, for example `0.2.1-rc.3`.
 * @param right - the other version.
 * @returns negative, zero, or positive like a comparator, or `undefined` when
 *   either side is not a plain semver version.
 */
export function compareSemver(left: string, right: string): number | undefined {
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return comparePrerelease(a.pre, b.pre)
}

/**
 * The floor a single-comparator range states.
 *
 * The supported spelling is the one this package writes (`>=1.2.3`); anything
 * else answers `undefined` so a compound range has to come with a comparison
 * this test actually understands, instead of being silently misread.
 * @param range - a dependency range from a manifest.
 * @returns the floor version, or `undefined` for any other spelling.
 */
export function floorOf(range: string | undefined): string | undefined {
  if (range === undefined) return undefined
  const match = /^>=\s*(\S+)$/u.exec(range.trim())
  return match?.[1] === undefined ? undefined : match[1]
}
