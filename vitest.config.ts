import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every test file runs against a throwaway harness home (see setup.ts), so
    // a suite can never write into the developer's real catalog cache.
    setupFiles: ['./tests/setup.ts'],
  },
})
