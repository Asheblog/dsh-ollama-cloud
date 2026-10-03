# Changelog

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
