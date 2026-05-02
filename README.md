# 职链 HireLoop

基于飞书多维表格 Base 的 AI 招聘虚拟组织。

HireLoop 是一个 **可解释、可审计、由人类最终决策** 的招聘运营辅助系统。Agent 生成证据、建议和报告，但最终从 `decision_pending` 到 `offer` 或 `rejected` 的决策必须由人类确认并记录。

系统不是自动录用或自动淘汰工具。

## 当前状态

截至 2026-05-02：

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

## 文档索引

- [Current State](docs/current-state.md)：后续 Agent 接手时优先阅读；统一 7-Agent、Graph RAG、前端方向和安全边界。
- [Competition Handoff 中文版](docs/competition-integration-handoff.zh.md)：Graph RAG 接口、数据目录、API、队友下一步接入说明。
- [Competition Handoff English](docs/competition-integration-handoff.en.md)：English handoff for Graph RAG integration.
- [Architecture](docs/architecture.md)：Agent、Base 表、状态机、项目结构。
- [Phase Status](docs/phase-status.md)：已完成阶段、当前能力和暂缓项。
- [Operations Runbook](docs/operations-runbook.md)：本地 demo、飞书只读、写回、provider 与 dataset 命令。
- [Security Boundaries](docs/security-boundaries.md)：loopback、确认短语、redaction、写入白名单、错误输出边界。
- [Live MVP Work Plan](docs/live-mvp-work-plan.md)：距离预期流程的差距、下一阶段任务和验收标准。
- [RAG Contract](docs/rag-contract.md)：`AgentInputBundle`、`RetrievedEvidence[]`、验证报告与后续接入边界。

## 技术约束

- 所有业务状态沉淀在飞书 Base，Agent 通过真实 OpenAPI/CLI 操作数据。
- 使用国内模型，不做微调；允许 Prompt Engineering、Sub-agent、Tool-use。
- Agent Runs 记录审计依据，不记录完整思维链或简历原文。
- `offer` / `rejected` 只能由人类确认触发，Agent 不能自动决定。
- 写入能力默认关闭，真实写入必须经过显式 env、confirm 和 scope guard。

## 许可

MIT
