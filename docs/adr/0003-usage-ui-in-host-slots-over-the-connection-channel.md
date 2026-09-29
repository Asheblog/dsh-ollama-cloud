# ADR 0003 — Usage UI in host slots over the plugin's own connection channel

Status: accepted (2026-09-29)

## Context

The account's allowance lives behind `GET <native base>/usage`, which needs the
API key. Users want to see it where they already work, and without depending on
a third-party provider-UI shell plugin: this deployment's Models page renders
the provider row, but its editor refuses namespaces it does not know, so the
card has to bring its own surface for the key as well as the numbers.

Three questions had to be settled: where the UI renders, how it reaches
credentialed data, and how the channel gets mounted on the desktop composition.

## Decision

- **Render in the host's own slots.** `settings.models.provider-card` (keyed by
  this plugin's settings namespace) puts the card inside the Models page row;
  `sidebar.footer.action` carries the compact quota row. Both are core seats
  declared by official packages, both take React components, and neither needs
  another plugin to exist.
- **All credentialed reads stay on the host.** The browser half calls only the
  plugin's own connection channel (`/ollama-cloud`, endpoints `usage/read`,
  `credential/status`, `credential/set`) and never receives the key; writes go
  through the harness credentials seam, and the target reference is the
  configured one rather than whatever a client names. The channel and endpoint
  names deliberately match what the ecosystem's Ollama provider UIs already
  call, so those UIs read this plugin's usage unchanged.
- **The bundle patch repairs the connection row.** `connection.rpc.handle()`
  mounts channels through the service's own `webServer`, but the web-app bundle
  declares that row with `inject: [webRuntime]` only, so the registration
  throws and the channel never mounts. The patch restates the whole `inject`
  array (`[webRuntime, webServer]`) because patches replace the key wholesale.

## Consequences

- One plugin provides the provider, its thinking levels, its usage, and its key
  entry: no provider-UI shell is required, and nothing else has to be installed
  for the Models page row to be usable.
- A deployment whose web-app bundle later adds entries to the connection row's
  `inject` would lose them to this patch's stale list; the list is restated
  from the current bundle and must be re-checked when that row changes.
  Compositions without a connection row (headless) skip the patch with a
  warning, and the browser half is simply absent there.
- Because the channel mounts through the connection service, the client also
  inherits its host/origin fence and browser-session authentication; the plugin
  never exposes an unauthenticated route of its own.
- A running host that has not reloaded the plugin answers the card's call with
  the "unknown endpoint" diagnostic, which the card renders as a restart hint
  instead of a failure.
