# 职链 HireLoop

基于飞书多维表格 Base 的 AI 招聘虚拟组织。

HireLoop 是一个 **可解释、可审计、由人类最终决策** 的招聘运营辅助系统。Agent 生成证据、建议和报告，但最终从 `decision_pending` 到 `offer` 或 `rejected` 的决策必须由人类确认并记录。

系统不是自动录用或自动淘汰工具。

## 当前状态

截至 2026-05-06：

- 本地 deterministic MVP 已完整跑通：`pnpm mvp:demo` 会完成 pipeline、human decision 和 analytics report，共 20 条 command plan。
- 飞书 Base 初始化计划已具备：`pnpm base:plan` 生成 8 张表、89 条建表/建字段命令，当前 `Unsupported fields: 0`。
- Demo seed dry-run 已具备：`pnpm base:seed:dry-run` 生成 91 条建表 + seed 命令。
- **Live Bootstrap 已具备**：`pnpm base:bootstrap:execute` 可在空 Base 上初始化 8 张表 + 写入 demo job + demo candidate（含 job link 自动关联）。preflight 会检查 Base 状态，非空时 fail closed。
- Live candidate 已支持只读浏览、dry-run、provider preview、两步写回到 `decision_pending`。
- **Live Human Decision 已具备**：`POST generate-human-decision-plan` + `POST execute-human-decision` 可在真实飞书上执行 `decision_pending -> offer/rejected` 人类确认写回。双确认 + planNonce TOCTOU guard。
- **Live Analytics Report 已具备**：`POST /api/live/analytics/generate-report-plan` + `POST /api/live/analytics/execute-report` 可只读聚合真实 Base 数据并写入 Reports + Agent Runs。
- **Live E2E Runbook 已具备**：`pnpm mvp:live-e2e-runbook` 输出 13 步可重复 runbook，支持 5 个 sample scenario。
- **P3 7-Agent 虚拟组织已成为当前产品语言**：HR 协调、简历录入、信息抽取、图谱构建、图谱复核、面试准备、数据分析。旧 `Resume Parser` / `Screening` 只作为历史兼容名存在。
- Competition Graph RAG 已接入比赛图谱数据（5991 候选人、23961 证据、38 岗位），作为 Pipeline Graph Builder/Reviewer 的解释增强层。Raw evidence 不直接进 provider prompt；安全结构化摘要（graphProjection/topNeighbors/gnnSignal）可作为 Reviewer 输入。独立驾驶舱已溶解进 Pipeline 主流程。
- **前端方向已敲定**：`HireLoop Virtual Org Console` 全画幅虚拟组织控制台，必须使用真实 API 数据，不允许随机日志、假分数或硬编码成功态。
- **飞书网页安全跳转已接入**：顶部 `打开飞书 Base` 走 `/go/base`；候选人详情 `打开飞书记录` 走 `/go/:linkId`。只有配置 `FEISHU_BASE_WEB_URL` / `LARK_BASE_WEB_URL` 或表级网页 URL 时才启用。
- **品牌素材已切到白底 PNG**：当前前端统一使用 `src/ui/assets/hireloop-mark.png` 和 `src/ui/favicon.png`，不再回退透明版占位图。
- **写入边界继续收紧**：Competition Graph RAG review 始终只读；候选人详情里的 `写回计划摘要` 只生成计划；Analytics 写入仍只允许后端双确认 + `planNonce`，UI 不暴露 execute 路由。

真实飞书端到端 API 闭环 + runbook 已具备。当前事实源见 [Current State](docs/current-state.md)，详细计划见 [Live MVP Work Plan](docs/live-mvp-work-plan.md)。

## 核心流程

预期流程：

1. 配置飞书应用凭据和 Base app token。
2. 运行建表脚本初始化 8 张表。
3. 写入示例岗位和候选人数据。
4. 触发 pipeline，各 Agent 依次处理到 `decision_pending`。
5. 人类在 `decision_pending` 节点做最终决策。
6. Analytics Agent 生成周报。

本地 demo 和真实飞书写回 API 已覆盖 4-6 的完整逻辑；`pnpm mvp:live-e2e-runbook` 已把真实链路串成 13 步 runbook。

## 快速命令

```bash
# 类型检查
pnpm typecheck

# 运行测试
pnpm test

# 本地完整 MVP demo：pipeline + human decision + analytics
pnpm mvp:demo

# 飞书 Base 建表计划，不执行写入
pnpm base:plan

# 飞书 Base 建表 + demo seed dry-run，不执行写入
pnpm base:seed:dry-run

# 飞书 Base bootstrap dry-run：检查配置和 Base 状态
pnpm base:bootstrap:dry-run

# 飞书 Base bootstrap 真实执行：建表 + demo seed（含 job link 关联）
pnpm base:bootstrap:execute

# 启动本地 UI 服务
pnpm ui:dev

# 使用飞书长连接在本机接收事件
pnpm feishu:events:long

# 使用飞书长连接接收消息并自动回复
pnpm feishu:events:long -- --reply

# 用真实本地输入运行当前 pipeline，并生成 UI 可读 runtime snapshot
pnpm pipeline:run --input-file=./path/to/candidate-pipeline.json

# 多 candidate dataset runner，默认 deterministic，不写 Base
pnpm dataset:run --input-file=./path/to/candidate-dataset.jsonl

# Provider dataset execute verification，仅验证模型执行与本地 snapshot，不写 Base
pnpm provider:dataset-verify --input-file=./path/to/candidate-dataset.jsonl --execute-provider --confirm=VERIFY_PROVIDER_DATASET_EXECUTE

# 准备比赛 Graph RAG 数据
pnpm competition:rag:prepare -- --limit=20

# Live E2E Runbook：输出 13 步可重复 runbook
pnpm mvp:live-e2e-runbook

# Live E2E Runbook sample scenarios
pnpm mvp:live-e2e-runbook --sample-fresh
pnpm mvp:live-e2e-runbook --sample-after-bootstrap
pnpm mvp:live-e2e-runbook --sample-ready-to-write
pnpm mvp:live-e2e-runbook --sample-after-partial-failure
pnpm mvp:live-e2e-runbook --sample-complete
```

## 当前已知验证差异

- 2026-05-06 已验证：`node --import tsx --test tests/server/live-base.test.ts tests/server/server-routes.test.ts`，`124 tests pass`。
- `pnpm typecheck` 当前仍会因缺少 `@larksuiteoapi/node-sdk` 在 `src/feishu/long-connection.ts` 及对应测试失败；这不是本轮飞书跳转和 UI 收口改动引入的回归。

## 文档索引

- [Current State](docs/current-state.md)：后续 Agent 接手时优先阅读；统一 7-Agent、Graph RAG、前端方向和安全边界。
- [Competition Handoff 中文版](docs/competition-integration-handoff.zh.md)：Graph RAG 接口、数据目录、API、队友下一步接入说明。
- [Competition Handoff English](docs/competition-integration-handoff.en.md)：English handoff for Graph RAG integration.
- [Website Usage 中文说明](docs/website-usage.zh.md)：网站实际使用方式、两大场景、图谱阅读方法和常见问题。
- [Architecture](docs/architecture.md)：Agent、Base 表、状态机、项目结构。
- [Phase Status](docs/phase-status.md)：已完成阶段、当前能力和暂缓项。
- [Operations Runbook](docs/operations-runbook.md)：本地 demo、飞书只读、写回、provider 与 dataset 命令。
- [Security Boundaries](docs/security-boundaries.md)：loopback、确认短语、redaction、写入白名单、错误输出边界。
- [Live MVP Work Plan](docs/live-mvp-work-plan.md)：距离预期流程的差距、下一阶段任务和验收标准。
- [RAG Contract](docs/rag-contract.md)：`AgentInputBundle`、`RetrievedEvidence[]`、验证报告与后续接入边界。

## 飞书长连接接收事件

如果你的飞书应用还没走完公网域名审核，可以先改用长连接模式，不需要公网 IP、域名或内网穿透。

1. 在开发者后台把事件订阅方式切成“使用长连接接收事件”。
2. 在本项目根目录创建 `.env.local`，至少配置：
   `LARK_APP_ID=...`
   `LARK_APP_SECRET=...`
3. 启动长连接：

```bash
pnpm feishu:events:long
```

默认监听 `im.message.receive_v1`。如果你要同时接消息和新版卡片回调，可以把事件键配置成：

`FEISHU_EVENT_KEYS=im.message.receive_v1,card.action.trigger`

如果要立即验证收发链路，可以启用自动回复：

```bash
pnpm feishu:events:long -- --reply
```

可选环境变量：

- `FEISHU_EVENT_KEYS=im.message.receive_v1,out_approval`
- `FEISHU_EVENT_KEYS=im.message.receive_v1,card.action.trigger`
- `FEISHU_BOT_AUTO_REPLY=1`
- `FEISHU_BOT_REPLY_TEXT=已收到，我这边正在处理`
- `FEISHU_CARD_ACTION_TOAST_TEXT=卡片交互已收到`
- `FEISHU_LOG_LEVEL=debug`

注意：

- 长连接模式只支持企业自建应用。
- 新版卡片回调 `card.action.trigger` 可以走长连接；旧版“消息卡片回传交互（旧）”不支持长连接。
- 事件处理需要在 3 秒内完成，否则飞书会重推。
- 同一应用多个长连接客户端是集群消费，不是广播。

## 需求提交与异步图更新

控制台现在新增了“需求提交与异步图更新”区块：

- `需求/询问`：先本地暂存，不触发图更新。
- `候选人暂存`：先保存候选人和岗位摘要，不立即运行图谱构建。
- `加入异步图更新队列`：可从候选人详情里把真实飞书候选人加入延迟处理队列。
- `集中处理时间窗口数据`：按时间窗口批处理暂存数据；处理阶段才运行图相关流程。

这条链路默认只做本地暂存和确定性批处理，不自动写飞书、不自动录用/淘汰。

## 飞书网页联动

- 顶部 `打开飞书 Base`：浏览器导航到 `/go/base`，由后端安全解析成已配置的飞书 Base 网页 URL。
- 候选人详情 `打开飞书记录`：浏览器导航到 `/go/:linkId`，后端按 link registry 解析到对应表级网页 URL。
- 当 `/api/live/base-status` 返回 `feishuWebUrlAvailable=false` 时，顶部按钮保持禁用，不会猜测或拼接外链。
- 这些跳转只做浏览器导航，不执行任何写入。

## 技术约束

- 所有业务状态沉淀在飞书 Base，Agent 通过真实 OpenAPI/CLI 操作数据。
- 使用国内模型，不做微调；允许 Prompt Engineering、Sub-agent、Tool-use。
- Agent Runs 记录审计依据，不记录完整思维链或简历原文。
- `offer` / `rejected` 只能由人类确认触发，Agent 不能自动决定。
- 写入能力默认关闭，真实写入必须经过显式 env、confirm 和 scope guard。

## 许可

MIT
