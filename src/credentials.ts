/**
 * Credential resolution for the Ollama Cloud route.
 *
 * The harness owns credential storage: the Models page and plugin settings
 * write a value under a reference name, and adapters resolve that reference
 * per request. With the seam present the stored value wins; without it the
 * launcher's environment snapshot (process, project `.env`, user `.env`) is
 * the whole credential plane. Nothing else is consulted, so a stray
 * `OPENAI_API_KEY` can never authenticate an Ollama request.
 *
 * @module dsh-ollama-cloud/credentials
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

/** A reference resolved to a usable key, or `undefined` when nothing is set. */
export type ResolveCredential = (reference: CredentialRef) => Promise<string | undefined>

/**
 * Build the per-request credential resolver for one plugin instance.
 * @param ctx - the plugin's context, read through on every call so a service
 *   that appears later (or a snapshot the launcher fills in) is honored.
 * @param packageName - name prefixed to diagnostics; never includes the value.
 * @returns the resolver every request path shares.
 */
export function createCredentialResolver(ctx: Context, packageName: string): ResolveCredential {
  return async (reference) => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(reference)
      if (hit !== undefined) return assertUsableApiKey(hit.value, packageName, reference)
      return undefined
    }
    const ambient = launchEnvironmentOf(ctx).get(reference)
    if (ambient !== undefined && ambient.value.length > 0) {
      return assertUsableApiKey(ambient.value, packageName, reference)
    }
    return undefined
  }
}
