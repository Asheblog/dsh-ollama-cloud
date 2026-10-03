import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach } from 'vitest'

/**
 * Point every test at its own throwaway harness home.
 *
 * The plugin's catalog cache is a real file under `DSH_HOME`, and mounting the
 * plugin reads it and adopting a catalog writes it. Without this, one test's
 * fake endpoint would decide what the next test — or the developer's own next
 * boot — serves as its model list.
 */
let previousHome: string | undefined
let home: string | undefined

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'dsh-ollama-cloud-test-home-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  // Guarded: only a directory this file created under the OS temp root is
  // removed, never a path that came from the environment.
  if (home !== undefined && home.startsWith(tmpdir())) rmSync(home, { recursive: true, force: true })
  previousHome = undefined
  home = undefined
})
