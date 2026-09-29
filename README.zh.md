# dsh-ollama-cloud

[English](README.md) | 中文

DeepSeek Harness 的 Ollama Cloud 供应商插件：装完即用，并且**每个模型的思维链强度都是可调的**。

聊天走 Ollama 的 OpenAI 兼容接口（`https://ollama.com/v1`），模型发现走它自己的原生接口（`/api/tags`、`/api/show`），Web 搜索/抓取则注册成 Harness 的 `ctx.web` 能力。每个模型对外公布的思考档位（off / low / high / max 等）直接来自 Ollama 对该模型的 `thinking` 元数据，所以 composer 里的 Effort 选择器调的是真实能力，不是猜的。

## 安装

```sh
# 预构建 tarball（推荐，无需构建授权）
dsh plugin --profile web add --force \
  https://github.com/Asheblog/dsh-ollama-cloud/releases/latest/download/dsh-ollama-cloud.tgz

# 或者直接从 GitHub 源码安装（仓库内跟踪了构建产物）
dsh plugin --profile web add github:Asheblog/dsh-ollama-cloud
```

安装后重启 Harness，然后在 **Settings → Models** 里给 Ollama Cloud 填 API Key（写入只写凭据存储），或者直接提供环境变量：

```sh
export OLLAMA_API_KEY=...        # Linux / macOS
$env:OLLAMA_API_KEY = "..."      # Windows PowerShell
```

Key 在 <https://ollama.com/settings/keys> 申请。模型目录与元数据接口是匿名的，所以**没填 Key 也能看到模型列表**，只是发请求会报 `MISSING_CREDENTIAL`。

> **与 `dsh-llm-ollama` 二选一。** 两者都注册 `ollama-cloud` 这条 route，同时安装会在装载时冲突（`DUPLICATE_ADAPTER`）。装本插件前请先从 profile 的 bundles 里移除 `dsh-llm-ollama`。

## 用法

1. 在 composer 的模型选择器（或 `/model`）里选一个 `ollama-cloud` 模型。
2. 同一个菜单里选**推理强度**：可选项随模型变化，默认值取自 Ollama 的模型默认值。
3. 思考内容会像其他供应商一样出现在会话里；强度是**按会话**保存的，运行中的回合保留它开始时的档位。

### 内置模型与档位

以下快照取自 2026-09-29 的实际元数据（`/api/tags` + `/api/show`）：

| 模型 | 上下文 | 视觉 | 可选档位 | 默认 |
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
| `mistral-large-3:675b` | 262,144 | ✔ | （不支持思考） | — |

Ollama 只支持布尔思考开关的模型（如 `kimi-k2.6`、`gemma4:31b`）只暴露 Off 与 High 两档——High 在 wire 上就是「打开思考」；`minimax-m2.7` 的元数据是 `[true]`，关不掉思考，所以只有 High。`minimax-m3` 只报告了思考能力、没有档位阶梯，因此走标准档位且不声明默认值；任何「目录与你的配置都没描述过」的模型同理。

### 刷新模型目录

Ollama 会下架云端模型（被下架的模型返回 HTTP 410）。本插件内置目录是快照，不是权威：

- **从端点发现**：调用 `llm/discoverModels` 的界面（如插件市场的 provider 卡）会列出端点当前提供的模型及其上下文窗口与输入类型；只有能被 `/api/show` 完整描述的模型才会作为候选返回。
- **手工增删**：在插件配置里覆盖 `models`（见下）。`enabled: false` 可以把某个内置模型藏起来。

## 配置

所有字段都可以在插件配置页修改，也会在 profile 的 `cordis.patch.yml` 里按行覆盖：

```yaml
- id: llm-ollama-cloud
  name: 'dsh-ollama-cloud'
  config:
    apiKeyEnv: OLLAMA_API_KEY        # 凭据引用；置空字符串 = 不用认证（本地服务）
    baseURL: https://ollama.com/api  # 原生 API 根；本地 Ollama 写 http://localhost:11434/api
    maxTokens: 32768                 # 未单独声明的模型的输出上限
    defaultContextWindow: 262144     # 未单独声明的模型的上下文回退
    streamIdleTimeoutMs: 300000      # 流式读取的空闲上限
    requestTimeoutMs: 15000       # 非聊天请求的每次尝试预算（模型发现、Web 搜索/抓取）
    retryPolicy:                     # 由 dsh-llm-retry 执行
      mode: normal
      maxRetries: 5
    models:                          # 按 id 覆盖内置目录；未知 id 追加到末尾
      - id: gpt-oss:20b
        contextWindow: 131072
        reasoningEfforts: { off: none, low: low, medium: medium, high: high }
        defaultEffort: medium
      - id: brand-new-model          # 内置目录还没有的新模型
        name: Brand New
        contextWindow: 131072
        reasoningEfforts: { off: none, high: high }
        defaultEffort: high
      - id: retired-model            # 内置模型退役了？藏起来即可
        enabled: false
```

字段语义：

- `reasoningEfforts` 的**键**是选择器提供的档位（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`），**值**是发到 Ollama 的拼写（例如 `off: none`）。`false` 表示该模型不可调思考；省略则沿用内置条目；若 id 既不在内置目录、条目里也没写，则走标准档（`off`/`low`/`medium`/`high`/`max`）且不声明默认档位。
- `defaultEffort` 必须在 `reasoningEfforts` 里；会话没选档位时用它，否则跟随模型自己的默认。
- 覆写条目只在**没有**改 `reasoningEfforts` 时才继承内置默认档位——改了档位集合就以你的声明为准。
- 显式写了 `defaultEffort` 但不在可选档位里会在装载时报错，而不是静默降级。

### 本地 Ollama / 自建端点

```yaml
- id: llm-ollama-cloud
  config:
    baseURL: http://localhost:11434/api
    apiKeyEnv: ''                     # 本地服务不需要 Bearer
```

`baseURL` 会被归一化：裸主机（`https://ollama.example`）补 `/api`，`/v1` 写法映射回 `/api`，显式自定义路径（`https://gateway.example/ollama`）原样保留。

### Web 搜索与抓取

插件把 Ollama 的 `/api/web_search`、`/api/web_fetch` 注册为 `ctx.web` provider（注册本身不改变任何部署策略）。要在 profile 里启用：

```yaml
- id: web
  config:
    searchProvider: ollama-cloud
    fetchProvider: ollama-cloud
```

两者复用同一条凭据引用与 `baseURL`；请求带凭据，所以**重定向一律失败**，且每次尝试有 15 秒预算、传输层瞬时失败重试一次。

## 兼容性

- 验证目标：DSH `0.2.0-rc.1`（`@deepseek-ai/dsh-*` 的 peer 范围是 `>=0.2.0-rc.1`，无上界；官方新版本若出现回归会记入 `dsh.compatibility.blocklist`）。
- 运行依赖：`@earendil-works/pi-ai`（与 Harness 自身的 `dsh-llm-pi-ai` 同源）。
- 协议解析、流式转换、回放与工具调用全部委托官方 `@deepseek-ai/dsh-llm-pi-ai` 的 `PiAiAdapter`，本插件只提供 Ollama 特有的连接事实、模型目录与档位元数据。设计依据见 [ADR 0001](docs/adr/0001-delegate-chat-to-official-pi-ai-adapter.zh.md)。
- 已知限制：Ollama 的 OpenAI 兼容面不支持 `tool_choice`、`logprobs`，也不提供 prompt cache 统计；用量字段以它实际返回的为准。

## 开发

```sh
pnpm install
pnpm check        # typecheck + 单测 + 构建
pnpm pack         # 产出 tarball
node scripts/check-tarball.mjs   # 校验产物可独立安装
```

仓库跟踪 `lib/` 构建产物，因此 GitHub 源码安装不需要构建授权。插件行名固定为 `llm-ollama-cloud`（设置命名空间同此）。

## 许可

MIT
