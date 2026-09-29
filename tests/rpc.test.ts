import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'

import { resolveConnection } from '../src/config.js'
import {
  CREDENTIAL_SET_ENDPOINT,
  CREDENTIAL_STATUS_ENDPOINT,
  createUsageRpcHandler,
  USAGE_ENDPOINT,
} from '../src/rpc.js'

const BODY = { limits: { monthly: { usage: 0.5, models: [{ name: 'web search', request_count: 2 }] } } }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** One handler wired to controllable effects. */
function harness(options: {
  fetch?: typeof fetch
  resolveCredential?: () => Promise<string | undefined>
  credentials?: boolean
  apiKeyEnv?: string
} = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const facts = resolveConnection(options.apiKeyEnv === undefined ? {} : { apiKeyEnv: options.apiKeyEnv })
  const credentials = {
    resolve: vi.fn(),
    describe: vi.fn(async () => ({ configured: true, writable: true })),
    set: vi.fn(async () => {}),
  }
  const route: typeof fetch = options.fetch ?? (async (url, init) => {
    calls.push({ url: String(url), init })
    return jsonResponse(BODY)
  })
  const handler = createUsageRpcHandler({
    connection: () => facts,
    resolveCredential: options.resolveCredential ?? (async () => 'stored-key'),
    credentials: () => (options.credentials === false ? undefined : credentials),
    fetch: route,
    attribution: () => ({ 'user-agent': 'dsh-test' }),
  })
  return { handler, calls, credentials }
}

describe('usage/read', () => {
  it('reads the configured route with the stored credential', async () => {
    const { handler, calls } = harness()
    const reply = await handler(USAGE_ENDPOINT, {})
    expect(reply).toMatchObject({ ok: true, value: { status: 'ok' } })
    expect(calls[0]?.url).toBe('https://ollama.com/api/usage')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer stored-key' })
    const usage = (reply as { value: { usage: { windows: Array<{ id: string }> } } }).value.usage
    expect(usage.windows.map((window) => window.id)).toEqual(['monthly'])
  })

  it('honors a draft endpoint and one-shot key from a configuration surface', async () => {
    const { handler, calls } = harness()
    await handler(USAGE_ENDPOINT, { baseURL: 'https://ollama.example/v1', apiKey: 'draft-key' })
    expect(calls[0]?.url).toBe('https://ollama.example/api/usage')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer draft-key' })
  })

  it('answers unsupported when the endpoint has no usage surface', async () => {
    const { handler } = harness({ fetch: async () => jsonResponse({ error: 'not found' }, 404) })
    await expect(handler(USAGE_ENDPOINT, {})).resolves.toEqual({ ok: true, value: { status: 'unsupported' } })
  })

  it('maps a refused credential onto the credential error code', async () => {
    const { handler } = harness({ fetch: async () => jsonResponse({ error: 'no' }, 401) })
    await expect(handler(USAGE_ENDPOINT, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_CREDENTIAL' },
    })
  })

  it('reports other failures with their stable code', async () => {
    const { handler } = harness({ fetch: async () => jsonResponse({ error: 'busy' }, 429) })
    await expect(handler(USAGE_ENDPOINT, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'OLLAMA_USAGE_FAILED' },
    })
  })
})

describe('credential/status', () => {
  it('reports presence and writability without the value', async () => {
    const { handler } = harness()
    await expect(handler(CREDENTIAL_STATUS_ENDPOINT, {})).resolves.toEqual({
      ok: true,
      value: { reference: 'OLLAMA_API_KEY', configured: true, writable: true },
    })
  })

  it('reports unconfigured when the seam has no record and no environment value', async () => {
    const { handler, credentials } = harness({ resolveCredential: async () => undefined })
    credentials.describe.mockResolvedValue({ configured: false, writable: false })
    await expect(handler(CREDENTIAL_STATUS_ENDPOINT, {})).resolves.toMatchObject({
      ok: true,
      value: { reference: 'OLLAMA_API_KEY', configured: false },
    })
  })

  it('reports a configured environment value when the store is empty', async () => {
    const { handler, credentials } = harness()
    credentials.describe.mockResolvedValue({ configured: false, writable: false })
    await expect(handler(CREDENTIAL_STATUS_ENDPOINT, {})).resolves.toMatchObject({
      ok: true,
      value: { configured: true, writable: false },
    })
  })

  it('reports no reference for a route configured without one', async () => {
    const { handler } = harness({ apiKeyEnv: '' })
    await expect(handler(CREDENTIAL_STATUS_ENDPOINT, {})).resolves.toMatchObject({
      ok: true,
      value: { reference: undefined, configured: false },
    })
  })
})

describe('credential/set', () => {
  it('writes through the credentials seam under the configured reference', async () => {
    const { handler, credentials } = harness()
    await expect(handler(CREDENTIAL_SET_ENDPOINT, { value: '  new-key  ' })).resolves.toEqual({
      ok: true,
      value: { configured: true, writable: true },
    })
    expect(credentials.set).toHaveBeenCalledWith(credentialRef('OLLAMA_API_KEY'), 'new-key')
  })

  it('refuses a reference the configuration does not name', async () => {
    const { handler, credentials } = harness()
    await expect(handler(CREDENTIAL_SET_ENDPOINT, { value: 'k', ref: 'OTHER_KEY' })).resolves.toMatchObject({
      ok: false,
    })
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('refuses a value no HTTP header can carry without echoing it', async () => {
    const { handler, credentials } = harness()
    const reply = await handler(CREDENTIAL_SET_ENDPOINT, { value: 'bad\nkey' })
    expect(reply).toMatchObject({ ok: false, error: { code: 'INVALID_CREDENTIAL' } })
    expect(JSON.stringify(reply)).not.toContain('bad\nkey')
    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('fails with a clear message when the deployment has no credential seam', async () => {
    const { handler } = harness({ credentials: false })
    await expect(handler(CREDENTIAL_SET_ENDPOINT, { value: 'k' })).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/credentials service/) },
    })
  })

  it('refuses a malformed request body', async () => {
    const { handler, credentials } = harness()
    await expect(handler(CREDENTIAL_SET_ENDPOINT, { nope: true })).resolves.toMatchObject({ ok: false })
    await expect(handler(CREDENTIAL_SET_ENDPOINT, { value: 42 })).resolves.toMatchObject({ ok: false })
    expect(credentials.set).not.toHaveBeenCalled()
  })
})

describe('unknown endpoints', () => {
  it('answers with the restart-diagnostic message older hosts use', async () => {
    const { handler } = harness()
    await expect(handler('models/discover', {})).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/^unknown Ollama Cloud endpoint/) },
    })
  })
})
