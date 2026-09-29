import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, it } from 'vitest'

import { resolveConnection } from '../src/config.js'
import { createPiAiProfile, toPiAiModel } from '../src/profile.js'

/**
 * The two harness generations hand a route's provider two different context
 * shapes: 0.1.x-era harnesses pass the pre-0.87 `Context` (a `systemPrompt`
 * and a separate `tools` list), while the 0.2.0-rc.2 harness passes the
 * transcript pi-ai 0.87 produces — the prompt and the declarations folded into
 * a leading system message. The route's provider must serve both, because a
 * published plugin is installed into whichever app generation its profile
 * names. These tests pin the wire consequence, not the mechanism: the system
 * prompt and the tool declarations must reach the request body either way.
 */
const connection = resolveConnection({})

const descriptor = (() => {
  const model = connection.models.find((entry) => entry.id === 'glm-5.3')
  if (model === undefined) throw new Error('catalog lost glm-5.3')
  return toPiAiModel(model, connection, connection.chatBaseURL)
})()

/** One OpenAI Chat Completions stream the SDK can parse to completion. */
const SSE = [
  'data: ' + JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: descriptor.id,
    choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }],
  }),
  '',
  'data: ' + JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: descriptor.id,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  }),
  '',
  'data: [DONE]',
  '',
  '',
].join('\n')

/** A request body the endpoint never answers, so the request stays observable. */
function capturingFetch(bodies: string[]) {
  return async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''))
    return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

/** Drain one provider stream, collecting its events. */
async function drain(stream: AsyncIterable<{ type: string }>) {
  const events: Array<{ type: string }> = []
  for await (const event of stream) events.push(event)
  return events
}

/** One declared tool, in the shape the harness hands the adapter. */
const tool = {
  name: 'read',
  description: 'Read one file from disk.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}

describe('provider context generations', () => {
  it('serves a pre-0.87 context with its system prompt and tools intact', async () => {
    const { piProvider } = createPiAiProfile(connection)
    if (piProvider === undefined) throw new Error('profile lost its provider')

    const bodies: string[] = []
    const events = await drain(piProvider.streamSimple(
      descriptor,
      {
        systemPrompt: 'SYSTEM-MARKER',
        messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
        tools: [tool],
      } as never,
      { apiKey: 'test-key', fetch: capturingFetch(bodies) as never },
    ))

    expect(events.map((event) => event.type)).not.toContain('error')
    const body = JSON.parse(bodies[0] ?? '{}')
    expect(body.messages?.[0]).toMatchObject({ role: 'system', content: 'SYSTEM-MARKER' })
    expect(body.tools?.[0]).toMatchObject({ type: 'function', function: { name: 'read' } })
  })

  it('serves an already-normalized transcript without duplicating the prompt', async () => {
    const { piProvider } = createPiAiProfile(connection)
    if (piProvider === undefined) throw new Error('profile lost its provider')

    const transcript = normalizeContext({
      systemPrompt: 'SYSTEM-MARKER',
      messages: [{ role: 'user', content: 'hello', timestamp: 0 }],
      tools: [tool],
    })

    const bodies: string[] = []
    const events = await drain(piProvider.streamSimple(
      descriptor,
      transcript,
      { apiKey: 'test-key', fetch: capturingFetch(bodies) as never },
    ))

    expect(events.map((event) => event.type)).not.toContain('error')
    const body = JSON.parse(bodies[0] ?? '{}')
    const systemMessages = (body.messages ?? []).filter((message: { role: string }) => message.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(systemMessages[0]).toMatchObject({ content: 'SYSTEM-MARKER' })
    expect(body.tools).toHaveLength(1)
  })
})
