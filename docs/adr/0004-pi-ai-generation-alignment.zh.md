# ADR 0004 — 把本路由的 pi-ai 锁定到 Harness 的代际，并兼容更老的一代

状态：已接受（2026-09-29）

## 背景

聊天路由经由 `@earendil-works/pi-ai` 流式执行，而 pi-ai 是本包自己的**运行时依赖**——它**不是**宿主与插件共享的包（`desktop-runtime.json` 的 `sharedPackages` 里只有 `@deepseek-ai/dsh-llm-pi-ai`，没有 pi-ai）。而调用本路由的适配器 `PiAiAdapter` 属于宿主共享包、由 app 提供。于是**一次请求要跨两份 pi-ai**：我们的，和 Harness 的。

直到 `0.2.0-rc.1`，这两份交换的是 0.87 之前的 `Context`——`{ systemPrompt, messages, tools }`。pi-ai 0.87（即 `dsh-llm-pi-ai@0.2.0-rc.2` 声明的 `^0.87.1` 这一代）把提示词与工具声明搬进了 transcript：其 `Models` 集合用 `normalizeContext()` 把它们折叠进去，各 API 实现读取折叠后的 `TranscriptContext`；而 `0.2.0-rc.1` 的 `Models` 不做任何折叠，把裸 `Context` 直接交给 provider。

由此产生两种失败模式，且都已实际发生：

- **插件 pi-ai 0.85 + Harness 0.2.0-rc.2**：Harness 把 transcript 交给 0.85 的 `estimateMessageTokens()`，而它没有 `system` 分支——逐字符迭代提示词字符串，死在 `block.name.length` 上：

  ```
  Cannot read properties of undefined (reading 'length')   code: PI_AI_ERROR
  ```

  该异常在**构建请求阶段同步抛出、尚未发生任何网络 I/O**，因此升级后的 app 上每一次聊天请求都瞬间失败。这就是 0.2.0 事故。
- **插件 pi-ai 0.87 + Harness 0.2.0-rc.1**：不会抛错。`stream()` 折叠了一个本就不含 system 消息的上下文，请求**不带系统提示词、也不带任何工具声明**就发了出去。静默比崩溃更糟。

`dsh.compatibility.dshReleases` 表达不了这个边界：它描述的是 app 发行版，而真正错配的是一个传递依赖的**代际**；且 app 的插件管理层只读 `peerDependencies`。

## 决策

1. **声明 Harness 的代际**：`@earendil-works/pi-ai` 提到 `^0.87.1`——与 `dsh-llm-pi-ai@0.2.0-rc.2` 声明的区间完全一致；开发依赖同步升到 `0.2.0-rc.2`，使 typecheck 与测试跑在"插件将被安装进去"的那份契约上。
2. **在本路由自己的边界上做归一化**：`contextTolerantStreams()` 包装协议实现，对任何形态的传入上下文调用 `normalizeContext()`。该调用对已归一化的 transcript 是幂等的（0.87 宿主会先折叠），因此**同一个发行版可同时服务两种上下文契约**，上述两种失败模式在 shim 存在期间都不会复发。*本条修订 [ADR 0001](0001-delegate-chat-to-official-pi-ai-adapter.zh.md)*：本路由在"Ollama 特有事实"之外新增了一项贡献——上下文归一化；正是它让这份委托能在"宿主跑在另一个 pi-ai 代际"时继续成立。
3. **两端同时盯住这条边界**：`scripts/check-pi-ai-alignment.mjs`（接入 `pnpm check`，并由 `pi-ai-drift` 定时工作流对 registry 的 `next` 通道执行）在本包声明区间与 Harness 声明区间**无公共版本**时失败退出。插件还会在挂载时打出**一条**告警：条件是它能读到已装 Harness 的声明，且"实际加载的副本"或"本包声明区间"落在该声明之外。这条读取**按设计就是尽力而为**——依次尝试宿主的 CommonJS 解析器、插件自身 `@deepseek-ai/*` 导入所用的 ESM 解析器、以及 app 的 `app.asar` 运行时清单，全都失败时只留一行 debug 后静默：宿主若刻意藏起 manifest，不该因为一条诊断而失去一条能用的路由。**可靠信号是 CI 检查**；挂载告警只覆盖"已经带着这段代码的安装"。

被否决的方案：让宿主按声明式 profile 自行构建 provider，从而让请求路径上彻底没有我们这份 pi-ai。原因是 `dsh-llm-pi-ai` 并不导出其 profile 解析，且没有任何 pi-ai 实例与插件共享——路由无法拿到宿主那一份；而且这个改造会重新打开 ADR 0001 权衡过的取舍，却相对决策 (2) 换不来额外保障。

## 后果

- 未来若 app 再次迁移 pi-ai 代际，定时 CI 检查会在用户安装之前报出来；已经装着本次构建的安装则会在挂载时收到告警。
- **受支持的目标**是开发依赖所钉的那一代；更老的 Harness 之所以仍可用，是因为 shim 覆盖了"真正变化的那份契约"（请求上下文），而不是因为 0.85/0.87 之间的每一处差异都被审计过。0.87 构建遇到"更新、未知代际"的 Harness，仍然要靠 CI 先行发现。
- shim 是一层有代价的兼容层：它是请求路径上唯一一处"插件适配外来契约"的地方，其幂等性正是它保持诚实的依据。`tests/generation.test.ts` 在**报文层**钉住两种上下文形态（请求体里必须出现系统提示词与工具声明），使这层不会被无声地改坏。
- 本包的 pi-ai 依赖必须与 Harness 代际同步抬升；`pnpm check` 会在未同步时失败，这正是设计中的压力。
