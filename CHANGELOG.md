# Changelog

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
