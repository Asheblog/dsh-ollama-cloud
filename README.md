# dsh-ollama-cloud

English | [中文](README.zh.md)

Ollama Cloud provider for DeepSeek Harness: install it and the provider is configured — with **per-model thinking strength you can actually adjust**.

Chat runs on Ollama's OpenAI-compatible surface (`https://ollama.com/v1`), model discovery reads Ollama's own native API (`/api/tags`, `/api/show`), and Ollama's web search/fetch endpoints register as harness `ctx.web` providers. The thinking levels each model publishes (off / low / high / max, …) come straight from that model's `thinking` wire metadata, so the composer's Effort selector adjusts real capability instead of a guess.

The catalog is not frozen at release either. **On every mount the plugin asks the configured endpoint what it serves and adopts the answer for the running session**, then caches it for the next boot; a long-running session refreshes again on an interval. A model Ollama adds, retires, or re-levels therefore reaches you without waiting for a plugin update.

## Install

```sh
# Prebuilt tarball (recommended: no build authorization needed)
dsh plugin --profile web add --force \
  https://github.com/Asheblog/dsh-ollama-cloud/releases/latest/download/dsh-ollama-cloud.tgz

# Or straight from GitHub sources (build artifacts are tracked in the repo)
dsh plugin --profile web add github:Asheblog/dsh-ollama-cloud
```

Restart the harness, then give Ollama Cloud an API key in **Settings → Models** (stored write-only through the credentials service), or export one:

```sh
export OLLAMA_API_KEY=...        # Linux / macOS
$env:OLLAMA_API_KEY = "..."      # Windows PowerShell
```

Keys come from <https://ollama.com/settings/keys>. The catalog and metadata endpoints are anonymous, so **the model list appears before any key exists** — only chat fails, with `MISSING_CREDENTIAL`.

> **Pick one of this plugin or `dsh-llm-ollama`.** Both register the `ollama-cloud` route, and installing both fails at mount time (`DUPLICATE_ADAPTER`). Remove `dsh-llm-ollama` from the profile's bundles first.

## Usage

1. Pick an `ollama-cloud` model in the composer's model menu (or `/model`).
2. Pick an **effort** in the same menu. The offered levels depend on the model, and the default comes from Ollama's own model metadata.
3. Thinking streams into the transcript like any other provider. The effort is stored per session; a running step keeps the level it started with.

### The catalog: the endpoint is the authority

Ollama adds and retires cloud models on its own schedule, so this plugin does not treat its own release as the model list. Every mount asks the configured endpoint what it serves — `GET /api/tags` for membership, `POST /api/show` for each model's context window, input modalities, and the thinking ladder plus default that model itself declares — and serves that answer. The layers, highest first:

| Layer | What it decides |
| --- | --- |
| Your `models` configuration | per-id overrides, additions, and `enabled: false` retirements |
| The endpoint, just fetched | which models exist, and every capability each one declares |
| The cache of the last fetch | the same answer, read from disk before the network answers |
| The shipped snapshot | display names, and the fallback until some fetch has succeeded |

Two consequences worth knowing:

- **A retired model leaves by itself.** A model the endpoint stops listing disappears, and one its listing still names but answers `404`/`410` for is dropped too — that answer is the endpoint saying its own listing is stale. A detail request that merely *fails* (timeout, 5xx, 429) keeps the model with what the listing said: a slow `/api/show` must not hide a real model for a whole refresh interval.
- **New models arrive with their own levels.** A model the snapshot never shipped keeps its id as the display name until a release gives it a prettier one; its thinking levels are still whatever `/api/show` reports.

What ships is the snapshot a session falls back to before its first successful fetch — live `GET https://ollama.com/api/tags` + `POST https://ollama.com/api/show` metadata taken 2026-09-29:

| Model | Context | Vision | Levels | Default |
| --- | ---: | :---: | --- | --- |
| `deepseek-v4.1-flash` | 1,048,576 | ✔ | Off / Low / High / Max | High |
| `deepseek-v4-pro:0813` | 1,048,576 | — | Off / Low / High / Max | Low |
| `kimi-k3` | 1,048,576 | ✔ | Off / Low / High / Max | Max |
| `kimi-k2.6` | 262,144 | ✔ | Off / High | High |
| `kimi-k2.7-code` | 262,144 | ✔ | Off / High | High |
| `glm-5.3` | 1,048,576 | — | Low / High / Max | Max |
| `glm-5.3-flash` | 1,048,576 | ✔ | Low / High / Max | Max |
| `glm-5.2` | 1,048,576 | — | Off / High / Max | High |
| `gpt-oss:120b` | 131,072 | — | Low / Medium / High | Medium |
| `gpt-oss:20b` | 131,072 | — | Low / Medium / High | Medium |
| `minimax-m3` | 512,000 | ✔ | Off / Low / Medium / High / Max | — |
| `minimax-m2.7` | 196,608 | — | High | High |
| `nemotron-3-ultra` | 262,144 | — | Off / High | High |
| `nemotron-3-super` | 262,144 | — | Off / High | High |
| `nemotron-3-nano:30b` | 262,144 | — | Off / High | High |
| `gemma4:31b` | 262,144 | ✔ | Off / High | Off |
| `mistral-large-3:675b` | 262,144 | ✔ | (no thinking control) | — |

Models whose metadata is a boolean switch (`kimi-k2.6`, `gemma4:31b`, …) expose Off and High only — on the wire, High means "thinking on". `minimax-m2.7` reports `[true]`, so thinking cannot be switched off and only High is offered. `minimax-m3` reports the thinking capability without a level ladder, so it takes the standard ladder and claims no default; the same applies to any model neither the catalog nor your configuration describes.

### Refreshing the catalog

On by default, and nothing about it blocks a boot:

- **At mount** — one refresh as soon as the route is up. The model list is already correct before it lands, because the cache below answers first.
- **On an interval** — `refreshMinutes` later (default `1440`, i.e. daily), and again after each pass. Every pass re-reads the live configuration, so switching the refresh off or changing the interval applies at the next tick instead of requiring a reload; while it is off (or mount-only) the scheduler still ticks every few minutes without touching the network, so switching it back on is honored the same way.
- **The cache** — `<harness home>/cache/dsh-ollama-cloud/catalog.json`, resolved through the harness's own home helper: written atomically, validated on read, ignored when it is malformed or belongs to another endpoint. It lives outside the installed package, so updating the plugin keeps it, and it is what an offline restart — or any restart's first second — is served from.

Turn the whole thing off with `autoRefresh: false`: the route then serves the cache of the last fetch (or the shipped snapshot before any fetch), and never opens a connection on its own — the honest setting for an air-gapped or quota-limited deployment. `refreshMinutes: 0` keeps the mount refresh and drops the periodic one.

The manual surfaces remain:

- **Discover from the endpoint**: any surface calling `llm/discoverModels` lists what the endpoint currently serves, with context windows and input modalities. Only models `/api/show` can fully describe become candidates.
- **Edit by hand**: override `models` in the plugin configuration (below). `enabled: false` hides a shipped model.

### Cloud usage in the UI

The plugin ships a browser half that renders in the host's own surfaces — no
separate page, and no provider-UI shell plugin needed:

- **Models page card**: inside the Ollama Cloud row (`Settings → Models`), one
  meter per billing window with its remaining share and reset line, the primary
  window's per-model request counts, the write-only **API key** field, and a
  refresh button.
- **Sidebar row**: a compact remaining-quota progress bar under the session
  list — the label and percentage on one line, the bar beneath it, filled with
  what is *left* and graded by the remaining share (`ok` / `warn` / `critical`)
  so a shrinking bar reads the same way as the number. Click it for the
  per-window detail; a hover title carries the reset line. It refreshes when the
  sidebar mounts and every 15 minutes after that, and the collapsed 56px rail
  keeps the mini bar plus the percentage with no label.

The card reads usage through this plugin's own host channel (`/ollama-cloud`),
so the API key stays on the host and never reaches the browser. A local or
self-hosted endpoint answers 404 on `/usage`; that renders as "this endpoint
does not report cloud usage" rather than an error, and the last good snapshot
keeps showing instead of disappearing.

> The usage channel needs the composition's `connection` row to inject
> `webServer`; this bundle's patch adds that (profiles without a connection row
> skip it). After installing or updating the plugin, restart the harness once —
> until then the card says so itself.

## Configuration

Every field is editable from the plugin settings page and overridable per row in the profile's `cordis.patch.yml`:

```yaml
- id: llm-ollama-cloud
  name: 'dsh-ollama-cloud'
  config:
    apiKeyEnv: OLLAMA_API_KEY        # credential reference; empty string = no auth (local servers)
    baseURL: https://ollama.com/api  # native API root; local Ollama: http://localhost:11434/api
    maxTokens: 32768                 # output cap for models that declare none
    defaultContextWindow: 262144     # context fallback for models that declare none
    streamIdleTimeoutMs: 300000      # maximum idle time between stream reads
    requestTimeoutMs: 15000       # per-attempt budget for the non-chat requests (discovery, web search/fetch)
    autoRefresh: true                # refresh the catalog at mount and on the interval
    refreshMinutes: 1440             # minutes between refreshes; 0 = refresh at mount only
    retryPolicy:                     # executed by dsh-llm-retry
      mode: normal
      maxRetries: 5
    models:                          # merges over the live catalog by id; new ids append
      - id: gpt-oss:20b
        contextWindow: 131072
        reasoningEfforts: { off: none, low: low, medium: medium, high: high }
        defaultEffort: medium
      - id: brand-new-model          # a model newer than the snapshot
        name: Brand New
        contextWindow: 131072
        reasoningEfforts: { off: none, high: high }
        defaultEffort: high
      - id: retired-model            # retire a shipped model
        enabled: false
```

Field semantics:

- `autoRefresh` and `refreshMinutes` control the catalog refresh described above. Both are read live, so a change takes effect at the next scheduled tick — see that section for what "off" still ticks for.
- `models` merges over whatever catalog is in force — the endpoint's live answer, or the shipped snapshot when no fetch has succeeded — and always wins by id, so `enabled: false` retires a model the endpoint still serves.
- `reasoningEfforts` keys are the levels the picker offers (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`); values are the spellings sent to Ollama (`off: none`). `false` declares a model with no thinking control; omission inherits the live entry's levels, and an id neither the endpoint nor the entry describes takes the standard ladder (`off`/`low`/`medium`/`high`/`max`) with no default claimed.
- `defaultEffort` must be one of the offered levels. It is materialized when a session picks none; otherwise the model's own default applies.
- An override inherits the in-force default level only while it leaves `reasoningEfforts` alone — changing the level set makes the declaration authoritative.
- A declared `defaultEffort` outside the offered set fails at mount instead of degrading silently.

### Local Ollama / self-hosted endpoints

```yaml
- id: llm-ollama-cloud
  config:
    baseURL: http://localhost:11434/api
    apiKeyEnv: ''                     # a local server needs no bearer token
```

`baseURL` is normalized: a bare host gains `/api`, a `/v1` spelling maps back to `/api`, and an explicit custom path (`https://gateway.example/ollama`) is kept as written.

### Web search and fetch

The plugin registers Ollama's `/api/web_search` and `/api/web_fetch` as `ctx.web` providers — registering changes no deployment policy. To use them:

```yaml
- id: web
  config:
    searchProvider: ollama-cloud
    fetchProvider: ollama-cloud
```

Both share the route's credential reference and `baseURL`. Requests carry the credential, so **redirects fail closed**; each attempt has a 15-second budget and one retry on a transient pre-response transport failure.

## Compatibility

- Verified against DSH `0.2.0-rc.1` and `0.2.0-rc.2` (peers are `>=0.2.0-rc.1` with no upper bound; a future regression is recorded in `dsh.compatibility.blocklist`).
- Runtime dependency: `@earendil-works/pi-ai`, declared at the generation the installed harness speaks (`^0.87.1` for harness `0.2.0-rc.2`). pi-ai is **not** a host-shared package, so this copy and the harness's own only agree while their generations do. The route normalizes the request context at its own boundary, which is the contract that changed between harness generations, so a `0.2.0-rc.1`-era host keeps working with this build; `pnpm check` and the scheduled `pi-ai-drift` workflow fail when the two declared ranges admit no common version, and the plugin logs one mount-time warning when it can reach the installed harness's declaration and this build falls outside it (best-effort: a host that hides its manifest reads as silence, and CI is the reliable signal). Rationale: [ADR 0004](docs/adr/0004-pi-ai-generation-alignment.md).
- Protocol translation, streaming, replay, and tool calls are delegated wholesale to the official `@deepseek-ai/dsh-llm-pi-ai` `PiAiAdapter`; this plugin contributes Ollama-specific connection facts, the model catalog, and level metadata. Rationale: [ADR 0001](docs/adr/0001-delegate-chat-to-official-pi-ai-adapter.md).
- The browser half renders only in host slots (`settings.models.provider-card`, `sidebar.footer.action`) with host theme tokens, declares `connection` in its `inject`, and requires no other client package: the usage channel (`/ollama-cloud` + `usage/read`) is the plugin's own, so no provider-UI shell has to exist for the card to work.
- Known limits: Ollama's OpenAI-compatible surface supports neither `tool_choice` nor `logprobs`, and reports no prompt-cache statistics; usage is whatever it actually returns. The catalog cache holds one endpoint at a time — pointing `baseURL` at a second endpoint serves the shipped snapshot until that endpoint answers.
- The model list, every model's context window and input modalities, and every thinking ladder come from the configured endpoint (`/api/tags` + `/api/show`), refreshed at mount and on an interval; the shipped snapshot only fills a display name for an id it already knew, and the gap before the first successful fetch. Rationale: [ADR 0005](docs/adr/0005-live-endpoint-catalog.md).

## Development

```sh
pnpm install
pnpm check        # typecheck + tests + build
pnpm pack         # produce the tarball
node scripts/check-tarball.mjs   # verify the artifact is independently installable
```

The repo tracks the `lib/` build artifacts, so a GitHub-source install needs no build authorization. The loader row id is `llm-ollama-cloud`, which is also the settings namespace.

## License

MIT
