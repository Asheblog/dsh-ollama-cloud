#!/usr/bin/env node
/**
 * Prove — or disprove — that two harness releases carry the same contract.
 *
 * A `0.2.1-rc.N` bump moves every `@deepseek-ai/dsh-*` package on the train at
 * once, and most of those bumps change nothing but the release token. Declaring
 * a new release compatible on the strength of its version number alone is what
 * shipped 0.4.0–0.4.2: `0.2.1-rc.1` had renamed the composition's startup
 * service, the range admitted it, and the whole boot failed. Declaring nothing
 * until a user reports it is the other failure mode — the desktop app follows a
 * channel, so the plugin goes stale on its own.
 *
 * This script gives the middle answer a definition: a release is admissible
 * when every harness package this plugin compiles against is *contract
 * identical* to the release already admitted. Concretely, for each package:
 *
 *   1. the set of shipped files is identical,
 *   2. every file other than `package.json` is byte-identical,
 *   3. `package.json` is deep-equal once the release token (`-rc.N` on the
 *      `from` train) is normalized.
 *
 * A different version of a *transitive* dependency counts as drift here — it is
 * exactly how a contract change hides from a reader who only diffs the surface
 * the plugin calls.
 *
 * Usage:
 *
 *   pnpm run check:contract 0.2.1-rc.3 0.2.1-rc.5
 *   pnpm run check:contract 0.2.1-rc.4 0.2.1-rc.5 --keep
 *
 * Needs network (it packs the releases from the registry) and `tar`, so it is a
 * release-admission tool, not part of `pnpm check`. The guards that run on every
 * `pnpm test` stay where they are: `tests/composition.test.ts` compares the
 * bundle patch with the installed composition and with the release matrix.
 *
 * See docs/adr/0009-harness-release-admission.md.
 */
import { execFileSync } from 'node:child_process'
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const keep = process.argv.includes('--keep')
const [from, to] = process.argv.slice(2).filter((arg) => arg !== '--keep')

if (!from || !to) {
  console.error('usage: compare-harness-contract.mjs <from-version> <to-version> [--keep]')
  process.exit(2)
}

/**
 * The release token of the train `from` belongs to, e.g. `0\.2\.2-rc\.N` for
 * `0.2.2-rc.1`.
 *
 * The comparison normalizes the release token and only the release token (ADR
 * 0009), so which token that is has to come from the argument the caller named.
 * It used to be the literal `0.2.1-rc.N`: correct while this plugin sat on that
 * train, and silently wrong the moment the train moved — every manifest then
 * differed on `version` alone and the release read as drift. Deriving it from
 * `from` also keeps a cross-train comparison conservative: a `to` on another
 * train keeps its own token, so it still reports as a finding.
 */
function releaseToken(version) {
  const train = version.replace(/\.\d+$/u, '')
  const escaped = train.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`${escaped}\\.\\d+`, 'gu')
}

const TOKEN = releaseToken(from)

/** Every `@deepseek-ai/dsh-*` package this plugin declares, from either list. */
const candidates = [...new Set([
  ...Object.keys(own.devDependencies ?? {}),
  ...Object.keys(own.peerDependencies ?? {}),
])].filter((name) => name.startsWith('@deepseek-ai/dsh-')).sort()

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const shell = process.platform === 'win32'
const work = mkdtempSync(join(tmpdir(), 'dsh-harness-contract-'))

/** Pack one package at one version, extract it, and return its `package/` root. */
function fetchPackage(name, version) {
  const slug = name.replace(/^@[^/]+\//u, '')
  const dest = join(work, `${slug}-${version}`)
  const extracted = join(dest, 'package')
  if (existsSync(extracted)) return extracted

  execFileSync(npm, ['pack', `${name}@${version}`, '--pack-destination', work], {
    encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'ignore'],
  })

  // npm names the tarball after the package; the scope separator becomes `-`.
  const expected = `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`
  const tarball = join(work, expected)
  if (!existsSync(tarball)) return undefined

  mkdirSync(dest, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', dest], { stdio: 'ignore' })
  return existsSync(extracted) ? extracted : undefined
}

/** Relative paths of every regular file under `dir`. */
function files(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, base, out)
    else out.push(relative(base, full).replace(/\\/gu, '/'))
  }
  return out.sort()
}

/** Recursively normalize the release token out of string values, sorting keys. */
function normalize(value) {
  if (typeof value === 'string') return value.replace(TOKEN, '0.0.0-rc.X')
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
  }
  return value
}

/** The manifest version a package was packed at. */
function stamp(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
}

/** Whether a manifest value is a flat name -> specifier table. */
function isTable(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

/**
 * Compare one package across the two releases. Returns the findings — an empty
 * list is the claim this script exists to check.
 */
function compare(before, after) {
  const filesBefore = files(before)
  const filesAfter = files(after)
  const findings = []

  const onlyBefore = filesBefore.filter((file) => !filesAfter.includes(file))
  const onlyAfter = filesAfter.filter((file) => !filesBefore.includes(file))
  if (onlyBefore.length > 0) findings.push(`shipped only in ${from}: ${onlyBefore.join(', ')}`)
  if (onlyAfter.length > 0) findings.push(`shipped only in ${to}: ${onlyAfter.join(', ')}`)

  const changed = filesBefore
    .filter((file) => filesAfter.includes(file))
    .filter((file) => !readFileSync(join(before, file)).equals(readFileSync(join(after, file))))

  const content = changed.filter((file) => file !== 'package.json')
  if (content.length > 0) findings.push(`content changed: ${content.join(', ')}`)

  if (changed.includes('package.json')) {
    const manifestBefore = normalize(JSON.parse(readFileSync(join(before, 'package.json'), 'utf8')))
    const manifestAfter = normalize(JSON.parse(readFileSync(join(after, 'package.json'), 'utf8')))
    for (const key of new Set([...Object.keys(manifestBefore), ...Object.keys(manifestAfter)])) {
      const a = manifestBefore[key]
      const b = manifestAfter[key]
      if (JSON.stringify(a) === JSON.stringify(b)) continue

      // A dependency table is the common case and its one-line JSON is unreadable:
      // name the entries that moved instead of dumping both objects.
      if (isTable(a) && isTable(b)) {
        const entries = new Set([...Object.keys(a), ...Object.keys(b)])
        const moved = [...entries]
          .filter((entry) => a[entry] !== b[entry])
          .map((entry) => `${entry}: ${a[entry] ?? '(absent)'} -> ${b[entry] ?? '(absent)'}`)
        if (moved.length > 0) {
          findings.push(`manifest.${key} moved:\n       ${moved.join('\n       ')}`)
          continue
        }
      }
      findings.push(`manifest.${key} differs beyond the release token: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
    }
  }

  // A package pinned at the same version on both sides would pass the checks
  // above while proving nothing about `to`, so it is a finding, not a pass.
  if (stamp(before) === stamp(after)) findings.push(`both sides are ${stamp(before)}; nothing was compared`)

  return findings
}

const skipped = []
const drifted = []
let checked = 0

for (const name of candidates) {
  const before = fetchPackage(name, from)
  if (before === undefined) {
    skipped.push(`${name} (not published at ${from})`)
    continue
  }
  const after = fetchPackage(name, to)
  if (after === undefined) {
    drifted.push(`${name}: published at ${from} but not at ${to}`)
    continue
  }

  checked += 1
  const findings = compare(before, after)
  if (findings.length === 0) {
    console.log(`ok   ${name}`)
  } else {
    console.log(`FAIL ${name}`)
    for (const finding of findings) console.log(`     ${finding}`)
    drifted.push(`${name}: ${findings.length} finding(s)`)
  }
}

if (keep) console.log(`\nsources kept in ${work}`)
else rmSync(work, { recursive: true, force: true })

for (const entry of skipped) console.log(`skip ${entry}`)

if (checked === 0) {
  console.error(`\ncompare-harness-contract: nothing to compare between ${from} and ${to}`)
  process.exit(1)
}

if (drifted.length > 0) {
  console.error(`\ncompare-harness-contract: ${to} is NOT contract identical to ${from}.
  ${drifted.join('\n  ')}

The contract moved, so this is not a version-support bump: diff the packages above,
decide whether this plugin's code, bundle patch, or pi-ai range has to follow, and
only then add \`${to}\` to \`dsh.compatibility.dshReleases\` (ADR 0009).`)
  process.exit(1)
}

const summary = `${checked} harness package(s) are contract identical between ${from} and ${to}`
console.log(`\ncompare-harness-contract: ${summary}`)
if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
}
