import type { Context, Volatile } from '@deepseek-ai/cordis'
import { vi } from 'vitest'

import type { Config, ConfiguredModelEntry } from '../src/config.js'

/** A stand-in for the harness's live configuration reference. */
export function ref<T>(value: T) {
  let current = value
  return {
    get: (): T => current,
    set: (next: T): void => {
      current = next
    },
  } satisfies Volatile<T> & { set(next: T): void }
}

/** Live plugin configuration wired to controllable references. */
export function liveConfig(overrides: {
  apiKeyEnv?: string
  baseURL?: string
  models?: readonly ConfiguredModelEntry[]
} = {}) {
  const references = {
    apiKeyEnv: ref(overrides.apiKeyEnv ?? 'OLLAMA_API_KEY'),
    baseURL: ref(overrides.baseURL ?? 'https://ollama.com/api'),
    models: ref<readonly ConfiguredModelEntry[] | undefined>(overrides.models),
    maxTokens: ref(32768),
    defaultContextWindow: ref(262144),
    streamIdleTimeoutMs: ref(300000),
    requestTimeoutMs: ref(15000),
  }
  return { config: references as unknown as Config, references }
}

/** One captured registration, for asserting the plugin's published contract. */
export interface CapturedRegistrations {
  adapters: Array<{ providers: string[]; adapter: unknown }>
  directory: unknown[]
  discovery: Array<{ settingsNs: string; discover: unknown }>
  web: { search: string[]; fetch: string[] }
  rpc: Array<{ channel: string; handler: unknown }>
}

/** Minimal credential service shape the resolver reads. */
export interface FakeCredentials {
  resolve(reference: string): Promise<{ value: string } | undefined>
}

/** Minimal launcher environment snapshot shape the fallback reads. */
export interface FakeLaunchEnvironment {
  get(name: string): { value: string } | undefined
}

/**
 * Build a context that satisfies the plugin's registration contract without a
 * running harness: registrations are captured, and the optional services are
 * supplied only when a test asks for them.
 */
export function fakeContext(options: {
  credentials?: FakeCredentials
  launchEnvironment?: FakeLaunchEnvironment
  entryId?: string | undefined
  includeWeb?: boolean
  includeConnection?: boolean
} = {}) {
  const captured: CapturedRegistrations = {
    adapters: [],
    directory: [],
    discovery: [],
    web: { search: [], fetch: [] },
    rpc: [],
  }
  const effect = (callback: () => unknown) => {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer() : disposer
  }
  const webChild = {
    web: {
      registerSearchProvider: (provider: { id: string }) => {
        captured.web.search.push(provider.id)
        return () => {}
      },
      registerFetchProvider: (provider: { id: string }) => {
        captured.web.fetch.push(provider.id)
        return () => {}
      },
    },
    effect,
  }
  const connectionChild = {
    connection: {
      rpc: {
        handle: (channel: string, handler: unknown) => {
          captured.rpc.push({ channel, handler })
          return () => Promise.resolve()
        },
      },
    },
    effect,
  }
  const ctx = {
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    fiber: { entry: options.entryId === undefined ? undefined : { options: { id: options.entryId } } },
    get: (key: string) => {
      if (key === 'credentials') return options.credentials
      if (key === 'launchEnvironment') return options.launchEnvironment
      return undefined
    },
    effect,
    inject: (names: string[], callback: (child: unknown) => void) => {
      if (options.includeWeb !== false && names.includes('web')) callback(webChild)
      if (options.includeConnection !== false && names.includes('connection')) callback(connectionChild)
    },
    llm: {
      registerAdapter: (providers: string[], adapter: unknown) => {
        captured.adapters.push({ providers, adapter })
        return Object.assign(() => {}, { replace: () => {} })
      },
      registerConfigurableProviders: (entries: unknown[]) => {
        captured.directory.push(...entries)
        return Object.assign(() => {}, { replace: () => {} })
      },
      registerModelDiscovery: (settingsNs: string, discover: unknown) => {
        captured.discovery.push({ settingsNs, discover })
        return () => {}
      },
    },
  }
  return { ctx: ctx as unknown as Context, captured }
}
