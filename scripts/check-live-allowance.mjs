#!/usr/bin/env node
/**
 * Live allowance check: the real endpoint, end to end, with nothing stubbed.
 *
 * The account's own `GET <base>/balance` answer travels the whole real path —
 * the host decode (`lib/rpc.js` → `lib/usage.js`), the wire projection, and the
 * browser half's own decoder loaded from `client/client.js` the way the host
 * loader loads it — and each window's remaining share is printed.
 *
 * This exists because every unit test in this repository pins a *mock*, and a
 * mock is written from the same assumption as the code it feeds: the suite can
 * be entirely green while the decoder is entirely wrong about the endpoint it
 * reads. That is exactly how the panel shipped reading a contract the endpoint
 * had already retired (ADR 0006). The unit tests answer "do the decoding rules
 * hold?"; this answers "is the contract those rules describe still the one the
 * endpoint speaks?".
 *
 * It needs the account's key and the network, so it is deliberately NOT part of
 * `pnpm check`. Run it by hand after `pnpm run build`, whenever the endpoint is
 * suspected of moving:
 *
 *     pnpm run build && pnpm run check:live
 *
 * The key comes from `OLLAMA_API_KEY` in the environment, or — the way the
 * harness itself resolves it — from the credential store (`DSH_CREDENTIALS`,
 * default `~/.dsh/.credentials.yaml`). It is never printed.
 *
 * `--base <url>` checks against another endpoint instead of the configured one
 * (a local Ollama answers no allowance, which is the other answer this script
 * has to report correctly).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createUsageRpcHandler } from '../lib/rpc.js'
import { resolveConnection } from '../lib/config.js'

const credentialsPath = process.env.DSH_CREDENTIALS ?? join(homedir(), '.dsh', '.credentials.yaml')

/** The account key: the environment first, then the harness credential store. */
function resolveKey() {
  const fromEnvironment = process.env.OLLAMA_API_KEY?.trim()
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) return fromEnvironment
  return /^\s*OLLAMA_API_KEY:\s*(\S+)\s*$/mu.exec(readFileSync(credentialsPath, 'utf8'))?.[1]
}

if (resolveKey() === undefined) {
  console.error(`check-live-allowance: no OLLAMA_API_KEY in the environment or ${credentialsPath}`)
  process.exit(1)
}

/** `--base <url>` overrides the endpoint to check. */
const baseIndex = process.argv.indexOf('--base')
const baseOverride = baseIndex < 0 ? undefined : process.argv[baseIndex + 1]
if (baseIndex >= 0 && (baseOverride === undefined || !URL.canParse(baseOverride))) {
  console.error('check-live-allowance: --base needs an absolute URL')
  process.exit(1)
}

const facts = resolveConnection({})
const baseURL = baseOverride ?? facts.nativeBaseURL
const handler = createUsageRpcHandler({
  connection: () => ({ ...facts, nativeBaseURL: baseURL }),
  resolveCredential: async () => resolveKey(),
  credentials: () => undefined,
  fetch: (...args) => fetch(...args),
  attribution: () => ({ 'user-agent': 'dsh-ollama-cloud/check-live-allowance' }),
})

const reply = await handler('usage/read', {})
if (reply.ok !== true) {
  console.error('check-live-allowance: the host half could not read the allowance')
  console.error(`  ${reply.error.code}: ${reply.error.message}`)
  process.exit(1)
}
console.log(`host reply   : ${JSON.stringify(reply.value)}`)

// Load the browser half the way the host loader does: register into a fake
// `window.__ModuleLoader__`, then materialize the factory.
const require = createRequire(import.meta.url)
const React = require('react')
const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
let registration
new Function('window', source)({ __ModuleLoader__: { load: (value) => { registration = value } } })
const bundle = registration.factory((id) => {
  if (id === 'react') return React
  throw new Error(`check-live-allowance: unexpected require("${id}")`)
})

const decoded = bundle.internals.decodeUsageReply(reply.value)
if (decoded === undefined) {
  console.error('check-live-allowance: the browser half could not decode what the host served')
  console.error(`  ${JSON.stringify(decoded)}`)
  process.exit(1)
}
// The host maps a 404 onto this state: the supported answer for a local or
// self-hosted endpoint, and for the public cloud endpoint the contract having
// moved. Either way there is no allowance to check here.
if (decoded.status === 'unsupported') {
  console.error(`check-live-allowance: ${baseURL} reports no allowance (404)`)
  process.exit(1)
}

let failures = 0
for (const window of decoded.usage.windows) {
  const remaining = bundle.internals.remainingPercent(window.usedFraction)
  const reset = window.resetsAt === undefined ? 'no instant reported' : `resets ${window.resetsAt}`
  console.log(`  ${window.id.padEnd(7)} remaining ${String(remaining).padStart(5)}%   ${reset}`)
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) {
    console.error(`check-live-allowance: ${window.id} decoded to an impossible share (${remaining}%)`)
    failures += 1
  }
}
if (failures > 0) process.exit(1)

console.log(`check-live-allowance: ok — ${decoded.usage.windows.length} window(s), read at ${decoded.usage.fetchedAt}`)
