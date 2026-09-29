#!/usr/bin/env node
/**
 * Publish the hand-written browser half into `lib/client.js`.
 *
 * The client artifact is written by hand in the loader's lazy-factory format
 * (the official template's approach), so building it is a copy — plus the two
 * contract checks that would otherwise only fail in a running browser: the
 * registration id must equal the package name, and the file must register
 * exactly once.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const source = readFileSync(join(root, 'client/client.js'), 'utf8')

const registrations = source.match(/__ModuleLoader__\.load\(/gu) ?? []
if (registrations.length !== 1) {
  console.error(`build-client: expected exactly one __ModuleLoader__.load registration, found ${registrations.length}`)
  process.exit(1)
}
if (!source.includes(`id: '${manifest.name}'`)) {
  console.error(`build-client: the bundle must register under the package name "${manifest.name}"`)
  process.exit(1)
}
const declaration = manifest.dsh?.client
if (declaration === undefined || declaration.platform !== 'web' || manifest.exports?.['./client'] === undefined) {
  console.error('build-client: package.json must declare dsh.client (platform "web") and exports["./client"]')
  process.exit(1)
}

const target = join(root, 'lib/client.js')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, source, 'utf8')
console.log(`build-client: wrote lib/client.js (${source.length} bytes) for ${manifest.name}@${manifest.version}`)
