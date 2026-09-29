# ADR 0004 — Pin the route's pi-ai to the harness generation, and serve the older one

Status: accepted (2026-09-29)

## Context

The chat route streams through `@earendil-works/pi-ai`, declared as this
package's own runtime dependency — pi-ai is **not** one of the packages the app
shares with plugins (`desktop-runtime.json`'s `sharedPackages` lists
`@deepseek-ai/dsh-llm-pi-ai`, not pi-ai). The adapter that calls the route,
`PiAiAdapter`, *is* host-shared and belongs to the app. One request therefore
crosses two pi-ai copies: ours, and the harness's.

Through `0.2.0-rc.1` the two copies exchanged the pre-0.87 `Context` —
`{ systemPrompt, messages, tools }`. pi-ai 0.87 — the generation
`dsh-llm-pi-ai@0.2.0-rc.2` declares as `^0.87.1` — moved the prompt and the
tool declarations into the transcript: its `Models` collection folds them with
`normalizeContext()`, and its API implementations read the resulting
`TranscriptContext`. `0.2.0-rc.1`'s `Models` folded nothing; it handed the raw
`Context` straight to the provider.

Two failure modes follow, and both shipped:

- **plugin pi-ai 0.85 + harness 0.2.0-rc.2** — the harness hands a transcript
  to 0.85's `estimateMessageTokens()`, which has no `system` branch: it
  iterates the prompt string character by character and dies on
  `block.name.length` —

  ```
  Cannot read properties of undefined (reading 'length')   code: PI_AI_ERROR
  ```

  thrown synchronously while building the request, before any network I/O, so
  every chat request failed instantly on the updated app. This is the 0.2.0
  incident.
- **plugin pi-ai 0.87 + harness 0.2.0-rc.1** — nothing throws. `stream()`
  collapses a context that carries no system message, and the request goes out
  **without the system prompt and without a single tool declaration**. Silence
  is worse than a crash.

`dsh.compatibility.dshReleases` cannot express this boundary: it names app
releases, while the mismatched artifact is a transitive dependency's
generation, and the app's plugin manager reads only `peerDependencies`.

## Decision

1. **Declare the harness's generation.** `@earendil-works/pi-ai` moves to
   `^0.87.1` — the exact range `dsh-llm-pi-ai@0.2.0-rc.2` declares — and the
   development dependencies move to `0.2.0-rc.2`, so typecheck and tests run
   against the contract the plugin is installed into.
2. **Normalize at the route's own boundary.** `contextTolerantStreams()` wraps
   the protocol implementation and calls `normalizeContext()` on whatever
   context arrives. The call is idempotent for an already-normalized transcript
   (the 0.87 host folds first), so one release serves both context contracts and
   neither failure mode above can recur while the shim is in place. *This
   amends [ADR 0001](0001-delegate-chat-to-official-pi-ai-adapter.md)*: the
   route now contributes one thing beyond the Ollama-specific facts — context
   normalization — and that is what makes the delegation survive a harness on
   another pi-ai generation.
3. **Watch the boundary from both ends.** `scripts/check-pi-ai-alignment.mjs`
   (in `pnpm check`, and in the scheduled `pi-ai-drift` workflow against the
   registry's `next` channel) fails when this package's declared range and the
   harness's admit no common version. The plugin additionally logs one
   mount-time warning when it can reach the installed harness's declaration and
   either the copy it loaded or the range it declares falls outside it. That
   read is best-effort by design — it tries the host's CommonJS resolver, the
   ESM resolver the plugin's own `@deepseek-ai/*` imports go through, and the
   app's `app.asar` runtime manifest, then stops with silence and one debug
   line, because a host that hides its manifest must not lose a working route
   over a diagnostic. The CI check is the reliable signal; the mount warning
   only covers installations that already carry this code.

Rejected: letting the host build the provider from a declarative profile, which
would remove our pi-ai copy from the request path entirely. `dsh-llm-pi-ai`
does not export its profile resolution, and no pi-ai instance is shared with
plugins, so a route cannot obtain the harness's copy — and the redesign would
re-open ADR 0001's trade-offs for no additional protection beyond (2).

## Consequences

- A future app release that moves pi-ai again is reported by the scheduled CI
  check before users install it, and by the mount warning in installations that
  already carry this build.
- The supported target is the generation the dev dependencies pin; older
  harnesses keep working because the shim covers the contract that actually
  changed (the request context), not because every 0.85/0.87 difference was
  audited. A 0.87 build on a newer, unknown harness remains the CI's problem to
  catch first.
- The shim is a compatibility layer with a cost: it is the one place in the
  request path where the plugin adapts to a *foreign* contract, and its
  idempotence is what keeps it honest. `tests/generation.test.ts` pins both
  context shapes at the wire level (system prompt and tool declarations present
  in the request body), so the layer cannot rot silently.
- This package's pi-ai dependency must be bumped in lockstep with the harness
  generation. `pnpm check` fails until it is, which is the intended pressure.
