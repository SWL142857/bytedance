# Phase Status

Current canonical handoff: `docs/current-state.md`.

## Completed

| 阶段 | 状态 | 结果 |
|------|------|------|
| MVP deterministic local flow | 完成 | Pipeline、Human Decision、Analytics 可通过 `pnpm mvp:demo` 离线验证 |
| Live Base guard | 完成 | record resolution、read-only smoke、write plan、guarded live write runner、audit、recovery、verification、runbook 和 release gate 已就绪 |
| Phase 5.3 | 完成 | disabled provider adapter boundary，默认 fail-closed |
| Phase 5.4 | 完成 | guarded provider connectivity smoke runner，默认 dry-run |
| Phase 5.5 | 完成 | guarded OpenAI-compatible provider client，实现 `LlmClient`，默认不接入业务 agents |
| Phase 5.6 | 完成 | schema retry and safe parse loop，invalid JSON/schema failure 最多安全重试一次 |
| Phase 5.7 | 完成 | opt-in provider-backed parser demo，无 Base 写入，默认不外呼 |
| Phase 5.8 | 完成 | API boundary release audit，并纳入 release gate |
| Phase 6.0 | 完成 | 安全本地 UI service + 中文企业级前端 shell |
| Phase 6.1a | 完成 | 本地真实 agent 输入驱动 + runtime snapshot |
| Phase 6.4 | 完成 | Live dataset agent runner，支持 JSON array / JSONL 输入 |
| Phase 6.6 | 完成 | forbidden trace scanner 接入 release gate、API boundary audit 和 server report |
| Phase 6.7 | 完成 | 飞书实时只读 + 安全跳转 |
| Phase 6.8 | 完成 | 前端候选人 detail 可运行 deterministic Agent 预演 |
| P1 Competition Shell Refactor | 已完成，P2 方向纠正 | Graph RAG 曾被做成独立驾驶舱；P2 纠正方向为 A 为主 B 为辅，Graph RAG 溶解进 Pipeline 的 Graph Builder/Reviewer/Decision 环节 |
| P2 Product Realignment | 完成 | Feishu Live Pipeline 恢复为主产品；Graph RAG 作为 pipeline 增强层嵌入；P1 独立 UI 方向纠正 |
| P3 Agent Replacement | 完成 | 当前产品语言为 7-Agent 虚拟组织：HR 协调、简历录入、信息抽取、图谱构建、图谱复核、面试准备、数据分析 |
| Virtual Org Console Design | 已敲定 | 2026-05-02 前端方向为全画幅 HireLoop Virtual Org Console，真实 API 数据优先，禁止 mock cockpit |
| Phase 6.9 | 完成 | Live Provider Agent Preview，需要 confirm，不写 Base |
| Phase 7.0 | 完成 | Live candidate 两步写回到 `decision_pending`，双确认 + planNonce |
| Phase 7.1a | 完成 | `readLiveCandidateContext()` 统一 live candidate/job 读取 |
| Phase 7.1 | 完成 | 前端 operator workspace 拆成 ES modules，候选人 detail panel 四区展示 |
| Phase 7.3 | 完成 | `AgentInputBundle`、`RetrievedEvidence[]`、bundle loader、adapter |
| Phase 7.4 | 完成 | RAG-aware dataset verification report |
| Competition Graph RAG API Contract | 完成 | `/api/competition/*`、adapter/view-model、`gnnSignal` 预留字段和中英文 handoff 文档已具备 |
| Phase 7.5 | 完成 | request guards 抽取，route/body/write/RAG 安全边界补测试 |
| Phase 7.6 | 完成 | Live Base bootstrap：preflight、setup、seed（含 job link）、安全 report |
| Phase 7.7 | 完成 | Live human decision：`decision_pending -> offer/rejected`，双确认 + TOCTOU guard |
| Phase 7.8 | 完成 | Live analytics report：只读聚合真实 Base，双确认后写 Reports + Agent Runs |
| Phase 7.9 | 完成 | Live E2E runbook：13 步可重复命令顺序，5 个 sample scenario，失败恢复规则 |

## Current Capabilities

- `pnpm mvp:demo`：本地 deterministic 端到端，pipeline -> human decision -> analytics。
- `pnpm base:plan`：生成 8 张飞书 Base 表的建表计划。
- `pnpm base:seed:dry-run`：生成建表 + demo job/candidate seed 计划。
- `pnpm ui:dev`：启动本地 UI，显示 demo/runtime snapshot/live records。
- `GET /api/live/base-status`：检查飞书只读连接状态。
- `GET /api/live/records?table=candidates|jobs`：返回飞书安全列表，不暴露 record ID 和简历原文。
- `POST /api/live/candidates/:linkId/run-dry-run`：对真实候选人跑 deterministic dry-run，不写 Base。
- `POST /api/live/candidates/:linkId/run-provider-agent-demo`：confirm 后对真实候选人跑完整 P3 provider preview pipeline，不写 Base。
- `POST /api/live/candidates/:linkId/generate-write-plan`：只读生成写回计划摘要。
- `POST /api/live/candidates/:linkId/execute-writes`：双确认 + planNonce 后写回 pipeline 产物到 `decision_pending`。
- `POST /api/live/candidates/:linkId/generate-human-decision-plan`：生成人类决策计划摘要。
- `POST /api/live/candidates/:linkId/execute-human-decision`：双确认 + planNonce 后写回 offer/rejected 人类决策。
- `POST /api/live/analytics/generate-report-plan`：只读聚合真实 Base，生成 Analytics 报告写回计划。
- `POST /api/live/analytics/execute-report`：双确认 + planNonce 后写回 Reports + Agent Runs。
- `pnpm mvp:live-e2e-runbook`：输出 13 步 E2E runbook，支持 5 个 sample scenario，不需要真实 env。

## Deferred

| 项 | 原因 |
|----|------|
| Competition GNN/query-aware subgraph | 等队友把 GNN prediction / query-aware subgraph 输出整理为 handoff 文档约定字段 |
| Write-back UI execute button | UI 写入需要单独安全交互设计；当前只展示 write plan summary |

## Next Focus

真实飞书 MVP 闭环已补齐，API + runbook 均已就绪。下一步：

1. 按 `docs/competition-integration-handoff.zh.md` / `docs/competition-integration-handoff.en.md` 继续接入 GNN、matched features、query-aware subgraph。
2. 继续提升 provider preview 的真实运行稳定性，失败也必须安全审计呈现。
3. 真实飞书 smoke：在真实 Base 上跑一遍完整流程验证。
4. Feishu Base schema migration：为已 bootstrap 的 Base 补齐新增 select options。

详细任务见 [Live MVP Work Plan](live-mvp-work-plan.md)。
