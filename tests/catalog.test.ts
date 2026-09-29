import { describe, expect, it } from 'vitest'

import { DEFAULT_MODELS } from '../src/catalog.js'
import { THINKING_LEVELS } from '../src/reasoning.js'

// Expected values were read from live GET https://ollama.com/api/tags and
// POST https://ollama.com/api/show responses on 2026-09-29, not from this
// package's own code.
describe('DEFAULT_MODELS', () => {
  it('ships the curated cloud catalog snapshot', () => {
    expect(DEFAULT_MODELS.map((model) => model.id)).toEqual([
      'deepseek-v4.1-flash',
      'deepseek-v4-pro:0813',
      'kimi-k3',
      'kimi-k2.6',
      'kimi-k2.7-code',
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.2',
      'gpt-oss:120b',
      'gpt-oss:20b',
      'minimax-m3',
      'minimax-m2.7',
      'nemotron-3-ultra',
      'nemotron-3-super',
      'nemotron-3-nano:30b',
      'gemma4:31b',
      'mistral-large-3:675b',
    ])
  })

  it('keeps every entry structurally sound', () => {
    const ids = new Set<string>()
    for (const model of DEFAULT_MODELS) {
      expect(model.id.length).toBeGreaterThan(0)
      expect(ids.has(model.id)).toBe(false)
      ids.add(model.id)
      expect(model.name === undefined || model.name.length > 0).toBe(true)
      expect(model.contextWindow === undefined || model.contextWindow > 0).toBe(true)
      const efforts = model.reasoningEfforts
      if (efforts === undefined || efforts === false) continue
      const levels = Object.keys(efforts)
      expect(levels.length).toBeGreaterThan(0)
      for (const level of levels) {
        expect(THINKING_LEVELS).toContain(level)
        expect(typeof efforts[level as (typeof THINKING_LEVELS)[number]]).toBe('string')
      }
      expect(levels.some((level) => level !== 'off')).toBe(true)
      if (model.defaultEffort !== undefined) expect(levels).toContain(model.defaultEffort)
    }
  })

  it('matches the live metadata for representative models', () => {
    const byId = new Map(DEFAULT_MODELS.map((model) => [model.id, model]))

    expect(byId.get('deepseek-v4.1-flash')).toMatchObject({
      name: 'DeepSeek V4.1 Flash',
      contextWindow: 1048576,
      vision: true,
      reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
      defaultEffort: 'high',
    })
    expect(byId.get('gpt-oss:120b')).toMatchObject({
      contextWindow: 131072,
      reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' },
      defaultEffort: 'medium',
    })
    expect(byId.get('glm-5.3')).toMatchObject({
      reasoningEfforts: { low: 'low', high: 'high', max: 'max' },
      defaultEffort: 'max',
    })
    expect(byId.get('gemma4:31b')).toMatchObject({
      reasoningEfforts: { off: 'none', high: 'high' },
      defaultEffort: 'off',
    })
    expect(byId.get('minimax-m2.7')).toMatchObject({
      reasoningEfforts: { high: 'high' },
      defaultEffort: 'high',
    })
    expect(byId.get('minimax-m3')?.reasoningEfforts).toEqual({ off: 'none', high: 'high' })
    expect(byId.get('mistral-large-3:675b')?.reasoningEfforts).toBe(false)
    expect(byId.get('nemotron-3-super')?.contextWindow).toBe(262144)
  })
})
