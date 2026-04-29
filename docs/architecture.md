# HireLoop Architecture

## Product Positioning

HireLoop 是一个基于飞书 Base 的招聘运营辅助系统。系统目标是把候选人处理过程拆成可审计的 Agent 工作流，但最终录用或淘汰必须由人类确认。

系统不是自动录用或自动淘汰工具。

## Agents

| Agent | 职责 | 可写表 |
|-------|------|--------|
| HR Coordinator | 流程协调、任务分配、状态更新 | Candidates, Agent Runs |
| Resume Parser | 简历结构化事实抽取，只抽取不评价 | Resume Facts, Candidates, Agent Runs |
| Screening | 基于 JD 和事实做三档评估 | Evaluations, Candidates, Agent Runs |
| Interview Kit | 生成面试问题、评分表、关注点 | Interview Kits, Candidates, Agent Runs |
| Analytics | 漏斗统计、周报、阻塞点分析 | Reports, Agent Runs |

## Base Tables

| 表 | 用途 |
|----|------|
| Jobs | 岗位定义、要求、评分标准 |
| Candidates | 候选人记录与状态跟踪 |
| Resume Facts | 从简历抽取的结构化事实 |
| Evaluations | 初筛评估结果 |
| Interview Kits | 面试准备材料 |
| Agent Runs | 审计日志 |
| Work Events | Agent 工具调用与流程事件日志 |
| Reports | 招聘周报与分析 |

`pnpm base:plan` 当前会生成 8 张表、89 条建表/建字段命令，`Unsupported fields: 0`。

## Status Flow

```text
new -> parsed -> screened -> interview_kit_ready -> decision_pending -> offer / rejected
```

- Agent 只推进 `new` 到 `decision_pending`。
- `offer` / `rejected` 只能由 `human_confirm` actor 推进。
- `talent_pool` 不作为主状态，只作为 Evaluations 或 Reports 中的建议标签。
- Screening 推荐为三档：`strong_match` / `review_needed` / `weak_match`。

## Runtime Layers

```text
src/
  agents/         Agent 输出 schema 和校验
  base/           飞书 Base 表结构、command plan、record resolution、read-only runner
  llm/            deterministic client、provider adapter/client、provider smoke/demo
  orchestrator/   pipeline、状态机、live runner、release gate、安全审计
  runtime/        JSON/dataset/AgentInputBundle 装载、RAG dataset verification
  server/         本地 UI service、request guards、redaction、live Base service、link registry
  ui/             静态 ES modules 前端
tests/            逻辑测试和 route 测试
```

## Important Runtime Concepts

Agent 不直接拼接或执行 `lark-cli` 命令。业务逻辑先生成 typed command plan，再交给 runner 执行。这样可以集中处理 dry-run 默认行为、写入守卫、字段值校验和状态机校验。

Base link 字段只能写入真实记录 ID（`rec_xxx`），不能写业务侧 ID（如 `job_demo_*` 或 `cand_demo_*`）。真实流程中需要先查询或创建目标记录，拿到 Base record ID 后再写关联字段。

`lark-cli +record-upsert` 没有 `--record-id` 时是创建新记录。真实更新操作必须先通过 `+record-list` 查询拿到 `rec_xxx`，再带 `--record-id` 执行更新。

## Current Live Candidate Flow

Live candidate 相关路径已经统一使用 `readLiveCandidateContext(linkId, options)`：

- `requireJob: false`：只要求候选人和简历，供 provider preview 使用。
- `requireJob: true`：同时要求岗位要求和评分标准，供 deterministic dry-run 和 write plan 使用。
- link 不存在、Base blocked、候选人读取失败、缺简历、缺岗位字段等 blocked 路径集中在 context 层。

当前 live candidate 写回是两步：

1. `generateLiveCandidateWritePlan()` 只读生成计划和 `planNonce`。
2. `executeLiveCandidateWrites()` 重新读取数据、重新跑 pipeline、复算 nonce，通过双确认后顺序执行写入。

这条新 live candidate flow 目前只推进到 `decision_pending`，不做 `offer` / `rejected`。
