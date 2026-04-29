# Operations Runbook

## Local Verification

```bash
pnpm typecheck
pnpm test
pnpm mvp:demo
```

`pnpm mvp:demo` 当前会输出：

- Stage 1：Candidate Pipeline 到 `decision_pending`
- Stage 2：Human Decision 到 `offer`
- Stage 3：Analytics Report success
- Total commands：20

## Base Bootstrap

建表计划：

```bash
pnpm base:plan
```

当前计划规模：

- 8 张表
- 89 条建表/建字段命令
- `Unsupported fields: 0`

Demo seed dry-run：

```bash
pnpm base:seed:dry-run
```

当前计划规模：

- 91 条命令
- 包含 89 条 setup 命令和 2 条 demo seed
- `Unsupported fields: 0`

真实执行需要飞书配置完整，并设置写入开关：

```bash
export LARK_APP_ID=<飞书应用 ID>
export LARK_APP_SECRET=<飞书应用密钥>
export BASE_APP_TOKEN=<Base 应用凭证>
export HIRELOOP_ALLOW_LARK_WRITE=1

pnpm base:seed:execute
```

注意：真实执行前需要确认目标 Base 是空 Base 或可接受重复建表风险。当前 bootstrap 还不是幂等迁移器。

## Live Bootstrap（推荐）

bootstrap 命令会自动完成建表 + demo seed（含 job link 关联），比手动分步执行更可靠：

```bash
# dry-run：检查飞书配置和 Base 状态，显示将要执行的操作
pnpm base:bootstrap:dry-run

# 真实执行：初始化 8 张表 + 写入 demo job + demo candidate（含 job link）
export LARK_APP_ID=<飞书应用 ID>
export LARK_APP_SECRET=<飞书应用密钥>
export BASE_APP_TOKEN=<Base 应用凭证>
export HIRELOOP_ALLOW_LARK_READ=1
export HIRELOOP_ALLOW_LARK_WRITE=1

pnpm base:bootstrap:execute
```

bootstrap preflight 会检查：

- 飞书配置完整性。
- 目标 Base 可访问性。
- 已有表状态：如果任何表有业务数据，自动阻断，不删除或覆盖。
- 表状态读取结果：如果读取失败且无法确认为“表不存在”，自动阻断。

安全约束：

- 所有输出不包含 `rec_` record ID、token、raw stdout/stderr、payload。
- 缺少 `HIRELOOP_ALLOW_LARK_WRITE=1` 时阻断执行。
- 非空 Base 时 fail closed，需人工确认后手动清空再重试。

## Live Read-Only

```bash
export LARK_APP_ID=<飞书应用 ID>
export LARK_APP_SECRET=<飞书应用密钥>
export BASE_APP_TOKEN=<Base 应用凭证>
export HIRELOOP_ALLOW_LARK_READ=1

pnpm ui:dev
```

常用 API：

```bash
curl http://localhost:3000/api/live/base-status
curl "http://localhost:3000/api/live/records?table=candidates"
curl "http://localhost:3000/api/live/records?table=jobs"
```

安全投影不返回 `rec_` record ID、`resume_text` 原文、token、payload、stdout/stderr。

## Live Candidate Dry-Run

前端候选人 detail panel 可以触发：

```text
POST /api/live/candidates/:linkId/run-dry-run
```

该路径：

- 使用飞书只读读取候选人和岗位。
- 使用 deterministic client 跑 4-agent pipeline。
- 写入本地 runtime snapshot。
- 不写飞书，不调用 provider。

## Provider Preview

```text
POST /api/live/candidates/:linkId/run-provider-agent-demo
```

请求 body 必须包含：

```json
{ "confirm": "EXECUTE_PROVIDER_AGENT_DEMO" }
```

该路径只对真实候选人运行 provider-backed Resume Parser demo，不写 Base。

## Live Candidate Write Plan

生成计划：

```text
POST /api/live/candidates/:linkId/generate-write-plan
```

返回安全摘要：

- `status`
- `planNonce`
- `candidateDisplayName`
- `commandCount`
- `commands[].description`
- `commands[].targetTable`
- `commands[].action`
- `safeSummary`

不会返回 raw args、record ID、token 或 payload。

执行写回：

```text
POST /api/live/candidates/:linkId/execute-writes
```

请求 body 必须包含：

```json
{
  "confirm": "EXECUTE_LIVE_CANDIDATE_WRITES",
  "reviewConfirm": "REVIEWED_DECISION_PENDING_WRITE_PLAN",
  "planNonce": "<generate-write-plan 返回的 nonce>"
}
```

该路径会重新读取候选人和岗位、重新跑 pipeline、复算 nonce，通过后顺序执行写命令。当前只推进到 `decision_pending`，不写 `offer` / `rejected`。

## Live Human Decision

生成决策计划：

```text
POST /api/live/candidates/:linkId/generate-human-decision-plan
```

请求 body：

```json
{
  "decision": "offer",
  "decidedBy": "hiring_manager",
  "decisionNote": "Strong technical skills and culture fit."
}
```

返回安全摘要：

- `status`
- `planNonce`
- `candidateDisplayName`
- `commandCount`
- `commands[].description`
- `commands[].action`
- `decision`
- `safeSummary`

不会返回 raw args、record ID、token 或 payload。

执行决策写回：

```text
POST /api/live/candidates/:linkId/execute-human-decision
```

请求 body：

```json
{
  "confirm": "EXECUTE_LIVE_HUMAN_DECISION",
  "reviewConfirm": "REVIEWED_HUMAN_DECISION_PLAN",
  "planNonce": "<generate-human-decision-plan 返回的 nonce>",
  "decision": "offer",
  "decidedBy": "hiring_manager",
  "decisionNote": "Strong technical skills and culture fit."
}
```

该路径会重新读取候选人、复算 nonce，通过后写入 Candidates human decision fields + 状态更新。只有 `decision_pending` 状态的候选人可执行。Agent 不能触发 offer/rejected，只有 `human_confirm` actor 可以。

安全约束：

- 双确认短语 + planNonce TOCTOU guard。
- 非 `decision_pending` 候选人 blocked。
- 响应不包含 record ID、token、stdout/stderr、payload。
- 缺少 `HIRELOOP_ALLOW_LARK_WRITE=1` 时阻断执行。

## Provider Dataset Verification

```bash
pnpm provider:dataset-verify \
  --input-file=./path/to/candidate-dataset.jsonl \
  --execute-provider \
  --confirm=VERIFY_PROVIDER_DATASET_EXECUTE
```

该命令只验证 provider 模型执行和本地 snapshot，不做 Base 写入。缺少 provider env 时会 blocked，不 fallback deterministic。

## Live Analytics Report

生成报告写回计划：

```text
POST /api/live/analytics/generate-report-plan
```

请求 body 使用空对象，也可以指定周期：

```json
{
  "periodStart": "2026-04-22 00:00:00",
  "periodEnd": "2026-04-29 23:59:59"
}
```

返回安全摘要：

- `status`
- `planNonce`
- `periodStart`
- `periodEnd`
- `candidateCount`
- `evaluationCount`
- `agentRunCount`
- `commandCount`
- `commands[].description`
- `commands[].targetTable`
- `safeSummary`

没有候选人数据时返回 `needs_review`，不生成写入命令。

执行报告写回：

```text
POST /api/live/analytics/execute-report
```

请求 body：

```json
{
  "confirm": "EXECUTE_LIVE_ANALYTICS_REPORT_WRITE",
  "reviewConfirm": "REVIEWED_LIVE_ANALYTICS_REPORT_PLAN",
  "planNonce": "<generate-report-plan 返回的 nonce>",
  "periodStart": "2026-04-22 00:00:00",
  "periodEnd": "2026-04-29 23:59:59"
}
```

该路径会重新只读聚合 Candidates、Evaluations、Agent Runs，重新生成报告计划并复算 nonce，通过后只写 Reports 和 Agent Runs。

安全约束：

- 双确认短语 + planNonce TOCTOU guard。
- Reports 不进入 live candidate write scope。
- 不写 Candidates，也不做任何状态转换。
- 响应不包含 record ID、resume、payload、stdout/stderr、prompt 或 provider secret。
- 缺少 `HIRELOOP_ALLOW_LARK_WRITE=1` 时阻断执行。

## Recommended Demo Order

本地演示：

```bash
pnpm typecheck
pnpm test
pnpm mvp:demo
pnpm ui:dev
```

真实飞书只读演示：

```bash
pnpm base:plan
pnpm base:seed:dry-run
pnpm base:bootstrap:dry-run
pnpm ui:dev
```

真实飞书写回 API 现在可以走完 pipeline write -> human decision -> analytics report。下一步是 [Live MVP Work Plan](live-mvp-work-plan.md) 中的 7.9 runbook，把这些步骤串成可重复执行的命令顺序。
