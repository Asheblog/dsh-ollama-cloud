# dsh-ollama-cloud

English | [中文](README.zh.md)

Ollama Cloud provider for DeepSeek Harness: install it and the provider is configured — with **per-model thinking strength you can actually adjust**.

Chat runs on Ollama's OpenAI-compatible surface (`https://ollama.com/v1`), model discovery reads Ollama's own native API (`/api/tags`, `/api/show`), and Ollama's web search/fetch endpoints register as harness `ctx.web` providers. The thinking levels each model publishes (off / low / high / max, …) come straight from that model's `thinking` wire metadata, so the composer's Effort selector adjusts real capability instead of a guess.

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

### Shipped models and levels

Snapshot of live metadata (`/api/tags` + `/api/show`) taken 2026-09-29:

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

Ollama retires cloud models (a retired id answers HTTP 410). The shipped catalog is a snapshot, not an authority:

- **Discover from the endpoint**: any surface calling `llm/discoverModels` lists what the endpoint currently serves, with context windows and input modalities. Only models `/api/show` can fully describe become candidates.
- **Edit by hand**: override `models` in the plugin configuration (below). `enabled: false` hides a shipped model.

### Cloud usage in the UI

The plugin ships a browser half that renders in the host's own surfaces — no
separate page, and no provider-UI shell plugin needed:

- **Models page card**: inside the Ollama Cloud row (`Settings → Models`), one
  meter per billing window with its remaining share and reset line, the primary
  window's per-model request counts, the write-only **API key** field, and a
  refresh button.
- **Sidebar row**: a compact remaining-quota line under the session list; click
  it for the per-window detail. It refreshes when the sidebar mounts and every
  15 minutes after that.

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
    retryPolicy:                     # executed by dsh-llm-retry
      mode: normal
      maxRetries: 5
    models:                          # merges over the built-in catalog by id; new ids append
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

- `reasoningEfforts` keys are the levels the picker offers (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`); values are the spellings sent to Ollama (`off: none`). `false` declares a model with no thinking control; omission inherits the built-in entry, and an id neither the catalog nor the entry describes takes the standard ladder (`off`/`low`/`medium`/`high`/`max`) with no default claimed.
- `defaultEffort` must be one of the offered levels. It is materialized when a session picks none; otherwise the model's own default applies.
- An override inherits the built-in default level only while it leaves `reasoningEfforts` alone — changing the level set makes the declaration authoritative.
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

- Verified against DSH `0.2.0-rc.1` (peers are `>=0.2.0-rc.1` with no upper bound; a future regression is recorded in `dsh.compatibility.blocklist`).
- Runtime dependency: `@earendil-works/pi-ai` (the same library the harness's own `dsh-llm-pi-ai` uses).
- Protocol translation, streaming, replay, and tool calls are delegated wholesale to the official `@deepseek-ai/dsh-llm-pi-ai` `PiAiAdapter`; this plugin contributes Ollama-specific connection facts, the model catalog, and level metadata. Rationale: [ADR 0001](docs/adr/0001-delegate-chat-to-official-pi-ai-adapter.md).
- The browser half renders only in host slots (`settings.models.provider-card`, `sidebar.footer.action`) with host theme tokens; it requires no other client package. Its RPC channel (`/ollama-cloud` + `usage/read`) matches what the ecosystem's Ollama provider UIs already call, so one of those reads this plugin's usage too.
- Known limits: Ollama's OpenAI-compatible surface supports neither `tool_choice` nor `logprobs`, and reports no prompt-cache statistics; usage is whatever it actually returns.

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
