# ADR 0002 — Route name, settings namespace, and the level vocabulary

Status: accepted (2026-09-29)

## Context

Three names are user-visible and hard to change later: the provider route a
session stores (`provider/model` ids live in session logs), the settings
namespace the configuration surfaces address, and the reasoning-level ids the
composer shows.

The prior art (`dsh-llm-ollama`) already registers a route named
`ollama-cloud`, and the harness addresses a route's configuration by
`settingsNs` derived from the loader entry id.

## Decision

- **Route**: `ollama-cloud` — the provider's own name, and the id users type
  into settings. Mutually exclusive with `dsh-llm-ollama`, which registers the
  same route; both installed fails loudly at mount. Documented in both READMEs.
- **Loader row id / settings namespace**: `llm-ollama-cloud`. The row id is
  what the settings layer keys by and what a profile patch addresses, so it
  must not collide with the prior art's `llm-ollama`.
- **Level vocabulary**: exactly the harness/pi-ai levels
  (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) as the selectable
  ids, with Ollama's own spelling carried as the wire value. A model whose
  metadata is boolean offers `off` + `high`; a level the metadata never
  reported is never offered.
  *Amended by [ADR 0005](0005-live-endpoint-catalog.md)*: "never reported" now
  has one bounded exception — a model `/api/tags` lists that `/api/show` could
  not describe keeps the standard ladder, because the endpoint asserted the
  model exists and asserted nothing about its levels. Every level an endpoint
  *does* report is still the only set offered.

## Consequences

- Switching between the two Ollama plugins needs no session-log migration,
  because both store `ollama-cloud/<model>`.
- An ollama-cloud entry in the settings document is owned by this plugin; the
  other plugin's `llm-ollama` section is untouched, so uninstalling either one
  leaves no dangling configuration for the other to misread.
- Reasoning levels are comparable across providers in the same picker; Ollama's
  real ladder is still what decides which of them a given model accepts.
