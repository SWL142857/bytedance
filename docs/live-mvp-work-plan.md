# Live MVP Work Plan

Current canonical handoff: `docs/current-state.md`.

## Target Flow

目标真实流程：

1. 配置飞书应用凭据和 Base app token。
2. 运行建表脚本初始化 8 张表。
3. 写入示例岗位和候选人数据。
4. 触发 pipeline，各 Agent 依次处理。
5. 人类在 `decision_pending` 节点做最终决策。
6. Analytics Agent 生成周报。

## Current Gap Assessment

截至 2026-05-06，本地/demo 版已跑通；真实飞书端到端 API 闭环和 13 步 runbook 已补齐。Virtual Org Console 主界面、白底 PNG 品牌素材和飞书安全跳转已经落地。当前主缺口是真实飞书 smoke、provider preview 稳定性、已存在 Base 的 schema migration，以及只读型 Analytics 状态面板（如继续做，也必须保持 execute 边界留在后端）。

| 步骤 | 当前状态 | 还差什么 |
|------|----------|----------|
| 1. 配置飞书凭据和 Base token | 基础能力已具备 | 需要真实 env、`lark-cli auth`、权限确认 |
| 2. 初始化 8 张表 | `pnpm base:plan` 可生成 89 条命令，0 unsupported fields | 已完成：`pnpm base:bootstrap:execute` 可在真实空 Base 上初始化 |
| 3. 写入示例岗位和候选人 | `pnpm base:seed:dry-run` 可生成 91 条命令 | 已完成：bootstrap 自动关联 job link；candidate.job 使用真实 `rec_xxx` |
| 4. 触发 pipeline | 本地完整；live candidate 写回到 `decision_pending` 已具备；P3 provider preview 已接入 | 需要真实飞书 smoke；provider preview 失败必须安全审计展示 |
| 5. 人类最终决策 | 本地 `Human Decision` 有，旧 live MVP runner 有 demo 形态 | 已完成：`generateLiveHumanDecisionPlan` + `executeLiveHumanDecision`，双确认 + TOCTOU guard |
| 6. Analytics 周报 | 本地 Analytics 有，旧 live MVP plan 有 demo 形态 | 已完成：live analytics runner 只读聚合真实 Base 并写 Reports + Agent Runs |

## Recommended Next Phases

### Phase 7.6 — Live Base Bootstrap Verification

目标：把 Base 初始化和 demo seed 从 dry-run 推到可验证的真实飞书流程。

状态：完成（2026-04-29）。

实现：

- `src/base/live-bootstrap.ts`：封装 preflight、setup、seed（含 job link 自动关联）、安全 report。
- `scripts/bootstrap-live-base.ts`：CLI 入口，`--execute` 为真实执行，否则 dry-run。
- `pnpm base:bootstrap:dry-run` / `pnpm base:bootstrap:execute`。
- Preflight 检查所有 8 张表状态，非空表或无法确认表状态时 fail closed，不误删已有数据。
- Demo seed 先创建 Jobs 记录，解析返回的 `rec_xxx`，再写入 Candidates 并关联 job link。
- 输出不包含 `rec_`、token、raw stdout/stderr、payload、command args。
- 新增 30+ 测试覆盖 dry-run 安全、execute blocked、fail-closed、job link 解析、redaction。

验收：

- 空 Base 上可以初始化 8 张表并写入 1 个 job + 1 个 candidate。
- 初始化后 `GET /api/live/records?table=candidates` 能显示候选人，且 `run-dry-run` 不因缺岗位要求或 rubric blocked。
- 重跑 bootstrap 不会误删或覆盖已有业务数据；非空表 fail closed 并提示人工确认。

### Phase 7.7 — Live Human Decision Runner

目标：补齐 `decision_pending -> offer/rejected` 的真实人类确认写回。

状态：完成（2026-04-29）。

实现：

- `src/orchestrator/live-human-decision-runner.ts`：封装 `generateLiveHumanDecisionPlan()` 和 `executeLiveHumanDecision()`，复用 `buildHumanDecisionPlan()`。
- 两步执行：生成计划返回 planNonce → 执行时要求双确认 + planNonce TOCTOU 校验 + 重读候选人数据。
- 确认短语：`EXECUTE_LIVE_HUMAN_DECISION` + `REVIEWED_HUMAN_DECISION_PLAN`。
- `readLiveCandidateContext()` 新增 `requireResume` 选项，human decision 不因缺简历 blocked。
- Redaction：`redactLiveHumanDecisionPlan()` 和 `redactLiveHumanDecisionResult()`。
- Server routes：`POST generate-human-decision-plan` 和 `POST execute-human-decision`。
- 新增 20+ 测试覆盖 runner 和 route 层。

验收：

- 非 `decision_pending` 候选人 blocked。
- Agent 无法触发 offer/rejected。
- route 和 runner 都有 confirm boundary。
- 响应不暴露 record ID、resume、payload、stdout/stderr、stack trace。

### Phase 7.8 — Live Analytics Report Runner

目标：从真实 Base 只读聚合数据，生成 Reports 写回。

状态：完成（2026-04-29）。

实现：

- `src/orchestrator/live-analytics-report-runner.ts`：封装 `generateLiveAnalyticsReportPlan()` 和 `executeLiveAnalyticsReport()`。
- 只读读取 Candidates、Evaluations、Agent Runs，映射为现有 `AnalyticsInput` 聚合快照。
- 使用 deterministic `runAnalytics()`，provider analytics 后置。
- 两步执行：生成计划返回 planNonce → 执行时双确认 + 重新读取 Base + 复算 nonce。
- 确认短语：`EXECUTE_LIVE_ANALYTICS_REPORT_WRITE` + `REVIEWED_LIVE_ANALYTICS_REPORT_PLAN`。
- Dedicated scope validator 只允许 Reports + Agent Runs，不把 Reports 加入 live candidate write scope。
- Server routes：`POST /api/live/analytics/generate-report-plan` 和 `POST /api/live/analytics/execute-report`。

验收：

- 没有候选人数据时返回 `needs_review`，不写空报告。
- 报告写入 Reports 和 Agent Runs。
- 响应只返回安全 summary、period、count、status。
- Reports 写入不混入 live candidate write scope，保持 dedicated runner。

### Phase 7.9 — End-to-End Live Runbook

目标：把真实飞书 MVP 闭环整理成一套可重复操作的 runbook。

状态：完成（2026-04-29）。

实现：

- `src/orchestrator/live-e2e-runbook.ts`：封装 `buildLiveE2eRunbook()`，生成 13 步 E2E runbook，每步包含 goal、commandHint、successCriteria、failureRecovery、safetyNote、rerunnable。
- `scripts/demo-live-e2e-runbook.ts`：CLI 入口，支持 5 个 sample scenario（`--sample-fresh`、`--sample-after-bootstrap`、`--sample-ready-to-write`、`--sample-after-partial-failure`、`--sample-complete`），不需要真实飞书 env。
- `pnpm mvp:live-e2e-runbook`：输出安全 runbook，默认无 env 时所有步骤 blocked。
- 步骤覆盖：环境凭据 → Bootstrap dry-run/execute → 启动 UI → Live records → 写回计划/执行 → 人类决策计划/执行 → Analytics 计划/执行 → 验证 → Recovery review。
- 明确 rerun 策略：dry-run / plan / readiness / verification 可安全重跑；execute 步骤失败后必须先 recovery review + Base 人工核查。
- 输出安全投影：不包含 record ID、resume 原文、token、payload、stdout/stderr、provider secret。
- 新增 20+ 测试覆盖 runbook 模块和 CLI 脚本。

验收：

- 一个开发者能按 runbook 在空 Base 上完成最小演示。
- 每一步都有 blocked/success/manual/failed 判定。
- 失败恢复说明具体，不要求"重跑整条 pipeline"。
- 输出和 API 响应不泄露敏感字段。
- `pnpm mvp:live-e2e-runbook` 在无 env 时安全输出 blocked runbook，不抛异常。

## Graph RAG Status

RAG 不再是“等待接入”的独立事项。Competition Graph RAG 已作为只读增强层接入，当前产品定位是 A（Feishu Live Pipeline）为主、B（Graph RAG）为解释增强。

后续如果要把更多 raw evidence/snippet 引入 provider prompt，必须另开设计。当前允许的是安全结构化摘要：`graphProjection`、`topNeighbors`，以及已预留但尚未填充的 `gnnSignal`。

进一步 RAG work 的触发条件和交接接口见 `docs/competition-integration-handoff.zh.md` / `docs/competition-integration-handoff.en.md`。当前优先级：

- 队友提供或生成 `gnn_predictions.csv`，填充 `/api/competition/review` 的 `gnnSignal`。
- 将 Competition query-aware subgraph 输出整理成 view-model 字段，而不是 UI 直接调用 Python。
- 评估是否将 `matchedFeatures` / `roleMemory` 的安全摘要进入 Reviewer。
- 明确 evidence 是否每次 run 都更新；如果会更新，planNonce 需要纳入 evidence hash。
- 明确 raw evidence 是否允许进入 provider prompt。默认不允许。

## Suggested Team Split

- 前端/Antigravity 负责按 Virtual Org Console spec 实现真实数据 UI。
- Codex 负责 review 前端实现，重点抓硬编码、API 契约和安全泄露。
- 后端继续提升 provider preview 稳定性、Base schema migration 和真实飞书 smoke。

## Completion Definition

达到预期流程的最低标准：

- 可以在真实飞书 Base 上初始化 8 张表。
- 可以写入示例岗位和候选人，并形成可解析的 job link。
- 可以从 UI 或 CLI 触发真实候选人的 deterministic pipeline 写回到 `decision_pending`。
- 可以由人类确认写回 `offer` 或 `rejected`。
- 可以基于真实 Base 数据生成并写入一条 Reports 周报。
- 全流程不暴露 record ID、resume 原文、payload、stdout/stderr、provider secret 或 stack trace。

## Graph RAG Enhancement (P2, 2026-05-01)

Competition Graph RAG 作为 Feishu Live Pipeline 的增强层，嵌入 Graph Builder、Screening Reviewer 和 Decision 环节。A（Pipeline）为主，B（Graph RAG）为辅。具体接口见 Competition handoff docs。

| 维度 | Feishu Live Pipeline | Graph RAG |
|------|---------------------|-----------|
| 数据源 | 飞书 Base 表 | `competition /` CSV |
| 写入 | guarded write + 双确认 | 只读 |
| 证据入 prompt | raw evidence 否 | raw evidence 否；结构化摘要可入 Reviewer |
| 位置 | 主产品 | Pipeline Graph Builder/Reviewer/Decision 增强 |
| 调用外部 LLM | provider adapter + confirm | 否 |
