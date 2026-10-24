# Changelog

## 0.5.0 — 2026-10-24

- **Fixes the usage channel on every `0.2.1` harness release, including
  `0.2.1-rc.3`.** The bundle patch repaired the composition's `connection` row
  by restating its `inject` as `[webRuntime, webServer]`. `0.2.1-rc.1` moved that
  row's startup dependency to the `webStartup` service (the `0.2.0` line injects
  `webRuntime`) — and `0.4.2` already listed `0.2.1-rc.1`/`rc.2` as compatible
  while still restating the old name, its predecessors admitting the `0.2.1`
  line through an unbounded `engines.dsh` — so on `0.2.1-rc.1`, `rc.2`, and
  `rc.3` a required row waited for a service no composition provides and the
  whole boot failed with `1 required plugin did not activate`. The patch now
  restates `[webStartup, webServer]`. Deployments have been working around this
  with a profile-level `- id: connection` patch, which is now redundant and can
  be deleted.
- `engines.dsh` becomes `>=0.2.1-rc.1` and the `@deepseek-ai/dsh-*` peer floors
  move with it. The `0.2.0` line is out: it names the startup service
  `webRuntime`, and a static patch cannot restate both spellings — the row would
  have to inject a name that release does not provide. `dsh.compatibility`
  records the verdict per release, so an installer reads the same answer instead
  of discovering it at boot.
- **The patch is now pinned by a test, not by memory.**
  `tests/composition.test.ts` reads the installed `@deepseek-ai/dsh-web-app`
  composition (`@deepseek-ai/dsh-web-app` is a development dependency for
  exactly that reason) and fails when the row it patches injects something this
  bundle does not restate, when the two lists stop matching the constant the
  mount diagnostic names, when `webRuntime` reappears, or when
  `dsh.compatibility.dshReleases` disagrees with `engines.dsh`. The same file
  asserts the composition and the pi-ai adapter come from one harness release.
  A rename upstream now breaks `pnpm test` instead of a user's boot.
- The mount-time diagnostic for a refused channel names the whole requirement —
  `the connection row must inject webStartup + webServer` — instead of only
  `webServer`, so a log line after a harness upgrade says what to re-check.
- Development dependencies move to `0.2.1-rc.3`, so typecheck and tests run
  against the contract this build is installed into. The lockfile also resolves
  `@earendil-works/pi-ai` `1.4.0` (a minor inside the `^1.1.0` range the
  `0.2.1-rc.3` harness declares); `tests/generation.test.ts` pins the wire
  contract for both context shapes through that copy, so the transcript
  boundary is verified rather than assumed.
- **Migration: one step, and only for a deployment that carries the workaround.**
  Delete the profile-level `- id: connection` patch that added `webStartup` —
  this bundle now does it — and restart. Nothing else moves: the provider id,
  settings namespace, credential reference, model catalog, and both UI seats are
  unchanged. Design rationale and the rejected alternatives (leaving the
  workaround to users; injecting `webServer` on this plugin's own row; moving
  the usage channel off the connection service):
  [ADR 0008](docs/adr/0008-composition-patch-follows-the-startup-service.md).

## 0.4.2 — 2026-10-19

- **Moves the route's pi-ai to the 1.x generation the `0.2.1` harness speaks.**
  `@earendil-works/pi-ai` moves from `^0.87.1` to `^1.1.0` — the range
  `dsh-llm-pi-ai@0.2.1-rc.2` declares, and the one the scheduled `pi-ai-drift`
  workflow has been failing on since 2026-10-17 — and the development
  dependencies move to `0.2.1-rc.2`, so typecheck and tests run against the
  contract this build is installed into. The lockfile resolves pi-ai `1.3.0`, a
  later minor the `^1.1.0` range admits.
- No route code changed: the `TranscriptContext` contract the route's shim
  normalizes is identical between 0.87 and 1.x, the pi-ai surface this route
  uses (`createProvider`, `openai-completions`, `ProviderStreams`, auth store,
  `normalizeContext`) is source-compatible, and `tests/generation.test.ts`
  already pins both context shapes at the wire level.
- `tests/alignment.test.ts` now asserts the boundary fact — the harness range
  must admit the loaded copy — instead of requiring the loaded copy's
  `major.minor` to equal the range's floor. `^1.1.0` admits `1.3.0`; a
  legitimate minor upgrade is no longer reported as drift.
- **Migration: none for a deployment that uses this plugin.** The provider id,
  settings namespace, credential reference, model catalog, and both UI seats are
  unchanged; only the supported harness generation moves forward. `0.2.0`-era
  hosts keep working through the context shim. Design rationale and the rejected
  alternatives: [ADR 0004](docs/adr/0004-pi-ai-generation-alignment.md).

## 0.4.1 — 2026-10-14

- **A transient failure no longer leaves the panel reading "unavailable".** The
  panel's read travels through whatever sits in front of the endpoint, and in
  this deployment that is a local proxy that intermittently answers a single
  `502 Bad Gateway` (observed live: 502, then 200 on a reconnected tunnel) or
  resets the connection. One such moment became 「读取用量失败。」/「额度不可用」 and
  the row kept that answer until its next poll — fifteen minutes — or a manual
  refresh; two incidents had the panel failing at boot while a read a minute
  later answered with real numbers (boot is also when the catalog refresh fires
  ~19 requests at the same endpoint through the same proxy). `readUsage` now
  retries once when the failure is transient — a transport failure before any
  response, a 429, or any 5xx — and reports everything else immediately, with
  `UsageError.retryable` carrying that judgement.
- A failed row polls every 60 seconds instead of waiting its 15-minute cadence,
  so a blip that outlives the retry heals by itself. (60 s is the rate the
  endpoint's own documentation recommends.)
- A failure now carries its diagnosis as a hover title — `OLLAMA_USAGE_FAILED:
  https://ollama.com/api/balance answered 502` — on the failure line and on the
  empty panel, so a screenshot of a failure says which layer broke. The visible
  copy stays localized; the title names a URL and a status, never a secret.
- An attempt that ran out its timeout is still not retried: it already spent the
  whole budget, and a doubled wait would tell the user nothing new.
- Design rationale and the rejected alternatives: [ADR 0007](docs/adr/0007-transient-failures-retry-and-recover.md).

## 0.4.0 — 2026-10-12

- **Fixes the quota panel: the account's allowance is read from
  `GET <base>/balance`.** The endpoint the panel was built on (`/usage`) had
  stopped answering the `limits` object it decoded — it now answers the
  request/token/cost time series Ollama documents — so every read was rejected
  as malformed and both surfaces showed their failure states ("云端用量 / 读取用量失败。",
  "额度不可用"). The endpoint that does report an allowance is `/balance`:
  per window, how much is *left* (`remaining_percent`), when it resets
  (`resets_at`), and the purchased balance behind it. The panel now reads that,
  converts the remaining share into the consumed fraction its meters draw, and
  shows whichever windows the plan actually has (session / weekly / monthly) —
  membership is the endpoint's answer, so a monthly window needs no plugin
  change.
- Deletes the per-model "usage sources" section, and the `models` field from
  the channel's wire window. The retired shape carried per-window model counts;
  the current contract has none (Ollama lists breakdowns by model and API key
  as "coming soon"), so the section could never render again. Nothing
  user-visible is lost, and a field that no endpoint sends is the exact
  phantom-contract class this release removes.
- Clamps a remaining reading just outside 0–100 instead of dropping the window
  (`100.4` is a percentage's rounding artefact, not a missing window), and
  keeps a window the endpoint reports without a reset instant — its label then
  falls back to the documented cadence (session 5h, weekly 7d, monthly 30d).
- Adds `scripts/check-live-allowance.mjs` (`pnpm run check:live`): it drives the
  real endpoint through the host decode, the wire projection, and the browser
  half's own decoder, and prints each window's remaining share. Every unit test
  in this repository pins a mock, and a mock is written from the same assumption
  as the code it feeds — which is how this drift went unnoticed while the suite
  stayed green. It needs the key and the network, so it stays out of `pnpm check`.
- **Migration: none for a deployment that uses this plugin.** The provider, the
  settings namespace, the credential reference, and both UI seats are unchanged;
  the panel simply reads the endpoint that reports an allowance. A third-party
  reader of this plugin's channel (`/ollama-cloud` + `usage/read`) must stop
  requiring the window's `models` field — nothing else about the wire shape moved.
- Also deleted with the retired shape: the reset-instant spellings it used to
  answer (`reset_at`, `reset`, `resetsAt`, epoch seconds and milliseconds,
  `reset_after_seconds`). The current contract answers `resets_at` as an ISO
  instant, and a window that carries no instant at all keeps the documented
  cadence (ADR 0006, decision 4).
- The wire window is now `{ usage, resetsAt? }`, which is why this is a minor
  release rather than a patch: a third-party reader of this plugin's channel
  should re-read the type.
- Design rationale, the live evidence, and the rejected alternatives (reading
  `/api/usage` too, or as a fallback; surfacing `purchased.balance_usd` here):
  [ADR 0006](docs/adr/0006-allowance-from-balance.md). It supersedes the
  endpoint assumption in ADR 0003, whose placement and channel decisions stand.

## 0.3.0 — 2026-10-03

- **The catalog now updates itself.** At mount — and then on a configurable
  interval (default: daily) — the plugin asks the configured endpoint what it
  serves (`GET /api/tags` + `POST /api/show`) and adopts the answer for the
  running session, so a model Ollama adds, retires, or re-levels no longer
  waits for a plugin release. Adopting a catalog moves the revision the
  connection reader memoizes on, which is how the new model list *and* every
  model's thinking levels reach the route — and any surface that lists this
  provider's models — without a restart.
- Caches that answer at `<DSH home>/cache/dsh-ollama-cloud/catalog.json`
  (atomic writes, validated on read, one endpoint at a time), so the first
  model list of any boot — and an offline boot — is the endpoint's last answer
  rather than the shipped snapshot. The snapshot is demoted to two jobs:
  display names for ids it already knew, and the fallback before any fetch has
  succeeded.
- Separates the three `/api/show` outcomes. A described model gets its
  metadata; a model the endpoint answers `404`/`410` for is retired from the
  catalog even while its own listing still names it; a model whose detail
  request merely *failed* stays listed with what the listing said, because one
  slow request must not hide a real model for a whole interval. An empty
  listing is refused outright — a model picker with nothing in it cannot be
  recovered from.
- Adds `autoRefresh` (default `true`) and `refreshMinutes` (default `1440`; `0`
  refreshes at mount only) to the plugin configuration. Both are re-read on
  every tick, and the refresh being off still ticks on an idle cadence — no
  network, just two configuration reads — so switching it back on is honored
  without a reload.
- The test suite no longer touches the developer's harness home: it runs every
  test against a throwaway `DSH_HOME` (`vitest.config.ts` + `tests/setup.ts`),
  which the catalog cache made necessary and which the suite now depends on.
- Design rationale, including the rejected alternatives:
  [ADR 0005](docs/adr/0005-live-endpoint-catalog.md).

## 0.2.3 — 2026-09-30

- Keeps this half's stylesheet across a hot reload. The client module system
  claims *every* untagged `<style>` in the document for whichever factory
  materializes next, and deletes a plugin's claimed tags when that plugin is
  replaced — so an untagged sheet appended by this plugin belonged to whoever
  loaded next and died with *their* rebuild. The symptom is silent and confusing:
  the new markup renders with no styling at all (a bare button reading
  "Ollama Cloud 额度剩余 89.8%每 5 小时重置" instead of a progress bar). The
  element is now tagged with this package's own id, which is the convention the
  official client preset uses for its emitted styles, and a head observer
  re-appends it if anything removes it anyway.

## 0.2.2 — 2026-09-30

- Redraws the sidebar quota row as a progress bar: label and percentage on one
  line, the bar under it. The bar fills with the remaining share and takes the
  severity hue from it (`ok` / `warn` / `critical`), so it agrees with the
  "remaining" label instead of pointing the other way; the reset line moves into
  the button's hover title, and the collapsed 56px rail keeps only the mini bar
  and its number.

## 0.2.1 — 2026-09-29

- Fixes every chat request failing instantly with `Cannot read properties of
  undefined (reading 'length')` on DSH `0.2.0-rc.2`. The harness moved to pi-ai
  0.87, which carries the prompt and the tool declarations inside the
  transcript; this package was built against pi-ai 0.85, whose request
  estimator has no `system` branch, so the failure happened while building the
  request — before any network I/O — on the first stream of every turn.
- Aligns `@earendil-works/pi-ai` with the generation the `0.2.0-rc.2` harness
  declares (`^0.87.1`) and normalizes the request context at the route's own
  boundary (idempotent), so one release serves both harness generations. A 0.87
  build on an older harness no longer silently drops the system prompt and
  every tool declaration — the mirror image of the same defect.
- Adds `scripts/check-pi-ai-alignment.mjs` (wired into `pnpm check` and into a
  scheduled `pi-ai-drift` workflow that probes the registry's `next` channel),
  which fails when this package's declared pi-ai range and the harness's admit
  no common version, plus a best-effort mount-time warning that names the same
  drift where the installation can still be reached. Rationale and rejected
  alternatives: [ADR 0004](docs/adr/0004-pi-ai-generation-alignment.md).
- Declares compatibility with DSH `0.2.0-rc.2`.

## 0.2.0 — 2026-09-29

- Adds the browser half: an Ollama Cloud usage card inside the official Models
  page row (`settings.models.provider-card`) and a compact remaining-quota row
  in the sidebar footer.
- Reads account usage from `GET <base>/usage` through a host-side connection
  channel (`/ollama-cloud`), so the API key never reaches the browser. A local
  or self-hosted endpoint's 404 renders as "does not report cloud usage", and
  the last good snapshot keeps showing.
- Adds a write-only API-key field to the card, storing values through the
  harness credentials seam under the configured reference.
- Repairs the composition's `connection` row (`inject: [webRuntime, webServer]`)
  from the bundle patch, which is what lets the usage channel mount on the
  desktop composition.

## 0.1.0 — 2026-09-29

First release.

- Registers the `ollama-cloud` provider route with chat delegated to the
  official `@deepseek-ai/dsh-llm-pi-ai` adapter on Ollama's OpenAI-compatible
  `/v1` surface.
- Ships a curated catalog of the 17 models Ollama Cloud served on 2026-09-29,
  each with the thinking levels its own `/api/show` metadata reports and the
  default effort that metadata declares.
- Publishes per-model reasoning metadata to the harness, so the composer and
  `/model` selector offer an Effort control that adjusts real capability.
- Adds `llm/discoverModels` support backed by `/api/tags` + `/api/show`.
- Registers Ollama's web search and fetch endpoints as `ctx.web` providers.
- Resolves credentials through the harness credentials seam (`OLLAMA_API_KEY`
  by default, environment fallback, empty reference for local servers).
