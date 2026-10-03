import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { Context, Volatile } from '@deepseek-ai/cordis'
import * as React from 'react'
import { vi } from 'vitest'

import type { Config, ConfiguredModelEntry } from '../src/config.js'

/**
 * The pi-ai generation boundary (ADR 0004), read from the manifests that own it
 * rather than hardcoded here: the range this package declares, the range the
 * installed harness (the adapter that drives the route) declares, and the exact
 * pi-ai version this repository installs.
 */
export const OWN_RANGE = packageManifest('../package.json').dependencies?.['@earendil-works/pi-ai'] as string

export const HARNESS_RANGE = (
  createRequire(import.meta.url)('@deepseek-ai/dsh-llm-pi-ai/package.json') as {
    dependencies?: Record<string, string>
  }
).dependencies?.['@earendil-works/pi-ai'] as string

export function installedPiAiVersion(): string {
  return packageManifest('../package.json').devDependencies?.['@earendil-works/pi-ai'] ?? ''
}

function packageManifest(relative: string): {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
} {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
}

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

/**
 * Live plugin configuration wired to controllable references.
 *
 * The catalog refresh defaults to *off* here: a unit test that mounted the
 * plugin would otherwise reach the network on every `apply()`. The production
 * defaults live in the configuration schema and are pinned by their own test;
 * a test that exercises the refresh asks for it explicitly.
 */
export function liveConfig(overrides: {
  apiKeyEnv?: string
  baseURL?: string
  models?: readonly ConfiguredModelEntry[]
  autoRefresh?: boolean
  refreshMinutes?: number
} = {}) {
  const references = {
    apiKeyEnv: ref(overrides.apiKeyEnv ?? 'OLLAMA_API_KEY'),
    baseURL: ref(overrides.baseURL ?? 'https://ollama.com/api'),
    models: ref<readonly ConfiguredModelEntry[] | undefined>(overrides.models),
    maxTokens: ref(32768),
    defaultContextWindow: ref(262144),
    streamIdleTimeoutMs: ref(300000),
    requestTimeoutMs: ref(15000),
    autoRefresh: ref(overrides.autoRefresh ?? false),
    refreshMinutes: ref(overrides.refreshMinutes ?? 0),
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
  /** Effect bodies captured instead of run, when `captureEffects` is set. */
  effects: Array<{ label: string | undefined; run: () => unknown }>
}

/** A JSON response for a stubbed `fetch`. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * A `fetch` stub answering one Ollama endpoint's native surface the way the
 * host does: `GET /tags` lists ids, `POST /show` describes one model. An id
 * whose `shows` value is `undefined` answers 410, i.e. the listing still names
 * it while the detail request refuses it.
 */
export function ollamaEndpoint(options: {
  listing: readonly string[]
  shows?: Record<string, unknown | undefined>
  onCall?: (url: string, init?: RequestInit) => void
}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const target = String(url)
    options.onCall?.(target, init)
    if (target.endsWith('/tags')) {
      return jsonResponse({ models: options.listing.map((name) => ({ name, model: name })) })
    }
    if (target.endsWith('/show')) {
      const body = JSON.parse(String(init?.body)) as { model: string }
      const show = options.shows?.[body.model]
      return show === undefined ? jsonResponse({ error: 'not found' }, 404) : jsonResponse(show)
    }
    throw new Error(`unexpected url ${target}`)
  }) as unknown as typeof fetch
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
  /** Simulate a connection service whose channel registration throws. */
  connectionHandleThrows?: boolean
  /**
   * Capture effect bodies instead of running them, so a test can arm a
   * scheduled effect (the catalog refresh timer) and unwind it deliberately.
   */
  captureEffects?: boolean
} = {}) {
  const captured: CapturedRegistrations = {
    adapters: [],
    directory: [],
    discovery: [],
    web: { search: [], fetch: [] },
    rpc: [],
    effects: [],
  }
  const effect = (callback: () => unknown, label?: string) => {
    if (options.captureEffects === true) {
      captured.effects.push({ label, run: callback })
      return () => {}
    }
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
          if (options.connectionHandleThrows === true) {
            throw new Error('cannot get property "webServer" without inject')
          }
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

/** One seat registration captured from a fake slots service. */
export interface CapturedSeat {
  options: Record<string, unknown>
  component: (props: Record<string, unknown>) => React.ReactElement
}

/** The bundle's shape as far as these tests reach into it. */
export interface ClientBundle {
  name: string
  inject: string[]
  apply: (ctx: unknown) => void
  internals: {
    COPY: { en: Record<string, string>; zh: Record<string, string> }
    store: { read(rpc: unknown, options?: { force?: boolean }): Promise<unknown> }
    decodeUsageReply: (value: unknown) => unknown
    failureText: (state: Record<string, unknown>, t: Translate) => string
    formatClock: (iso: string) => string | undefined
    isNeedsRestart: (message: unknown) => boolean
    primaryWindow: (windows: Array<{ id: string }>) => { id: string } | undefined
    remainingPercent: (used: number) => number
    resetLabelOf: (window: Record<string, unknown>, t: Translate) => string | undefined
    severityOf: (remaining: number) => string
    windowCopyKey: (id: string) => string
  }
}

export type Translate = (key: string, params?: Record<string, string>) => string

/**
 * Load the hand-written browser bundle the way the host loader does: hand it a
 * `window.__ModuleLoader__` to register into, then materialize the factory with
 * a `require` that answers what the loader's baseline answers.
 */
export function loadBundle(): { id: string; module: ClientBundle } {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  let registration: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined
  const fakeWindow = {
    __ModuleLoader__: {
      load: (value: typeof registration) => {
        registration = value
      },
    },
  }
  new Function('window', source)(fakeWindow)
  if (registration === undefined) throw new Error('bundle never registered')
  const module = registration.factory((id: string) => {
    if (id === 'react') return React
    throw new Error(`unexpected require("${id}")`)
  }) as ClientBundle
  return { id: registration.id, module }
}


/**
 * A translator bound to one bundle instance's own English dictionary, with the
 * bundle's own `{name}` interpolation.
 */
export function translatorFor(module: ClientBundle): Translate {
  const dictionary = module.internals.COPY.en
  return (key, params) => {
    const template = dictionary[key] ?? key
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/gu, (_match, name: string) => params[name] ?? '')
  }
}

/** One style element the stub DOM saw, so tests can inspect how it was tagged. */
export interface StubStyleElement {
  id: string
  textContent: string
  attributes: Record<string, string>
  isConnected: boolean
  setAttribute: (name: string, value: string) => void
  remove: () => void
}

/** One mounted client instance: what it registered and the seats it left behind. */
export interface ClientMount {
  seats: CapturedSeat[]
  registered: string[]
  styles: string[]
  /** The elements behind `styles`, in first-append order. */
  styleElements: StubStyleElement[]
}

/** Extra globals a mount needs, e.g. the `MutationObserver` the stylesheet installs. */
export interface MountOptions {
  globals?: Record<string, unknown>
}

/** A style element stub: the bundle only sets an id, an attribute, text, and removes it. */
function styleElementStub(): StubStyleElement {
  return {
    id: '',
    textContent: '',
    attributes: {},
    isConnected: false,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
    remove() {
      this.isConnected = false
    },
  }
}

/**
 * Mount one bundle instance against a fake client context, with `rpc` reachable
 * through the connection service and the stylesheet host stubbed.
 */
export function mountClient(
  module: ClientBundle,
  rpc: unknown,
  t: Translate,
  options: MountOptions = {},
): ClientMount {
  const seats: CapturedSeat[] = []
  const registered: string[] = []
  const styles: string[] = []
  const styleElements: StubStyleElement[] = []
  const append = (element: StubStyleElement) => {
    element.isConnected = true
    if (styleElements.includes(element)) return
    styleElements.push(element)
    styles.push(element.id)
  }
  for (const [key, value] of Object.entries(options.globals ?? {})) vi.stubGlobal(key, value)
  vi.stubGlobal('document', {
    head: { appendChild: append },
    createElement: () => styleElementStub(),
  })
  module.apply({
    effect: (callback: () => unknown) => callback(),
    locale: { register: () => () => {}, bind: () => t },
    get: () => ({ rpc }),
    slots: {
      inject: (name: string, callback: () => unknown) => {
        registered.push(name)
        callback()
      },
      register: (options: Record<string, unknown>, component: CapturedSeat['component']) => {
        seats.push({ options, component })
        return () => {}
      },
    },
  })
  vi.unstubAllGlobals()
  return { seats, registered, styles, styleElements }
}

/** The card seat's component, or a failure naming the missing registration. */
export function cardSeat(mount: ClientMount): CapturedSeat['component'] {
  const seat = mount.seats.find((candidate) => candidate.options.key !== undefined)
  if (seat === undefined) throw new Error('card seat was not registered')
  return seat.component
}

/** The sidebar seat's component, or a failure naming the missing registration. */
export function sidebarSeat(mount: ClientMount): CapturedSeat['component'] {
  const seat = mount.seats.find((candidate) => candidate.options.id !== undefined)
  if (seat === undefined) throw new Error('sidebar seat was not registered')
  return seat.component
}
