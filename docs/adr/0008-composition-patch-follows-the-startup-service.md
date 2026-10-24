# ADR 0008 — The composition patch follows the startup service's name

Status: accepted (2026-10-24). Supersedes decision 3 of
[ADR 0003](0003-usage-ui-in-host-slots-over-the-connection-channel.md).

## Context

The usage channel mounts through `connection.rpc.handle()`, and that call
registers its HTTP route through the **connection row's** own `webServer`: the
route's owner is the service's context, not the caller's. Measured against
`@deepseek-ai/cordis` 4.0.5, a caller that injects `webServer` on its own row
still throws `cannot get property "webServer" without inject`. The web-app
composition declares that row with its startup service only, so this bundle has
to restate the row's `inject` list — a patch replaces the array wholesale, with
no deep merge to append to.

Restating the list means this plugin carries a copy of a name it does not own.
That is the defect this release fixes, and the name is the row's dependency on
the composition's *web-runtime* service: the `0.2.0` line injects `webRuntime`,
while `0.2.1-rc.1` injects `webStartup` and no longer mentions `webRuntime`
anywhere. `0.4.2` listed `0.2.1-rc.1`/`rc.2` as compatible while the patch still
restated `webRuntime`; its predecessors `0.4.0`/`0.4.1` declared only the `0.2.0`
releases, but their `engines.dsh` had no upper bound and admitted the `0.2.1`
line anyway. On every one of those releases a required row waited forever and the
whole boot failed with `1 required plugin did not activate`, so deployments have
been working around it with a profile-level `- id: connection` patch.

Alternatives, and why each was rejected:

1. **Inject `webServer` on this plugin's own row and call `handle` from there.**
   Measured: the registration still throws, because the owner context is the
   connection service's. The probe lives in the test's rationale, not in
   production code.
2. **Leave the repair to a profile patch.** This is what deployments did. It
   makes a boot-breaking requirement part of every installation's setup, and it
   only works for people who read the README twice.
3. **Serve usage over a raw `webServer` route of this plugin's own.** Then the
   browser half can no longer call `connection.rpc.call`, and the channel loses
   the connection's host/origin fence and browser-session authentication — the
   security consequence ADR 0003 chose deliberately.
4. **Name both spellings in the inject list.** One of them does not exist in any
   given release, so the row waits for it forever. Strictly worse than choosing
   one.
5. **Resolve the name at runtime and patch dynamically.** The loader evaluates a
   row's `inject` before the plugin's code runs; a plugin cannot repair its own
   activation conditions.

## Decision

- The bundle patch restates `[webStartup, webServer]`: the composition's own
  entry for the `0.2.1` line, plus the service the channel needs.
- `engines.dsh` becomes `>=0.2.1-rc.1`, and the `@deepseek-ai/dsh-*` peer floors
  move with it. The `0.2.0` line is out of support, because a static patch
  cannot speak both names and that line cannot serve this channel anyway.
- The pair is written in two places on purpose: `cordis.patch.yml`, which the
  loader reads, and `USAGE_CHANNEL_ROW_INJECT` in `src/index.ts`, which the
  mount-time diagnostic names.
- `tests/composition.test.ts` compares the patch, that constant, and the
  installed `@deepseek-ai/dsh-web-app` composition on every `pnpm test`. It also
  pins the composition's release to the adapter's, and keeps
  `dsh.compatibility.dshReleases` consistent with `engines.dsh`.
- `@deepseek-ai/dsh-web-app` becomes a development dependency: the composition is
  the contract being patched, so a copy of it has to be reachable offline in CI.

## Consequences

- Installing this bundle is once again the whole setup for the usage channel on
  `0.2.1-rc.1` and later; the profile workaround is redundant and can be deleted.
- A rename upstream — or a new entry added to that row — breaks `pnpm test`
  rather than a boot. The failure mode being guarded is not a request error but a
  required row that never activates: the app refuses to start, which is exactly
  the case worth catching before release.
- The `0.2.0` line keeps `0.4.x`, whose patch restates the name that line's row
  actually injects (`webRuntime`). `dsh.compatibility.dshReleases` reports that
  verdict per release, so an installer reads the same answer without the
  changelog.
- The development install grows by the composition's dependency tree (client
  packages, directory pickers, the office bridge). That is the price of an
  offline, decisive guard; a fixture copied once would only detect our own drift,
  which is the assumption this incident already punished.
- If the harness ever stops routing `rpc.handle` through the row's `webServer`,
  the second entry becomes unnecessary. The composition test keeps passing on
  the first, and the diagnostic would still name `webServer`, so removing it
  stays a deliberate follow-up rather than an inference from a green suite.
