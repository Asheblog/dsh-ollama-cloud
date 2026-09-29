import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  alignmentWarning,
  harnessManifestFromAsar,
  piAiGeneration,
  rangeContainsVersion,
  rangesOverlap,
  readAlignmentFacts,
  reportAlignment,
} from '../src/alignment.js'
import { HARNESS_RANGE, installedPiAiVersion, OWN_RANGE } from './helpers.js'

describe('piAiGeneration', () => {
  it('reads the major.minor generation out of the range spellings this ecosystem writes', () => {
    expect(piAiGeneration('^0.87.1')).toBe('0.87')
    expect(piAiGeneration('~0.85.0')).toBe('0.85')
    expect(piAiGeneration('0.87.1')).toBe('0.87')
    expect(piAiGeneration('>=0.87.1 <0.88.0')).toBe('0.87')
  })

  it('answers undefined for a range that names no version', () => {
    expect(piAiGeneration(undefined)).toBeUndefined()
    expect(piAiGeneration('')).toBeUndefined()
    expect(piAiGeneration('workspace:*')).toBeUndefined()
    expect(piAiGeneration('next')).toBeUndefined()
  })
})

describe('rangeContainsVersion', () => {
  it('reads caret, tilde, comparator and exact ranges', () => {
    expect(rangeContainsVersion('^0.87.1', '0.87.1')).toBe(true)
    expect(rangeContainsVersion('^0.87.1', '0.87.9')).toBe(true)
    expect(rangeContainsVersion('^0.87.1', '0.88.0')).toBe(false)
    expect(rangeContainsVersion('^0.85.1', '0.87.1')).toBe(false)
    expect(rangeContainsVersion('~0.85.1', '0.85.9')).toBe(true)
    expect(rangeContainsVersion('~0.85.1', '0.86.0')).toBe(false)
    expect(rangeContainsVersion('>=0.85.1 <0.88.0', '0.87.1')).toBe(true)
    expect(rangeContainsVersion('>=0.85.1 <0.88.0', '0.88.0')).toBe(false)
    expect(rangeContainsVersion('0.87.1', '0.87.1')).toBe(true)
    expect(rangeContainsVersion('0.87.1', '0.87.2')).toBe(false)
    expect(rangeContainsVersion('^0.85.1 || ^0.87.1', '0.87.1')).toBe(true)
  })

  it('answers undefined rather than guessing when a side cannot be read', () => {
    expect(rangeContainsVersion('next', '0.87.1')).toBeUndefined()
    expect(rangeContainsVersion(undefined, '0.87.1')).toBeUndefined()
    expect(rangeContainsVersion('^0.87.1', undefined)).toBeUndefined()
  })
})

describe('rangesOverlap', () => {
  it('accepts every spelling that admits the harness generation', () => {
    expect(rangesOverlap('^0.87.1', '^0.87.1')).toBe(true)
    expect(rangesOverlap('>=0.85.1 <0.88.0', '^0.87.1')).toBe(true)
    expect(rangesOverlap('^0.85.1 || ^0.87.1', '^0.87.1')).toBe(true)
  })

  it('rejects the pair the 0.2.0 build shipped', () => {
    expect(rangesOverlap('^0.85.1', '^0.87.1')).toBe(false)
  })

  it('answers undefined when either side is unreadable', () => {
    expect(rangesOverlap('next', '^0.87.1')).toBeUndefined()
    expect(rangesOverlap('^0.87.1', undefined)).toBeUndefined()
  })
})

describe('alignmentWarning', () => {
  it('stays silent while the harness declaration is unreadable', () => {
    expect(alignmentWarning({ ownRange: OWN_RANGE })).toBeUndefined()
    expect(alignmentWarning({})).toBeUndefined()
  })

  it('stays silent when the declarations admit a common version', () => {
    expect(alignmentWarning({
      ownRange: OWN_RANGE,
      harnessRange: HARNESS_RANGE,
      harnessVersion: '0.2.0-rc.2',
      loadedVersion: installedPiAiVersion(),
    })).toBeUndefined()
  })

  it('names the harness, the range and the loaded copy when the loaded copy does not fit', () => {
    const warning = alignmentWarning({
      ownRange: OWN_RANGE,
      harnessRange: HARNESS_RANGE,
      harnessVersion: '0.2.0-rc.2',
      loadedVersion: '0.85.1',
    })
    expect(warning).toContain('0.85.1')
    expect(warning).toContain(HARNESS_RANGE)
    expect(warning).toContain('0.2.0-rc.2')
  })

  it('reports a declared range that cannot admit the harness generation', () => {
    const warning = alignmentWarning({
      ownRange: '^0.85.1',
      harnessRange: HARNESS_RANGE,
      harnessVersion: '0.2.0-rc.2',
    })
    expect(warning).toContain('^0.85.1')
    expect(warning).toContain(HARNESS_RANGE)
  })
})

describe('readAlignmentFacts', () => {
  it('reads this build’s declaration, the installed harness declaration, and the loaded copy', () => {
    const facts = readAlignmentFacts()
    expect(facts.ownRange).toBe(OWN_RANGE)
    expect(facts.harnessRange).toBe(HARNESS_RANGE)
    // The loaded patch version moves with every legitimate pi-ai upgrade; the
    // generation is what the boundary cares about.
    expect(piAiGeneration(facts.loadedVersion)).toBe(piAiGeneration(HARNESS_RANGE))
    expect(alignmentWarning(facts)).toBeUndefined()
  })

  it('treats a manifest that declares no pi-ai range as unknown, not as a mismatch', () => {
    const empty = () => ({})
    const facts = readAlignmentFacts({ self: empty, harness: empty, loaded: empty })
    expect(facts).toEqual({
      ownRange: undefined,
      harnessRange: undefined,
      harnessVersion: undefined,
      loadedVersion: undefined,
    })
    expect(alignmentWarning(facts)).toBeUndefined()
  })

  it('falls through to the next resolver when one cannot read the manifest', () => {
    const failing = () => {
      throw new Error('no manifest')
    }
    // A host that hides the harness from one resolver must not lose the facts a
    // later one can still reach; only *every* resolver failing is "unknown".
    expect(readAlignmentFacts({ harness: failing }).harnessRange).toBe(HARNESS_RANGE)
  })
})

describe('harnessManifestFromAsar', () => {
  /** Build the desktop host's archive layout in a temporary directory. */
  function fakeAppRoot(runtimeManifest: unknown): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-asar-'))
    mkdirSync(join(root, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai'), { recursive: true })
    writeFileSync(join(root, 'app.asar', 'dsh', 'desktop-runtime.json'), JSON.stringify(runtimeManifest))
    writeFileSync(
      join(root, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh-llm-pi-ai', version: '0.9.9', dependencies: { '@earendil-works/pi-ai': '^0.99.1' } }),
    )
    return root
  }

  /** Run one body with `process.resourcesPath` pointed at `root`. */
  function withResources<T>(root: string, body: () => T): T {
    const previous = (process as { resourcesPath?: string }).resourcesPath
    ;(process as { resourcesPath?: string }).resourcesPath = root
    try {
      return body()
    } finally {
      ;(process as { resourcesPath?: string }).resourcesPath = previous
    }
  }

  it('reads the harness manifest through the app runtime manifest', () => {
    const root = fakeAppRoot({
      sharedPackages: [
        { name: '@deepseek-ai/dsh-llm-pi-ai', version: '0.9.9', path: 'node_modules/@deepseek-ai/dsh-llm-pi-ai' },
      ],
    })
    try {
      withResources(root, () => {
        // The desktop host keeps shared packages in the archive while a
        // profile's links can be dangling — the state the incident left behind.
        expect(harnessManifestFromAsar()).toMatchObject({
          version: '0.9.9',
          dependencies: { '@earendil-works/pi-ai': '^0.99.1' },
        })
        const facts = readAlignmentFacts({ harness: harnessManifestFromAsar })
        expect(facts.harnessRange).toBe('^0.99.1')
        expect(facts.harnessVersion).toBe('0.9.9')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers undefined when the runtime manifest does not name the harness', () => {
    const root = fakeAppRoot({ sharedPackages: [{ name: '@deepseek-ai/dsh-llm', path: 'node_modules/@deepseek-ai/dsh-llm' }] })
    try {
      withResources(root, () => expect(harnessManifestFromAsar()).toBeUndefined())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers undefined outside an Electron host', () => {
    expect(harnessManifestFromAsar()).toBeUndefined()
  })
})

describe('reportAlignment', () => {
  const harness = () => ({
    version: '0.2.0-rc.2',
    dependencies: { '@earendil-works/pi-ai': HARNESS_RANGE },
  })

  it('logs nothing but its debug facts when the declarations line up', () => {
    const warns: unknown[][] = []
    const debugs: unknown[][] = []
    const warned = reportAlignment(
      { warn: (...args: unknown[]) => warns.push(args), debug: (...args: unknown[]) => debugs.push(args) },
      {
        self: () => ({ dependencies: { '@earendil-works/pi-ai': OWN_RANGE } }),
        harness,
        loaded: () => ({ name: '@earendil-works/pi-ai', version: installedPiAiVersion() }),
      },
    )
    expect(warned).toBeUndefined()
    expect(warns).toHaveLength(0)
    expect(debugs).toHaveLength(1)
  })

  it('logs the warning it returns', () => {
    const warns: unknown[][] = []
    const warned = reportAlignment({ warn: (...args: unknown[]) => warns.push(args) }, {
      self: () => ({ dependencies: { '@earendil-works/pi-ai': '^0.85.1' } }),
      harness,
      loaded: () => ({ name: '@earendil-works/pi-ai', version: '0.85.1' }),
    })
    expect(warned).toBeDefined()
    expect(warns).toHaveLength(1)
    expect(warns[0]?.[0]).toContain('pi-ai')
  })
})

