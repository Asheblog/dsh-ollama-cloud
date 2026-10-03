# dsh-ollama-cloud

[English](README.md) | 中文

DeepSeek Harness 的 Ollama Cloud 供应商插件：装完即用，并且**每个模型的思维链强度都是可调的**。

聊天走 Ollama 的 OpenAI 兼容接口（`https://ollama.com/v1`），模型发现走它自己的原生接口（`/api/tags`、`/api/show`），Web 搜索/抓取则注册成 Harness 的 `ctx.web` 能力。每个模型对外公布的思考档位（off / low / high / max 等）直接来自 Ollama 对该模型的 `thinking` 元数据，所以 composer 里的 Effort 选择器调的是真实能力，不是猜的。

模型目录同样不随插件版本冻结：**每次装载时插件都会问配置的端点当前提供哪些模型，并把答案用在本次会话里**，同时缓存给下次启动；长时间运行的会话还会按间隔再刷。于是 Ollama 新增、下架或改了档位的模型，都不需要等插件更新。

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

### 模型目录：端点说了算

Ollama 自己决定什么时候上架、下架云端模型，所以本插件不把自己的发布当作模型清单。每次装载它都会问配置的端点当前提供什么——`GET /api/tags` 决定有哪些模型，`POST /api/show` 给出每个模型的上下文窗口、输入类型，以及该模型自己声明的思考档位阶梯与默认档位——然后就用这个答案。优先级从高到低：

| 层 | 决定什么 |
| --- | --- |
| 你的 `models` 配置 | 按 id 的覆写、追加，以及 `enabled: false` 的下架 |
| 刚抓到的端点答案 | 有哪些模型，以及每个模型声明了什么能力 |
| 上次抓取的缓存 | 同一份答案，先于网络响应从磁盘读出 |
| 内置快照 | 显示名，以及首次成功抓取之前的兜底 |

两个值得知道的后果：

- **下架的模型会自己消失。** 端点不再列出的模型会消失；仍然列在清单里、但 `/api/show` 返回 `404`/`410` 的也会被剔除——那正是端点自己说"我的清单过期了"。而仅仅是**请求失败**（超时、5xx、429）的模型会保留，并沿用清单给出的信息：一次慢响应不该让真实模型在整个刷新间隔里都看不见。
- **新模型带着自己的档位出现。** 快照没见过的模型先用 id 作显示名，直到某个版本给它一个更好看的名字；它的思考档位仍然来自 `/api/show`。

仓库内置的是"首次成功抓取之前"的兜底快照，取自 2026-09-29 的实际元数据（`/api/tags` + `/api/show`）：

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

Ollama 只支持布尔思考开关的模型（如 `kimi-k2.6`、`gemma4:31b`）只暴露 Off 与 High 两档——High 在 wire 上就是「打开思考」；`minimax-m2.7` 的元数据是 `[true]`，关不掉思考，所以只有 High。`minimax-m3` 只报告了思考能力、没有档位阶梯，因此走标准档位且不声明默认值；任何「端点与你的配置都没描述过」的模型同理。

### 刷新模型目录

默认开启，且不会拖慢启动：

- **装载时**：route 起来后立刻刷一次。在它落地之前模型列表就已经是对的，因为下面这层缓存先回答。
- **按间隔**：`refreshMinutes` 分钟后（默认 `1440`，即每天一次），每刷完一次再排下一次。每次到点都重新读取实时配置，所以关掉刷新或改间隔会在下一轮生效，不用重载插件。
- **缓存**：`<DSH home>/cache/dsh-ollama-cloud/catalog.json`，原子写入、读取时校验，格式不对或属于另一个端点就忽略。它在安装包之外，所以更新插件不会丢；离线重启，以及任何一次重启的头一秒，都由它来回答。

`autoRefresh: false` 可以整个关掉（此时 route 用缓存，首次抓取前用内置快照）；`refreshMinutes: 0` 则只保留装载时那一次。

手工入口仍然保留：

- **从端点发现**：调用 `llm/discoverModels` 的界面会列出端点当前提供的模型及其上下文窗口与输入类型；只有能被 `/api/show` 完整描述的模型才会作为候选返回。
- **手工增删**：在插件配置里覆盖 `models`（见下）。`enabled: false` 可以把某个模型藏起来。

### 界面里的云端用量

插件带一个浏览器半侧，直接渲染在宿主自己的界面里——不另开页面，也不需要任何供应商 UI 壳插件：

- **Models 页卡片**：`设置 → Models` 的 Ollama Cloud 行内，每个计费窗口一条 meter（剩余百分比 + 重置时间），主窗口的每模型请求数，**只写**的 API Key 输入框，以及刷新按钮。
- **侧栏行**：会话列表下方一条紧凑的剩余额度**进度条**——上行是名称与百分比，下行是进度条；条内填充的是**剩余**份额，颜色随剩余档位变化（充足 / 偏低 / 告急），因此条越短数字越小，两者读起来一致。点击展开分窗口详情；悬停标题里带重置时间。侧栏挂载时拉一次，之后每 15 分钟刷新一次；收起成 56px 轨道时只保留迷你进度条与百分比。

卡片通过本插件自己的宿主通道（`/ollama-cloud`）读取用量，因此 API Key 始终留在宿主侧、不会进入浏览器。本地/自建端点对 `/usage` 返回 404 时显示"此端点不上报云端用量"而不是报错，并且已有快照会继续显示而不是消失。

> 用量通道需要组合里的 `connection` 行注入 `webServer`；本 bundle 的 patch 会补上（没有 connection 行的 profile 会跳过）。安装或更新后请**完整重启一次** Harness——在重启前卡片会自己说明这一点。

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
    autoRefresh: true                # 装载时与按间隔刷新模型目录
    refreshMinutes: 1440             # 刷新间隔（分钟）；0 = 只在装载时刷
    retryPolicy:                     # 由 dsh-llm-retry 执行
      mode: normal
      maxRetries: 5
    models:                          # 按 id 覆盖当前生效的目录；未知 id 追加到末尾
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

- `autoRefresh` 与 `refreshMinutes` 控制上面那套目录刷新。两者都按实时配置读取：关掉刷新、或改间隔，会在下一轮定时生效。
- `models` 覆盖的是**当前生效**的目录（端点的实时答案；首次抓取成功前是内置快照），并且始终按 id 优先，所以 `enabled: false` 能下架端点仍在提供的模型。
- `reasoningEfforts` 的**键**是选择器提供的档位（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`），**值**是发到 Ollama 的拼写（例如 `off: none`）。`false` 表示该模型不可调思考；省略则沿用实时条目的档位；若 id 端点与条目都没描述，则走标准档（`off`/`low`/`medium`/`high`/`max`）且不声明默认档位。
- `defaultEffort` 必须在 `reasoningEfforts` 里；会话没选档位时用它，否则跟随模型自己的默认。
- 覆写条目只在**没有**改 `reasoningEfforts` 时才继承当前生效的默认档位——改了档位集合就以你的声明为准。
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

- 验证目标：DSH `0.2.0-rc.1` 与 `0.2.0-rc.2`（`@deepseek-ai/dsh-*` 的 peer 范围是 `>=0.2.0-rc.1`，无上界；官方新版本若出现回归会记入 `dsh.compatibility.blocklist`）。
- 运行依赖：`@earendil-works/pi-ai`，声明为已装 Harness 所属的代际（Harness `0.2.0-rc.2` 对应 `^0.87.1`）。pi-ai **不是**宿主共享包，本包这份与 Harness 那份只有代际一致时才彼此吻合。路由在自己的边界上归一化请求上下文——这正是 Harness 两代之间真正变化的那份契约——因此 `0.2.0-rc.1` 代宿主配本构建仍可用；`pnpm check` 与定时的 `pi-ai-drift` 工作流会在两侧声明区间**无公共版本**时失败；挂载时若插件能读到已装 Harness 的声明、且本构建落在其外，会打一条告警（尽力而为：宿主藏起 manifest 时表现为静默，可靠信号以 CI 为准）。设计依据见 [ADR 0004](docs/adr/0004-pi-ai-generation-alignment.zh.md)。
- 协议解析、流式转换、回放与工具调用全部委托官方 `@deepseek-ai/dsh-llm-pi-ai` 的 `PiAiAdapter`，本插件只提供 Ollama 特有的连接事实、模型目录与档位元数据。设计依据见 [ADR 0001](docs/adr/0001-delegate-chat-to-official-pi-ai-adapter.zh.md)。
- 浏览器半侧只占用宿主槽位（`settings.models.provider-card`、`sidebar.footer.action`）、使用宿主主题 token，并在 `inject` 里声明 `connection`；不依赖任何其它客户端包——用量通道（`/ollama-cloud` + `usage/read`）是本插件自己的，因此不需要任何供应商 UI 壳插件存在。
- 已知限制：Ollama 的 OpenAI 兼容面不支持 `tool_choice`、`logprobs`，也不提供 prompt cache 统计；用量字段以它实际返回的为准。目录缓存一次只保存一个端点——把 `baseURL` 换成另一个端点后，在新端点回答之前走内置快照。
- 模型清单、每个模型的上下文窗口与输入类型、每个模型的思考档位阶梯全部来自配置的端点（`/api/tags` + `/api/show`），在装载时与按间隔刷新；内置快照只负责两件事：给已知 id 提供显示名，以及首次成功抓取之前的兜底。设计依据见 [ADR 0005](docs/adr/0005-live-endpoint-catalog.zh.md)。

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
