#!/usr/bin/env node
/**
 * Keep this plugin's pi-ai generation aligned with the harness that drives it.
 *
 * The chat route streams through this package's own `@earendil-works/pi-ai`
 * copy, while the adapter that calls it — `@deepseek-ai/dsh-llm-pi-ai` — is a
 * host-shared package the app provides. pi-ai is *not* shared, so an app
 * release that moves the harness to a new pi-ai generation silently strands
 * every plugin copy already installed, and the drift shows up at request time
 * (the 0.2.0 incident: `Cannot read properties of undefined (reading
 * 'length')` on every chat request under DSH 0.2.0-rc.2).
 *
 * Two modes:
 *
 * - default — compare this package's declared range with the *installed*
 *   `dsh-llm-pi-ai` dev dependency's declared range. Offline and
 *   deterministic, so `pnpm check` and CI require it.
 * - `--remote` — ask the registry for the harness the `next` channel publishes
 *   (the channel the desktop app follows) and compare against that. The
 *   scheduled workflow runs this so drift is reported between releases rather
 *   than by users.
 *
 * The range judgement itself lives in `lib/alignment.js` — the build artifact
 * this repo tracks, so the runtime warning and this check cannot disagree about
 * what "aligned" means. `pnpm check` builds before running this script.
 *
 * See docs/adr/0004-pi-ai-generation-alignment.md.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { piAiGeneration, rangesOverlap } from '../lib/alignment.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PI_AI = '@earendil-works/pi-ai'
const HARNESS = '@deepseek-ai/dsh-llm-pi-ai'

const remote = process.argv.includes('--remote')
const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ownRange = own.dependencies?.[PI_AI]

let harness
let harnessLabel
if (remote) {
  // The CLI is a `.cmd` shim on Windows, which Node only launches through a shell.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  harness = JSON.parse(execFileSync(npm, ['view', `${HARNESS}@next`, '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }))
  harnessLabel = `${HARNESS}@${harness.version} (registry next tag)`
} else {
  harness = createRequire(import.meta.url)(`${HARNESS}/package.json`)
  harnessLabel = `${HARNESS}@${harness.version} (installed dev dependency)`
}
const harnessRange = harness.dependencies?.[PI_AI]
const aligned = rangesOverlap(ownRange, harnessRange)

if (aligned === undefined) {
  console.error(`check-pi-ai-alignment: could not compare ${PI_AI} ranges`
    + ` (this package: ${JSON.stringify(ownRange)}, ${harnessLabel}: ${JSON.stringify(harnessRange)})`)
  process.exit(1)
}

if (!aligned) {
  console.error(`check-pi-ai-alignment: generation drift detected.
  this package declares ${PI_AI} ${ownRange} (generation ${piAiGeneration(ownRange) ?? '?'}.x)
  ${harnessLabel} declares ${harnessRange} (generation ${piAiGeneration(harnessRange) ?? '?'}.x)

The harness drives this plugin's provider with its own pi-ai context contract, so
the two ranges must admit a common version. Bump dependencies.${PI_AI} in package.json
to the harness generation, refresh the lockfile, and re-verify the route (ADR 0004).`)
  process.exit(1)
}

console.log(`check-pi-ai-alignment: ${ownRange} overlaps ${harnessLabel} (${harnessRange})`)

if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `${PI_AI} \`${ownRange}\` overlaps ${harnessLabel} \`${harnessRange}\`\n`,
  )
}
