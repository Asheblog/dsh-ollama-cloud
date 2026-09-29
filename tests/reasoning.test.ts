import { describe, expect, it } from 'vitest'

import { offeredLevels, pinEfforts, policyFromThinking, THINKING_LEVELS } from '../src/reasoning.js'

// Wire metadata copied from live POST https://ollama.com/api/show responses
// (2026-09-29). These are the plugin's source of truth for selectable thinking
// levels; the assertions below derive expectations from that metadata by hand.
describe('policyFromThinking', () => {
  it('maps a false/level list with a named default (deepseek-v4.1-flash)', () => {
    const policy = policyFromThinking({ values: [false, 'low', 'high', 'max'], default: 'high' })
    expect(policy).toBeDefined()
    expect(offeredLevels(policy!.efforts)).toEqual(['off', 'low', 'high', 'max'])
    expect(policy!.efforts.off).toBe('none')
    expect(policy!.efforts.low).toBe('low')
    expect(policy!.efforts.high).toBe('high')
    expect(policy!.efforts.max).toBe('max')
    expect(policy!.defaultEffort).toBe('high')
  })

  it('maps a level list with no off switch (glm-5.3)', () => {
    const policy = policyFromThinking({ values: ['low', 'high', 'max'], default: 'max' })
    expect(offeredLevels(policy!.efforts)).toEqual(['low', 'high', 'max'])
    expect(policy!.efforts.off).toBeNull()
    expect(policy!.defaultEffort).toBe('max')
  })

  it('maps the gpt-oss level ladder (low/medium/high)', () => {
    const policy = policyFromThinking({ values: ['low', 'medium', 'high'], default: 'medium' })
    expect(offeredLevels(policy!.efforts)).toEqual(['low', 'medium', 'high'])
    expect(policy!.defaultEffort).toBe('medium')
  })

  it('maps a boolean model that defaults to thinking on (kimi-k2.6)', () => {
    const policy = policyFromThinking({ values: [false, true], default: true })
    expect(offeredLevels(policy!.efforts)).toEqual(['off', 'high'])
    expect(policy!.efforts.off).toBe('none')
    expect(policy!.efforts.high).toBe('high')
    expect(policy!.defaultEffort).toBe('high')
  })

  it('maps a boolean model that defaults to thinking off (gemma4)', () => {
    const policy = policyFromThinking({ values: [false, true], default: false })
    expect(offeredLevels(policy!.efforts)).toEqual(['off', 'high'])
    expect(policy!.defaultEffort).toBe('off')
  })

  it('maps a thinking-only boolean model with no off switch (minimax-m2.7)', () => {
    const policy = policyFromThinking({ values: [true], default: true })
    expect(offeredLevels(policy!.efforts)).toEqual(['high'])
    expect(policy!.defaultEffort).toBe('high')
  })

  it('reports no policy for models the API marks non-thinking', () => {
    expect(policyFromThinking({ values: [false], default: false })).toBeUndefined()
    expect(policyFromThinking({ values: [], default: false })).toBeUndefined()
    expect(policyFromThinking(undefined)).toBeUndefined()
    expect(policyFromThinking(null)).toBeUndefined()
  })

  it('drops a default the model does not offer instead of materializing it', () => {
    const policy = policyFromThinking({ values: ['low', 'high'], default: 'max' })
    expect(policy!.defaultEffort).toBeUndefined()
  })

  it('assigns unknown string levels to the next free standard level, keeping the wire spelling', () => {
    const policy = policyFromThinking({ values: ['low', 'ultra'], default: 'ultra' })
    expect(offeredLevels(policy!.efforts)).toEqual(['low', 'medium'])
    expect(policy!.efforts.low).toBe('low')
    expect(policy!.efforts.medium).toBe('ultra')
    expect(policy!.defaultEffort).toBe('medium')
  })
})

describe('pinEfforts', () => {
  it('pins every pi-ai level explicitly so an absent key is never guessed as supported', () => {
    const pinned = pinEfforts({ off: 'none', high: 'high' })
    expect(Object.keys(pinned).sort()).toEqual([...THINKING_LEVELS].sort())
    expect(pinned.off).toBe('none')
    expect(pinned.high).toBe('high')
    for (const level of ['minimal', 'low', 'medium', 'xhigh', 'max'] as const) {
      expect(pinned[level]).toBeNull()
    }
  })
})
