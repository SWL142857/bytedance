# Phase Status

## Completed

| 阶段 | 状态 | 结果 |
|------|------|------|
| MVP deterministic local flow | 完成 | 5 Agent、Human Decision、Pipeline、Analytics 可通过 `pnpm mvp:demo` 离线验证 |
| Live Base guard | 完成 | record resolution、read-only smoke、write plan、guarded live write runner、audit、recovery、verification、runbook 和 release gate 已就绪 |
| Phase 5.3 | 完成 | disabled provider adapter boundary，默认 fail-closed |
| Phase 5.4 | 完成 | guarded provider connectivity smoke runner，默认 dry-run |
| Phase 5.5 | 完成 | guarded OpenAI-compatible provider client，实现 `LlmClient`，默认不接入业务 agents |
| Phase 5.6 | 完成 | schema retry and safe parse loop，invalid JSON/schema failure 最多安全重试一次 |
| Phase 5.7 | 完成 | opt-in provider-backed Resume Parser demo，无 Base 写入，默认不外呼 |
| Phase 5.8 | 完成 | API boundary release audit，并纳入 release gate |
| Phase 6.0 | 完成 | 安全本地 UI service + 中文企业级前端 shell |
| Phase 6.1a | 完成 | 本地真实 agent 输入驱动 + runtime snapshot |
| Phase 6.4 | 完成 | Live dataset agent runner，支持 JSON array / JSONL 输入 |
| Phase 6.6 | 完成 | forbidden trace scanner 接入 release gate、API boundary audit 和 server report |
| Phase 6.7 | 完成 | 飞书实时只读 + 安全跳转 |
| Phase 6.8 | 完成 | 前端候选人 detail 可运行 deterministic Agent 预演 |
| Phase 6.9 | 完成 | Live Provider Agent Preview，需要 confirm，不写 Base |
| Phase 7.0 | 完成 | Live candidate 两步写回到 `decision_pending`，双确认 + planNonce |
| Phase 7.1a | 完成 | `readLiveCandidateContext()` 统一 live candidate/job 读取 |
| Phase 7.1 | 完成 | 前端 operator workspace 拆成 ES modules，候选人 detail panel 四区展示 |
| Phase 7.3 | 完成 | `AgentInputBundle`、`RetrievedEvidence[]`、bundle loader、adapter |
| Phase 7.4 | 完成 | RAG-aware dataset verification report |
| Phase 7.5 | 完成 | request guards 抽取，route/body/write/RAG 安全边界补测试 |

## Current Capabilities

- `pnpm mvp:demo`：本地 deterministic 端到端，pipeline -> human decision -> analytics。
- `pnpm base:plan`：生成 8 张飞书 Base 表的建表计划。
- `pnpm base:seed:dry-run`：生成建表 + demo job/candidate seed 计划。
- `pnpm ui:dev`：启动本地 UI，显示 demo/runtime snapshot/live records。
- `GET /api/live/base-status`：检查飞书只读连接状态。
- `GET /api/live/records?table=candidates|jobs`：返回飞书安全列表，不暴露 record ID 和简历原文。
- `POST /api/live/candidates/:linkId/run-dry-run`：对真实候选人跑 deterministic dry-run，不写 Base。
- `POST /api/live/candidates/:linkId/run-provider-agent-demo`：confirm 后对真实候选人跑 provider Resume Parser demo，不写 Base。
- `POST /api/live/candidates/:linkId/generate-write-plan`：只读生成写回计划摘要。
- `POST /api/live/candidates/:linkId/execute-writes`：双确认 + planNonce 后写回 pipeline 产物到 `decision_pending`。

## Deferred

| 项 | 原因 |
|----|------|
| RAG retriever integration | 等队友接入真实数据集、evidence 更新频率和 retriever 形态后再做 |
| Write-back UI execute button | UI 写入需要单独安全交互设计；当前只展示 write plan summary |
| Live human final decision | 新 live candidate flow 当前刻意停在 `decision_pending`，还缺独立 human-confirm runner |
| Live analytics report | 本地 analytics 已有，真实 Base 聚合和 Reports 写回还缺 dedicated live runner |

## Next Focus

优先级不是 RAG，而是补齐真实飞书 MVP 闭环：

1. Base bootstrap / seed 真实验证，补 job link 自动关联。
2. Live human decision runner：只允许 `decision_pending -> offer/rejected`。
3. Live analytics runner：只读聚合 Base，生成并写 Reports。
4. Operator runbook：把真实飞书流程串成可重复执行的命令顺序。

详细任务见 [Live MVP Work Plan](live-mvp-work-plan.md)。
