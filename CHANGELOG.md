# Changelog

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
