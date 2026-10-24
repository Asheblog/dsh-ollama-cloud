#!/usr/bin/env node
/**
 * Verify the packed tarball is independently installable.
 *
 * The marketplace installs the release tarball directly, so the artifact —
 * not the checkout — must carry the bundle patch, the built entry, the docs,
 * and a manifest whose `dsh.bundle.patch` resolves inside the package.
 * Run after `pnpm pack`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packed = readdirSync(root).filter((name) => name.endsWith('.tgz'))
if (packed.length !== 1) {
  console.error(`check-tarball: expected exactly one packed tarball, found ${packed.length}`)
  process.exit(1)
}
const tarball = join(root, packed[0])
// Run tar from the repository root and pass a bare file name: a Windows
// absolute path (`E:\...`) makes GNU tar treat `E:` as a remote host.
const listing = execFileSync('tar', ['-tzf', packed[0]], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const required = [
  'package/package.json',
  'package/cordis.patch.yml',
  'package/lib/index.js',
  'package/lib/index.d.ts',
  'package/lib/client.js',
  'package/README.md',
  'package/README.zh.md',
  'package/LICENSE',
  'package/CHANGELOG.md',
  'package/docs/adr/0001-delegate-chat-to-official-pi-ai-adapter.md',
  'package/docs/adr/0002-route-name-and-settings-namespace.md',
  'package/docs/adr/0003-usage-ui-in-host-slots-over-the-connection-channel.md',
  'package/docs/adr/0004-pi-ai-generation-alignment.md',
  'package/docs/adr/0005-live-endpoint-catalog.md',
  'package/docs/adr/0006-allowance-from-balance.md',
  'package/docs/adr/0007-transient-failures-retry-and-recover.md',
  'package/docs/adr/0008-composition-patch-follows-the-startup-service.md',
  'package/docs/adr/0008-composition-patch-follows-the-startup-service.zh.md',
]
const missing = required.filter((entry) => !listing.includes(entry))
if (missing.length > 0) {
  console.error(`check-tarball: tarball is missing ${missing.join(', ')}`)
  process.exit(1)
}
const leaked = listing.filter(
  (entry) => entry.startsWith('package/src/')
    || entry.startsWith('package/tests/')
    || entry.startsWith('package/node_modules/'),
)
if (leaked.length > 0) {
  console.error(`check-tarball: tarball leaks ${leaked.slice(0, 5).join(', ')}`)
  process.exit(1)
}

const scratch = join(root, '.tmp', 'tarball-check')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
execFileSync('tar', ['-xzf', packed[0], '-C', '.tmp/tarball-check', 'package/package.json', 'package/cordis.patch.yml'], { cwd: root, stdio: 'inherit' })
const manifest = JSON.parse(readFileSync(join(scratch, 'package/package.json'), 'utf8'))
const patch = manifest?.dsh?.bundle?.patch
if (manifest?.dsh?.client?.platform !== 'web' || manifest?.exports?.['./client'] === undefined) {
  console.error('check-tarball: manifest does not declare the browser half (dsh.client + exports["./client"])')
  process.exit(1)
}
if (patch !== './cordis.patch.yml') {
  console.error(`check-tarball: manifest does not declare dsh.bundle.patch (got ${JSON.stringify(patch)})`)
  process.exit(1)
}
const patchText = readFileSync(join(scratch, 'package/cordis.patch.yml'), 'utf8')
if (!/name:\s*['"]?dsh-ollama-cloud['"]?\s*$/m.test(patchText)) {
  console.error('check-tarball: the bundle patch does not reference this package by name')
  process.exit(1)
}
// The connection row's inject list is a boot condition, not a preference: a
// name no composition provides makes a required row wait forever. `pnpm test`
// compares it with the installed composition (tests/composition.test.ts); this
// check makes sure the published artifact still carries the list at all.
if (!/^\s*inject:\s*\[\s*webStartup\s*,\s*webServer\s*\]\s*$/m.test(patchText)) {
  console.error('check-tarball: the bundle patch does not restate inject: [webStartup, webServer]')
  process.exit(1)
}
// Comments name the old service on purpose (they explain the rename), so the
// stale-name check reads only the YAML body.
const patchBody = patchText
  .split('\n')
  .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'))
  .join('\n')
if (/\bwebRuntime\b/u.test(patchBody)) {
  console.error('check-tarball: the bundle patch body names webRuntime, the pre-0.2.1-rc.1 startup service')
  process.exit(1)
}
console.log(`check-tarball: ${packed[0]} carries ${listing.length} entries and a valid bundle manifest`)
