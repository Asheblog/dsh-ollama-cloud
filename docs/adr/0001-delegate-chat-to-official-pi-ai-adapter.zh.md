# ADR 0001 — 聊天协议委托给官方 pi-ai 适配器

状态：已采纳（2026-09-29）

经 [ADR 0004](0004-pi-ai-generation-alignment.zh.md) 修订：本路由现在还会在自己的边界上
归一化请求上下文。这是下文"决策"清单之外新增的一项贡献，也正是它让这份委托能够在
"宿主跑在另一个 pi-ai 代际上"时继续成立。

## 背景

Ollama Cloud 在 `https://ollama.com/v1` 提供 OpenAI 兼容的 Chat Completions
接口，而 Harness 自带这一方言的通用适配器 `@deepseek-ai/dsh-llm-pi-ai`：消息转换、
工具调用回放、流式翻译、用量映射，以及非 OpenAI 端点需要的 compat 开关都由它负责。

有两条"更少代码、不写适配器"的路，都被否决：

1. **纯配置 bundle**：把 `ollama-cloud` profile 加进内置的 `llm-pi-ai` 行。
   否决原因：loader patch 是**整段替换**目标行的 `config` 而非合并，会覆盖用户
   已经声明的其他供应商。
2. **第二个 `llm-pi-ai` 行**（换一个 entry id）。否决原因：该插件会把自己安装目录里
   的**整个 pi-ai 目录**注册进可配置供应商目录，第二个实例在挂载时就会以
   `DUPLICATE_DIRECTORY` 失败，什么都注册不上。

## 决策

自注册一条 route（`ollama-cloud`），自研 `LlmAdapter`，但把所有聊天操作
**委托给一个 `PiAiAdapter` 实例**；本插件只贡献 Ollama 特有的事实：连接配置、
模型目录、逐模型思考档位，以及默认档位。

## 后果

- 流式、回放、附件、重试、工具调用等协议行为与 Harness 自身的 pi-ai 行为完全一致，
  未来上游修 bug 也会一并受益。
- 插件小到可以审计：没有任何自研的 wire 序列化代码。
- 依赖官方适配器导出的构造器与 profile 形状（`PiAiAdapter`、
  `ResolvedPiAiProviderProfile`）——稳定，但不是按公共 API 版本化的；破坏性变更由
  针对固定 devDependency 的 typecheck 拦住，而不是留到运行时。
- 聊天协议覆盖不到的 Ollama 原生能力（模型发现、Web 搜索/抓取）留在本包，
  因为它们不属于聊天。
