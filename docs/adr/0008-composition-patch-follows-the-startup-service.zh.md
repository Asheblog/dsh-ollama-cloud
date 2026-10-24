# ADR 0008 — composition 补丁跟随启动服务的名字

状态：已采纳（2026-10-24）。取代
[ADR 0003](0003-usage-ui-in-host-slots-over-the-connection-channel.zh.md) 的第 3 条决策。

## 背景

用量通道通过 `connection.rpc.handle()` 挂载，而这次调用是借**connection 那一行自己的** `webServer` 注册 HTTP 路由的：路由的 owner 是服务所在的上下文，不是调用方的。用 `@deepseek-ai/cordis` 4.0.5 实测，调用方在自己的行里注入 `webServer` 仍会抛 `cannot get property "webServer" without inject`。web-app composition 声明那一行时只写了它自己的启动服务，因此本 bundle 必须重述该行的 `inject` 列表——补丁是整段替换数组，没有深合并可以追加。

重述列表意味着本插件手里存着一份**自己不拥有的名字**。这正是本次修复的缺陷，而那个名字是该行对 composition **web-runtime 服务**的依赖：`0.2.0` 代注入 `webRuntime`，`0.2.1-rc.1` 注入 `webStartup` 且全篇不再出现 `webRuntime`。`0.4.2` 已把 `0.2.1-rc.1`/`rc.2` 标为兼容，补丁却仍在写 `webRuntime`；更早的 `0.4.0`/`0.4.1` 只声明了 `0.2.0` 两版，但它们的 `engines.dsh` 无上界，照样放行了 `0.2.1` 代。在这些版本上，一条 required 行永远等待，整个启动以 `1 required plugin did not activate` 失败，各部署一直用 profile 级的 `- id: connection` 补丁绕过它。

被否掉的方案与理由：

1. **在本插件自己的行里注入 `webServer`，再从那里调 `handle`。** 实测仍然抛错——owner 是 connection 服务的上下文；这条结论有探针支撑，不需要写进生产代码。
2. **把修复留给 profile 补丁。** 各部署事实上就是这么做的。它把“否则启动失败”变成每次安装的必备步骤，而且只有把 README 读两遍的人才做得到。
3. **用量改走本插件自己的裸 `webServer` 路由。** 那样浏览器半侧就再也调不了 `connection.rpc.call`，并且会丢掉 connection 的 host/origin 围栏与浏览器会话鉴权——那正是 ADR 0003 刻意选择的安全后果。
4. **在 `inject` 里同时写两种拼法。** 任一版本里总有一个不存在，于是该行永远等待，比只选一个更糟。
5. **运行时解析名字再动态打补丁。** loader 在插件代码运行之前就已求值该行的 `inject`；插件无法修复自己的激活条件。

## 决策

- bundle 补丁重述 `[webStartup, webServer]`：composition 在 `0.2.1` 代自己的那一项，加上通道所需的服务。
- `engines.dsh` 改为 `>=0.2.1-rc.1`，`@deepseek-ai/dsh-*` 的 peer 下限随之抬高。`0.2.0` 代移出支持范围——静态补丁无法同时说两种名字，而且那一代本来就服务不了这条通道。
- 这份列表刻意写在两处：`cordis.patch.yml`（loader 真正读的），以及 `src/index.ts` 的 `USAGE_CHANNEL_ROW_INJECT`（挂载诊断要念的）。
- `tests/composition.test.ts` 在每次 `pnpm test` 中比对这三者——补丁、该常量、已装的 `@deepseek-ai/dsh-web-app` composition；同时把 composition 的版本与 adapter 的版本钉在一起，并保持 `dsh.compatibility.dshReleases` 与 `engines.dsh` 一致。
- `@deepseek-ai/dsh-web-app` 升为开发依赖：composition 就是被打的那个契约，CI 必须能离线拿到它。

## 后果

- 在 `0.2.1-rc.1` 及之后，装上本 bundle 又等于“装完即用”，profile 里的绕过补丁成为冗余，可以删除。
- 上游再次改名——或给那一行新增一项——会让 `pnpm test` 变红，而不是让启动失败。这里防的不是某个请求报错，而是 required 行永不激活、整个应用拒绝启动，这正是最值得在发版前抓到的一类。
- `0.2.0` 代留在 `0.4.x`：那一版的补丁重述的是该代行里真正注入的名字（`webRuntime`）。`dsh.compatibility.dshReleases` 逐版本给出结论，安装方不必翻 changelog 就能读到同一答案。
- 开发安装会多出 composition 的整棵依赖树（客户端包、目录选择器、Office 桥）。这是“离线且决定性”的守卫的代价；一次性复制进来的 fixture 只能发现我们自己的漂移，而那种假设正是本次事故已经惩罚过的。
- 若将来 harness 不再借该行的 `webServer` 路由 `rpc.handle`，第二项就多余了。composition 测试会因为第一项照常通过，诊断也仍会念 `webServer`，因此去掉它必须是一次明确的跟进，而不是从绿掉的测试里推断出来。
