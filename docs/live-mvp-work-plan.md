# Live MVP Work Plan

## Target Flow

目标真实流程：

1. 配置飞书应用凭据和 Base app token。
2. 运行建表脚本初始化 8 张表。
3. 写入示例岗位和候选人数据。
4. 触发 pipeline，各 Agent 依次处理。
5. 人类在 `decision_pending` 节点做最终决策。
6. Analytics Agent 生成周报。

## Current Gap Assessment

截至 2026-04-29，本地/demo 版已 100% 跑通；真实飞书端到端 API 闭环已补齐，剩余主缺口是 7.9 的可重复 runbook 和真实飞书 smoke。

| 步骤 | 当前状态 | 还差什么 |
|------|----------|----------|
| 1. 配置飞书凭据和 Base token | 基础能力已具备 | 需要真实 env、`lark-cli auth`、权限确认 |
| 2. 初始化 8 张表 | `pnpm base:plan` 可生成 89 条命令，0 unsupported fields | 已完成：`pnpm base:bootstrap:execute` 可在真实空 Base 上初始化 |
| 3. 写入示例岗位和候选人 | `pnpm base:seed:dry-run` 可生成 91 条命令 | 已完成：bootstrap 自动关联 job link；candidate.job 使用真实 `rec_xxx` |
| 4. 触发 pipeline | 本地完整；live candidate 写回到 `decision_pending` 已具备 | 需要真实飞书 smoke；当前 live write 使用 deterministic pipeline |
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

范围：

- 串联 bootstrap -> live records -> dry-run -> write plan -> execute writes -> human decision -> analytics report -> verification。
- 增加 CLI 或文档化命令顺序。
- 增加失败恢复说明：哪些步骤可重跑，哪些步骤必须先人工核查 Base。

验收：

- 一个开发者能按 runbook 在空 Base 上完成最小演示。
- 每一步都有 blocked/success 判定。
- 任何失败都不会要求盲目重跑整链路。

## Why RAG Waits

RAG 现在不应该插在最前面。原因：

- Phase 7.3/7.4 已经把 `AgentInputBundle`、evidence loader 和 verification report 做好。
- 真实飞书 MVP 闭环的 API 能力已经补齐，接下来更需要 7.9 runbook 和真实 smoke，而不是提前改 RAG。
- 队友的数据集、evidence 更新频率、retriever 形态还没最终进入仓库。

RAG 接入恢复条件：

- 队友提供可重复读取的数据集格式。
- 明确 evidence 是内嵌在 candidate JSON，还是 evidence pool + candidate mapping。
- 明确 evidence 是否每次 run 都更新；如果会更新，planNonce 需要纳入 evidence hash。
- 明确 evidence 是否允许进入 prompt。默认不进入 prompt，只进入 snapshot/UI/verification。

## Suggested Team Split

- 我方优先做 Phase 7.6-7.9，补真实飞书 MVP 闭环。
- 数据/RAG 队友继续接入 dataset 和 retriever。
- 两边在 `AgentInputBundle` 和 `RagDatasetVerificationReport` 对齐，不提前修改 pipeline agent input。

## Completion Definition

达到预期流程的最低标准：

- 可以在真实飞书 Base 上初始化 8 张表。
- 可以写入示例岗位和候选人，并形成可解析的 job link。
- 可以从 UI 或 CLI 触发真实候选人的 deterministic pipeline 写回到 `decision_pending`。
- 可以由人类确认写回 `offer` 或 `rejected`。
- 可以基于真实 Base 数据生成并写入一条 Reports 周报。
- 全流程不暴露 record ID、resume 原文、payload、stdout/stderr、provider secret 或 stack trace。
