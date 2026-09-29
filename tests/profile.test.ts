import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_TOKENS, resolveConnection } from '../src/config.js'
import { createOllamaCloudAuth, createPiAiProfile, toPiAiModel } from '../src/profile.js'

const connection = resolveConnection({})

/** Resolve one built-in model, failing the test when the catalog changes shape. */
function model(id: string) {
  const found = connection.models.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`catalog lost ${id}`)
  return found
}

describe('toPiAiModel', () => {
  it('builds an OpenAI Chat Completions descriptor with the pinned level map', () => {
    const descriptor = toPiAiModel(model('glm-5.3'), connection, 'https://ollama.com/v1')
    expect(descriptor).toMatchObject({
      id: 'glm-5.3',
      name: 'GLM-5.3',
      api: 'openai-completions',
      provider: 'ollama-cloud',
      baseUrl: 'https://ollama.com/v1',
      reasoning: true,
      input: ['text'],
      contextWindow: 1048576,
      maxTokens: DEFAULT_MAX_TOKENS,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        supportsUsageInStreaming: true,
        maxTokensField: 'max_tokens',
        thinkingFormat: 'openai',
      },
    })
    expect(descriptor.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: null,
      high: 'high',
      xhigh: null,
      max: 'max',
    })
  })

  it('marks a model with no thinking control as non-reasoning', () => {
    const descriptor = toPiAiModel(model('mistral-large-3:675b'), connection, 'https://ollama.com/v1')
    expect(descriptor.reasoning).toBe(false)
    expect(descriptor.thinkingLevelMap).toBeUndefined()
  })

  it('declares image input for a vision model', () => {
    expect(toPiAiModel(model('deepseek-v4.1-flash'), connection, 'https://ollama.com/v1').input).toEqual(['text', 'image'])
    expect(toPiAiModel(model('gpt-oss:20b'), connection, 'https://ollama.com/v1').input).toEqual(['text'])
  })

  it('prefers a model-specific output cap over the route default', () => {
    const connectionWithCap = resolveConnection({ models: [{ id: 'glm-5.3', maxTokens: 4096 }] })
    const descriptor = toPiAiModel(
      connectionWithCap.models.find((entry) => entry.id === 'glm-5.3')!,
      connectionWithCap,
      'https://ollama.com/v1',
    )
    expect(descriptor.maxTokens).toBe(4096)
  })
})

describe('createPiAiProfile', () => {
  it('resolves the profile pi-ai needs', () => {
    const profile = createPiAiProfile(connection)
    expect(profile.provider).toBe('ollama-cloud')
    expect(profile.displayName).toBe('Ollama Cloud')
    expect(profile.apiKeyEnv).toBe(credentialRef('OLLAMA_API_KEY'))
    expect(profile.baseURL).toBe('https://ollama.com/v1')
    expect(profile.defaultContextWindow).toBe(262144)
    expect(profile.defaultMaxTokens).toBe(DEFAULT_MAX_TOKENS)
    expect(profile.defaultInput).toEqual(['text'])
    expect(profile.streamIdleTimeoutMs).toBe(300000)
    expect(profile.maxRequestImageBytes).toBe(20971520)
    expect(profile.requestImagePixelBudget).toBe(4194304)
    expect(profile.requestImageMaxBytes).toBe(1048576)
    expect(profile.modelErrors.size).toBe(0)
    expect(profile.configuredMaxTokens.size).toBe(0)
    expect(profile.piProvider?.id).toBe('ollama-cloud')
    expect(profile.piProvider?.getModels().map((entry) => entry.id)).toEqual(
      connection.models.map((entry) => entry.id),
    )
  })

  it('omits the credential reference when the configuration names none', () => {
    const profile = createPiAiProfile(resolveConnection({ apiKeyEnv: '' }))
    expect(profile.apiKeyEnv).toBeUndefined()
  })
})

describe('createOllamaCloudAuth', () => {
  it('starts with an empty store and no ambient sources', async () => {
    const auth = createOllamaCloudAuth()
    expect(await auth.credentials.read('ollama-cloud')).toBeUndefined()
    expect(await auth.credentials.list()).toEqual([])
    expect(await auth.authContext.env('OLLAMA_API_KEY')).toBeUndefined()
    expect(await auth.authContext.fileExists('~/.ollama/key')).toBe(false)
  })
})
