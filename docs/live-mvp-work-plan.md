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

截至 2026-04-29，本地/demo 版已 100% 跑通；真实飞书端到端约 65%-70% 完成。

| 步骤 | 当前状态 | 还差什么 |
|------|----------|----------|
| 1. 配置飞书凭据和 Base token | 基础能力已具备 | 需要真实 env、`lark-cli auth`、权限确认 |
| 2. 初始化 8 张表 | `pnpm base:plan` 可生成 89 条命令，0 unsupported fields | 需要在真实空 Base 上跑一次；最好补幂等检查 |
| 3. 写入示例岗位和候选人 | `pnpm base:seed:dry-run` 可生成 91 条命令 | candidate seed 还没有自动关联 job link；真实 pipeline 需要岗位字段可解析 |
| 4. 触发 pipeline | 本地完整；live candidate 写回到 `decision_pending` 已具备 | 需要真实飞书 smoke；当前 live write 使用 deterministic pipeline |
| 5. 人类最终决策 | 本地 `Human Decision` 有，旧 live MVP runner 有 demo 形态 | 新 live candidate flow 还缺独立 guarded human decision runner/route |
| 6. Analytics 周报 | 本地 Analytics 有，旧 live MVP plan 有 demo 形态 | 还缺从真实 Base 聚合数据并写 Reports 的 live analytics runner |

## Recommended Next Phases

### Phase 7.6 — Live Base Bootstrap Verification

目标：把 Base 初始化和 demo seed 从 dry-run 推到可验证的真实飞书流程。

范围：

- 增加 bootstrap preflight：确认目标 Base 可访问、当前表状态、是否为空或是否允许重复建表。
- 为 `base:seed` 增加 job link 自动关联：先创建/解析 Jobs，拿到 `rec_xxx` 后写入 Candidates.job。
- 输出安全 bootstrap report：created/skipped/failed 计数，不输出 token、record ID、raw stdout。
- 保持 `HIRELOOP_ALLOW_LARK_WRITE=1` 守卫。

验收：

- 空 Base 上可以初始化 8 张表并写入 1 个 job + 1 个 candidate。
- 初始化后 `GET /api/live/records?table=candidates` 能显示候选人，且 `run-dry-run` 不因缺岗位要求或 rubric blocked。
- 重跑 bootstrap 不会误删或覆盖已有业务数据；如果暂不做幂等，则必须 fail closed 并提示人工确认。

### Phase 7.7 — Live Human Decision Runner

目标：补齐 `decision_pending -> offer/rejected` 的真实人类确认写回。

范围：

- 新增 `generateLiveHumanDecisionPlan(linkId, decisionInput)`。
- 新增 `executeLiveHumanDecision(linkId, options)`。
- 只允许候选人当前状态为 `decision_pending`。
- 只允许 `offer` 或 `rejected`，actor 必须是 `human_confirm`。
- 要求独立确认短语，例如 `EXECUTE_LIVE_HUMAN_DECISION`。
- 写入 Candidates human decision fields、status update、Agent Runs 或 Work Events 安全审计。

验收：

- 非 `decision_pending` 候选人 blocked。
- Agent 无法触发 offer/rejected。
- route 和 runner 都有 confirm boundary。
- 响应不暴露 record ID、resume、payload、stdout/stderr、stack trace。

### Phase 7.8 — Live Analytics Report Runner

目标：从真实 Base 只读聚合数据，生成 Reports 写回。

范围：

- 只读读取 Candidates、Evaluations、Agent Runs。
- 生成 analytics input summary。
- 使用 deterministic client 先跑 analytics；provider analytics 后置。
- 生成 `Reports` upsert plan。
- 需要独立 confirm，例如 `EXECUTE_LIVE_ANALYTICS_REPORT_WRITE`。

验收：

- 没有候选人数据时返回 `needs_review` 或 `blocked`，不写空报告。
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
- 真实飞书 MVP 闭环还缺 human decision 和 analytics 写回，这比 RAG 更接近产品可演示价值。
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
