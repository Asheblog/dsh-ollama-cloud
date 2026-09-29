# ADR 0003 — 用量 UI 放在宿主槽位、走本插件自己的连接通道

状态：已采纳（2026-09-29）

## 背景

账号额度在 `GET <native base>/usage` 后面，需要 API Key。用户希望在已经工作的地方看到它，
并且不依赖第三方供应商 UI 壳插件：本部署的 Models 页会渲染该供应商行，但它的编辑器
拒绝不认识的命名空间，所以卡片必须自带密钥入口和数字展示。

有三个问题必须先定：UI 渲染在哪、如何够到带凭据的数据、以及在桌面组合里通道如何挂上。

## 决策

- **渲染在宿主自己的槽位里。** `settings.models.provider-card`（key = 本插件的设置命名空间）
  把卡片放进 Models 页的供应商行；`sidebar.footer.action` 承载紧凑额度行。
  两者都是官方包声明的核心席位，都接受 React 组件，都不需要另一个插件存在。
- **带凭据的读取全部留在宿主侧。** 浏览器半侧只调用本插件自己的连接通道
  （`/ollama-cloud`，端点 `usage/read`、`credential/status`、`credential/set`），
  永远拿不到密钥；写入走 Harness 凭据 seam，且目标引用是配置里的那一个，
  而不是客户端报上来的名字。通道与端点名刻意与生态里既有 Ollama 供应商 UI 调用的完全一致，
  因此那些 UI 无需改动即可读到本插件的用量。
- **由 bundle patch 修复 connection 行。** `connection.rpc.handle()` 是通过该服务自己的
  `webServer` 挂通道的，而 web-app bundle 只给这一行声明了 `inject: [webRuntime]`，
  于是注册抛错、通道挂不上。patch 必须整段重述 `inject`（`[webRuntime, webServer]`），
  因为 patch 是整键替换。

## 后果

- 一个插件同时提供供应商、思考档位、用量与密钥入口：不需要任何供应商 UI 壳，
  Models 页那一行即可完整使用。
- 若未来 web-app bundle 给 connection 行的 `inject` 增加了新条目，会被本 patch 的
  陈旧列表丢掉；该列表按当时的 bundle 重述，那一行变化时必须复查。
  没有 connection 行的组合（例如 headless）会跳过该 patch 并打一条告警，
  浏览器半侧在那里本来就不存在。
- 因为通道经由连接服务挂载，客户端同时继承它的 Host/Origin fence 与浏览器会话认证；
  本插件从不自己暴露未认证路由。
- 运行中的宿主若尚未重新加载本插件，会对卡片的调用回以 "unknown endpoint" 诊断，
  卡片会把它渲染成"请重启"的提示，而不是失败。
