# ADR 0001 — Delegate the chat protocol to the official pi-ai adapter

Status: accepted (2026-09-29)

Amended by [ADR 0004](0004-pi-ai-generation-alignment.md): the route now also
normalizes the request context at its own boundary. That is one more
contribution than the Decision below enumerates, and it is what lets this
delegation survive a harness running on a different pi-ai generation.

## Context

Ollama Cloud speaks an OpenAI-compatible Chat Completions surface at
`https://ollama.com/v1`. The harness already ships a generic adapter for that
dialect — `@deepseek-ai/dsh-llm-pi-ai` — which owns message conversion, tool
call replay, streaming translation, usage mapping, and the compat switches a
non-OpenAI endpoint needs.

Two alternatives promised less code without a third-party adapter:

1. **A pure configuration bundle** that adds the `ollama-cloud` profile to the
   built-in `llm-pi-ai` row. Rejected: a loader patch replaces a row's whole
   `config` rather than merging into it, so the bundle would clobber whatever
   providers the user already declared.
2. **A second `llm-pi-ai` row** under a different entry id. Rejected: the
   plugin registers the *entire installed pi-ai catalog* in the
   configurable-provider directory, so a second instance fails at mount with
   `DUPLICATE_DIRECTORY` before it can register anything.

## Decision

Register our own route (`ollama-cloud`) with our own `LlmAdapter` that
**delegates every chat operation to a `PiAiAdapter` instance**, and contributes
only the Ollama-specific facts around it: connection settings, the model
catalog, per-model thinking levels, and the default effort.

## Consequences

- Protocol behavior (streaming, replay, attachments, retries, tool calls) is
  exactly the harness's own pi-ai behavior, including future fixes.
- The plugin stays small enough to audit: no wire serializer of our own.
- We depend on the official adapter's exported constructor and profile shape
  (`PiAiAdapter`, `ResolvedPiAiProviderProfile`), which are stable but not
  versioned as a public API; a breaking change there is caught by the
  typecheck against the pinned devDependency, not at runtime.
- Ollama-native capabilities that the chat protocol does not cover
  (model discovery, web search/fetch) stay in this package, because they are
  not chat.
