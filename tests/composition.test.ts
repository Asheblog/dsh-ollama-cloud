import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { USAGE_CHANNEL_ROW_INJECT } from '../src/index.js'
import { rowById } from './cordis-patch.js'
import { compareSemver, floorOf } from './semver.js'

/**
 * The composition this bundle patches, and the release it belongs to.
 *
 * `dsh-web-app` is a development dependency for exactly this reason: the
 * connection row it declares is the row this package's usage channel needs, and
 * that row's startup dependency moved once already — the `0.2.0` line injected
 * the web-runtime service `webRuntime`, `0.2.1-rc.1` injects `webStartup`. A
 * stale name in `cordis.patch.yml` does not fail a request — it makes a required
 * row wait forever and fails the whole boot, which is not something a user
 * should discover. Reading the installed composition turns that discovery into
 * a red test.
 */
const require = createRequire(import.meta.url)
const COMPOSITION = '@deepseek-ai/dsh-web-app'
const HARNESS = '@deepseek-ai/dsh-llm-pi-ai'

const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const compositionText = readFileSync(require.resolve(`${COMPOSITION}/cordis.patch.yml`), 'utf8')

/** Read one package manifest out of `node_modules`. */
function manifest(specifier: string): Record<string, unknown> {
  return JSON.parse(readFileSync(require.resolve(`${specifier}/package.json`), 'utf8')) as Record<string, unknown>
}

/** Read a nested record, or `undefined` when a level is missing. */
function record(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const nested = (value as Record<string, unknown>)[key]
  return typeof nested === 'object' && nested !== null ? nested as Record<string, unknown> : undefined
}

const own = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>
const harnessVersion = String(manifest(HARNESS).version)
const enginesDsh = record(own, 'engines')?.dsh
const releases = record(record(own, 'dsh'), 'compatibility')?.dshReleases

describe('the connection row this bundle patches', () => {
  it('restates the composition row and adds only the service the channel needs', () => {
    const composition = rowById(compositionText, 'connection')
    const patched = rowById(patchText, 'connection')
    const declared = composition.inject ?? []

    // A patch replaces the whole `inject` array, so every entry the row already
    // carried has to survive, plus `webServer` — the service `rpc.handle()`
    // registers the channel on.
    expect(patched.inject).toBeDefined()
    expect([...(patched.inject ?? [])].sort())
      .toEqual([...new Set([...declared, 'webServer'])].sort())
  })

  it('agrees with the list this package ships and names in its diagnostic', () => {
    // One fact, three artifacts: the constant (used by the mount warning), the
    // bundle patch (what the loader reads), and the composition (what the row
    // must keep injecting).
    expect([...(rowById(patchText, 'connection').inject ?? [])]).toEqual([...USAGE_CHANNEL_ROW_INJECT])
  })

  it('injects only service names this composition speaks', () => {
    for (const name of USAGE_CHANNEL_ROW_INJECT) {
      if (name === 'webServer') continue
      expect(compositionText, `${name} is not a service ${COMPOSITION} uses`).toMatch(new RegExp(`\\b${name}\\b`, 'u'))
    }
    // The startup service was `webRuntime` before 0.2.1-rc.1. If it ever comes
    // back — or moves again — the row's own entry above changes with it.
    expect(compositionText).not.toMatch(/\bwebRuntime\b/u)
  })

  it('patches a row whose `webServer` requirement is real', () => {
    // `webServer` is deliberately absent from the composition's own inject list:
    // the row does not need it for its own wiring, this package's channel does.
    // It is still provided in this composition — without that, the channel could
    // never mount anywhere.
    if (!USAGE_CHANNEL_ROW_INJECT.includes('webServer')) return
    expect(compositionText).toMatch(new RegExp(`name:\\s*'@deepseek-ai/dsh-host-webserver'`, 'u'))
  })
})

describe('declared harness support', () => {
  // The installer judges this package with semver (`dsh-app-boot`:
  // "Prereleases participate in ranges"), so the matrix has to be compared the
  // same way. A triple-only comparison would call `0.2.1-alpha.3` acceptable
  // under `>=0.2.1-rc.1`, which semver does not — and upstream has published
  // alphas of that very release.
  const floor = floorOf(typeof enginesDsh === 'string' ? enginesDsh : undefined)

  it('states its floor in a spelling this test can compare', () => {
    // A compound range would need a comparison the matrix below does not do;
    // failing here is the honest alternative to reading it wrongly.
    expect(floor, `engines.dsh is ${JSON.stringify(enginesDsh)}; expected a single >= floor`).toBeDefined()
  })

  it('admits the harness release the development dependencies pin', () => {
    expect(floor).toBeDefined()
    expect(compareSemver(harnessVersion, floor as string), `${harnessVersion} vs floor ${String(floor)}`)
      .toBeGreaterThanOrEqual(0)
  })

  it('keeps the release matrix consistent with that range', () => {
    expect(floor).toBeDefined()
    expect(releases).toBeDefined()
    const declared = releases as Record<string, unknown>
    for (const [release, status] of Object.entries(declared)) {
      expect(status, `${release} uses an unknown status`).toMatch(/^(compatible|incompatible)$/u)
      const order = compareSemver(release, floor as string)
      expect(order, `${release} is not a version this test can compare`).toBeDefined()
      expect((order as number) >= 0, `${release} disagrees with engines.dsh`).toBe(status === 'compatible')
    }
    // Moving the development dependencies to a new harness release must also say
    // something about that release here, which is what keeps this matrix honest.
    expect(Object.keys(declared)).toContain(harnessVersion)
  })

  it('develops against one harness release train', () => {
    // The composition that declares the patched row and the adapter that drives
    // this plugin's chat route ship together; a split would mean the patch was
    // verified against a composition the route does not run on.
    expect(String(manifest(COMPOSITION).version)).toBe(harnessVersion)
  })
})
