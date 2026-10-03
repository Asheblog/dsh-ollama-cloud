# ADR 0005 — The configured endpoint is the catalog, and the shipped snapshot is only a fallback

Status: accepted (2026-10-03)

## Context

`0.1.0` shipped a curated catalog: the 17 models Ollama Cloud served on
2026-09-29, each with the context window, input modalities, and thinking-ladder
metadata that `POST /api/show` reported that day. Every capability the plugin
serves — including the levels the composer's Effort selector offers and the
default it materializes — was therefore a copy of one endpoint answer, frozen at
release time.

Ollama does not freeze. It adds models, retires others (`410`, with the id
sometimes still listed for a while), and changes a model's `thinking` metadata
(level sets and defaults) between releases. Two consequences followed, and both
shipped:

- **A retired model keeps being offered.** The route advertises what its catalog
  says, so the picker offers a model that answers `410` at request time, and the
  failure arrives as a provider error rather than as an absence.
- **New models, and re-levelled ones, need a plugin release.** `0.2.x` gained a
  live listing through `llm/discoverModels`, but that surface is *advisory*: the
  harness offers the answer to a configuration page for adoption, stores
  nothing, and the harness's own `LlmDiscoveredModel` shape does not even carry
  reasoning metadata. Nothing refreshed the route, so the practical workaround
  was to re-release the plugin with a new snapshot — exactly the maintenance the
  plugin exists to avoid (it happened once during `0.2.x` development for
  `deepseek-v4.1-flash`).

The catalog also has to survive the two conditions a refresh cannot assume:
a boot with no reachable endpoint, and an endpoint that answers `/api/tags` but
fails a `/api/show`.

## Decision

1. **One refresh reads the endpoint and adopts the answer, at mount and on an
   interval.** `live-catalog.ts` performs it: `GET <base>/tags` for membership,
   `POST <base>/show` per model for metadata, decoded by the same
   `decodeShowResponse` the advisory discovery surface uses, so a capability a
   user may adopt and a capability the route serves can never disagree. The pass
   is not awaited at mount (a slow endpoint must not hold up a boot), it is
   throttled so two passes cannot overlap, and a failure is logged and leaves
   the catalog in use exactly as it was. `autoRefresh` (default `true`) and
   `refreshMinutes` (default `1440`) control it, and the scheduler re-reads both
   on every tick — including the idle tick that runs while the refresh is off,
   which touches no network and exists so switching it back on needs no reload.
2. **The catalog is layered, and each layer answers only what it knows.**

   | Layer | Authority |
   | --- | --- |
   | `models:` configuration | per-id overrides and `enabled: false` retirements |
   | the endpoint, just fetched | membership and every declared capability |
   | the cache of the last fetch | the same answer, read before the network answers |
   | the shipped snapshot | display names, and the pre-fetch fallback |

   The merge policy lives in `catalog.ts` (`mergeCatalogEntry`): the endpoint
   wins for every field it answered, the snapshot fills what it did not, and
   *"the endpoint said nothing"* (`reasoningEfforts` omitted) is kept distinct
   from *"the endpoint said no thinking"* (`reasoningEfforts: false`). A default
   level is inherited only while the level set is, mirroring the rule
   configuration already follows.
3. **Membership shrinks by retirement, never by silence.** `discoverCatalog`
   separates three outcomes, because they mean different things: *described*
   (metadata), *retired* (`404`/`410` — the endpoint stating its own listing is
   stale, dropped from the catalog), and *unknown* (timeout, 5xx, 429 — the
   model stays listed with only what the listing said). Without that last case a
   single slow `/api/show` would hide a real model for a whole interval; without
   the retirement case the picker would offer a model that cannot answer. An
   **empty** listing rejects the pass entirely: a model picker with nothing in
   it is not a state the UI can recover from, and "everything retired at once"
   is a far less likely explanation than a gateway hiccup.
4. **The cache is what makes a restart — and an offline boot — honest.** It
   lives under the harness home, resolved through the harness's own
   `@deepseek-ai/dsh-home-paths` helper (`<harness home>/cache/dsh-ollama-cloud/catalog.json`),
   so it agrees with every other piece of harness user data about where user
   data lives and is not lost when the package is reinstalled or updated; it is
   written atomically (temporary file plus rename) and validated whole on read
   (a malformed entry discards the file rather than serving a partially trusted
   catalog). One endpoint at a time: a catalog fetched from another `baseURL` is
   ignored rather than merged.
5. **Adoption reaches the running session through the revision, not a reload.**
   `CatalogSource.revision()` joins the volatile references the connection
   reader memoizes on (`createConnectionReader`), so adopting a changed catalog
   re-resolves the route, rebuilds the adapter's profile from the same facts the
   request path reads, and the model list, context windows, and effort levels
   all move together. A pass that only *confirmed* the catalog does not move the
   revision, so nothing rebuilds for nothing.

Rejected: **keeping the snapshot authoritative and re-releasing per change** —
that is the maintenance burden this ADR exists to remove, and it cannot react to
a retirement between releases. Rejected: **automatically calling the harness's
`llm/discoverModels` and adopting its answer into the user's settings** — that
surface is for a *draft* endpoint in a configuration page, it carries no
reasoning metadata, and writing the user's configuration from a background timer
would make the plugin's own catalog invisible to the settings layer it just
wrote. Rejected: **refreshing without a cache** — the first model list of every
boot would then race the network, and an offline boot would serve a snapshot
whose age nobody can see, which is precisely the failure mode being fixed.
Rejected: **a TTL that skips the mount refresh** — the request is one anonymous
listing plus one per model, and "current as of this boot" is the whole promise.

## Consequences

- A model Ollama adds, retires, or re-levels reaches a running session on the
  next pass (at most one interval) and every session after that at mount, with
  no plugin release. The shipped snapshot stays in the repository as the
  offline layer and as the source of display names; it is no longer a
  correctness surface, so a stale snapshot is a cosmetic issue rather than a
  routing one.
- Two new configuration fields, both read live. Setting `autoRefresh: false`
  stops every network refresh: the route then serves the cache of the last
  fetch (or the shipped snapshot before any fetch), and the scheduler's only
  remaining work is re-reading these two values on an idle cadence so switching
  the refresh back on is honored without a reload. That is the honest setting
  for an air-gapped or quota-limited deployment.
- The cache holds one endpoint at a time *per harness home*. Two profiles
  sharing a home but pointed at different endpoints each fall back to the
  shipped snapshot for the first second of a boot, until their own mount
  refresh lands; nothing is corrupted, because the endpoint validates on read
  and the refresh overwrites it either way.
- The cache is per-harness-home and per-endpoint; a user who switches `baseURL`
  serves the snapshot until the new endpoint answers. That is deliberate — a
  merged catalog across two endpoints would offer models the configured endpoint
  does not have.
- `discoverCatalog` now distinguishes retirement from failure, so the advisory
  `llm/discoverModels` surface inherits the same rule: a `404`/`410` entry is no
  longer a candidate, while an undescribed one still is not either (adoption
  needs metadata).
- The suite runs with a throwaway `DSH_HOME`: the cache made the plugin's tests
  capable of writing into a developer's real catalog, and a test that adopted a
  fake catalog would otherwise decide what the next real boot serves.
