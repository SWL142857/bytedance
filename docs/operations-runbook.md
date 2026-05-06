# Operations Runbook

Current canonical handoff: `docs/current-state.md`.

## Local Verification

```bash
pnpm typecheck
pnpm test
pnpm mvp:demo
```

已知本地基线（2026-05-06）：

- `pnpm typecheck` 当前会因缺少 `@larksuiteoapi/node-sdk` 在 long-connection 路径失败。
- 飞书跳转和 UI 收口相关变更请至少跑：

```bash
node --import tsx --test tests/server/live-base.test.ts tests/server/server-routes.test.ts
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

## Safe Feishu Web Navigation

顶部 `打开飞书 Base` 和候选人详情 `打开飞书记录` 都走本地后端安全导航：

```bash
curl -sS http://localhost:3000/api/live/base-status
curl -sS -D - -o /dev/null http://localhost:3000/go/base
```

说明：

- `/api/live/base-status` 返回 `feishuWebUrlAvailable=true` 时，顶部按钮才会启用。
- `/go/base` 返回 `302` 到已配置的 Base 网页 URL。
- `/go/:linkId` 返回 `302` 到对应表级网页 URL；前端不会拿到真实 record ID。
- 如果网页 URL 未配置，`/go/*` 返回安全 JSON unavailable message，而不是猜测外链。

## Live Candidate Dry-Run

前端候选人 detail panel 可以触发：

```text
POST /api/live/candidates/:linkId/run-dry-run
```

该路径：

- 使用飞书只读读取候选人和岗位。
- 使用 deterministic client 跑当前安全 pipeline。
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

该路径对真实候选人运行完整 P3 provider preview pipeline，不写 Base。它会产生安全 runtime snapshot；如果 provider 在某个 Agent 失败，前端必须展示 `failedAgent`，不能伪造成成功。

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
- 当前 UI 不暴露 execute-report 按钮；如需真实执行，仍应通过后端 API 双确认完成。

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

真实飞书写回 API 现在可以走完 pipeline write -> human decision -> analytics report。下方 Live E2E Runbook 把这些步骤串成可重复执行的命令顺序。

## Live E2E Runbook

E2E runbook 把真实飞书 MVP 闭环串成 13 步可重复执行的命令顺序。

```bash
# 查看默认 runbook（无 env，所有步骤 blocked）
pnpm mvp:live-e2e-runbook

# 查看各阶段 sample
pnpm mvp:live-e2e-runbook --sample-fresh
pnpm mvp:live-e2e-runbook --sample-after-bootstrap
pnpm mvp:live-e2e-runbook --sample-ready-to-write
pnpm mvp:live-e2e-runbook --sample-after-partial-failure
pnpm mvp:live-e2e-runbook --sample-complete
```

### 步骤顺序

| 步骤 | 名称 | 命令 | 可重跑 |
|------|------|------|--------|
| 1 | 环境与飞书凭据 | `export 飞书凭据...` | 是 |
| 2 | Bootstrap Dry-Run | `pnpm base:bootstrap:dry-run` | 是 |
| 3 | Bootstrap Execute | `pnpm base:bootstrap:execute` | 否 |
| 4 | 启动本地 UI | `pnpm ui:dev` | 是 |
| 5 | Live Records 检查 | `GET /api/live/records?table=candidates` | 是 |
| 6 | 候选人写回计划 | `POST generate-write-plan` | 是 |
| 7 | 执行候选人写回 | `POST execute-writes` | 否 |
| 8 | 人类决策计划 | `POST generate-human-decision-plan` | 是 |
| 9 | 执行人类决策 | `POST execute-human-decision` | 否 |
| 10 | Analytics 报告计划 | `POST generate-report-plan` | 是 |
| 11 | 执行 Analytics 报告 | `POST execute-report` | 否 |
| 12 | 验证 | `pnpm mvp:live-verification` | 是 |
| 13 | Recovery Review | `pnpm mvp:live-recovery` | 是 |

### 失败恢复规则

- dry-run / plan / readiness / verification 可以安全重跑。
- execute 步骤（3、7、9、11）失败后不能盲目重跑，必须先：
  1. 运行 `pnpm mvp:live-recovery` 检查 partial writes。
  2. 人工核查 Base 中已写入的记录。
  3. 决定 targeted retry 还是人工补偿。
- bootstrap execute 在非空 Base 上必须 fail closed。

### 完整真实飞书演示流程

```bash
# 1. 配置飞书凭据
export LARK_APP_ID=<飞书应用ID>
export LARK_APP_SECRET=<飞书密钥>
export BASE_APP_TOKEN=<Base Token>
export HIRELOOP_ALLOW_LARK_READ=1

# 2. Bootstrap dry-run
pnpm base:bootstrap:dry-run

# 3. Bootstrap execute（需要写入权限）
export HIRELOOP_ALLOW_LARK_WRITE=1
pnpm base:bootstrap:execute

# 4. 启动 UI
pnpm ui:dev

# 5. 检查 live records
curl "http://localhost:3000/api/live/records?table=candidates"

# 6-7. 候选人写回（通过 API，需要 linkId）
# POST /api/live/candidates/:linkId/generate-write-plan
# POST /api/live/candidates/:linkId/execute-writes

# 8-9. 人类决策（通过 API）
# POST /api/live/candidates/:linkId/generate-human-decision-plan
# POST /api/live/candidates/:linkId/execute-human-decision

# 10-11. Analytics 报告（通过 API）
# POST /api/live/analytics/generate-report-plan
# POST /api/live/analytics/execute-report

# 12. 验证
pnpm mvp:live-verification

# 13. Recovery review
pnpm mvp:live-recovery
```
