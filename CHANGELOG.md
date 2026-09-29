# Changelog

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
