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
  'package/README.md',
  'package/README.zh.md',
  'package/LICENSE',
  'package/CHANGELOG.md',
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
if (patch !== './cordis.patch.yml') {
  console.error(`check-tarball: manifest does not declare dsh.bundle.patch (got ${JSON.stringify(patch)})`)
  process.exit(1)
}
const patchText = readFileSync(join(scratch, 'package/cordis.patch.yml'), 'utf8')
if (!/name:\s*['"]?dsh-ollama-cloud['"]?\s*$/m.test(patchText)) {
  console.error('check-tarball: the bundle patch does not reference this package by name')
  process.exit(1)
}
console.log(`check-tarball: ${packed[0]} carries ${listing.length} entries and a valid bundle manifest`)
