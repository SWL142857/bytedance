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

## Provider Dataset Verification

```bash
pnpm provider:dataset-verify \
  --input-file=./path/to/candidate-dataset.jsonl \
  --execute-provider \
  --confirm=VERIFY_PROVIDER_DATASET_EXECUTE
```

该命令只验证 provider 模型执行和本地 snapshot，不做 Base 写入。缺少 provider env 时会 blocked，不 fallback deterministic。

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
pnpm ui:dev
```

真实飞书写回演示目前建议停在 `decision_pending`，等 [Live MVP Work Plan](live-mvp-work-plan.md) 中的 human decision 和 analytics runner 补齐后再串完整闭环。
