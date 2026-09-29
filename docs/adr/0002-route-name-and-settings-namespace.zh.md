# ADR 0002 — Route 名、设置命名空间与档位词汇

状态：已采纳（2026-09-29）

## 背景

有三个名字一旦发布就难以更改：会话里保存的 provider route（会话日志中记着
`provider/model`）、配置界面寻址的设置命名空间、以及 composer 展示的推理档位 id。

已有先例（`dsh-llm-ollama`）已经注册了名为 `ollama-cloud` 的 route，而 Harness
按 loader entry id 推导出的 `settingsNs` 来定位一条 route 的配置。

## 决策

- **Route**：`ollama-cloud` —— 供应商本名，也是用户会写进设置里的 id。
  与注册同一 route 的 `dsh-llm-ollama` **互斥**：两个都装会在挂载时直接报错。
  这一点在两个 README 里都写明。
- **Loader 行 id / 设置命名空间**：`llm-ollama-cloud`。行 id 是设置层寻址与
  profile patch 定位的键，因此不能与先例的 `llm-ollama` 撞名。
- **档位词汇**：可选档位 id 严格使用 Harness/pi-ai 的那一套
  （`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`），Ollama 自己的拼写
  只作为 wire 值携带。元数据是布尔开关的模型只提供 `off` + `high`；
  元数据从未报告过的档位永不出现。

## 后果

- 在两个 Ollama 插件之间切换不需要迁移会话日志，因为双方都存
  `ollama-cloud/<model>`。
- 设置文档里属于本插件的是自己的命名空间；另一个插件的 `llm-ollama` 段不受影响，
  卸载任何一方都不会留下被对方误读的残留配置。
- 同一个选择器里的推理档位在不同供应商之间可比；而某个模型到底接受哪几档，
  仍由 Ollama 的真实阶梯决定。
