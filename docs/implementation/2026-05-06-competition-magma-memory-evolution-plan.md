# Competition MAGMA Memory Evolution Plan

> Last updated: 2026-05-06

## Goal

把 MAGMA 的“双流记忆演化”能力接到现有 Competition Graph RAG 数据层和 HireLoop 前端复核面板里，形成一套可生成、可读取、可展示的最小闭环：

1. `competition` 生成 MAGMA 风格的记忆演化产物。
2. `bytedance` 读取这些产物并挂到 `/api/competition/review`。
3. Graph RAG 复核面板展示 fast path / slow path 的结构化结果。

## Scope

- 数据侧目录：`competition/src/memory_graph_pipeline`
- 当前产物目录：`competition/artifacts/memory_graph`
- 前端与只读 API：`bytedance/src/runtime`、`bytedance/src/server`、`bytedance/src/ui`

## Non-Goals

- 不把 raw evidence 直接送入 provider prompt。
- 不引入真实异步队列、远程 worker 或新的外部依赖。
- 不改变人工决策边界，所有录用/淘汰仍由人确认。

## Workstreams

### 1. Competition: MAGMA-style artifacts

- [ ] 新增记忆演化构建模块，基于现有 `resumes / profiles / features / edges / projections / jobs` 产物推导：
  - `memory_evolution_events.csv`
  - `memory_evolution_relations.csv`
  - `memory_evolution_summary.json`
- [ ] fast path 产物至少表达：
  - 事件分割摘要
  - 向量索引状态
  - 不可变时间主干（temporal backbone）
- [ ] slow path 产物至少表达：
  - 局部邻域大小
  - semantic neighbor 链接
  - entity bridge 链接
  - causal pattern 链接
- [ ] 主 pipeline 与 snapshot graph builder 自动输出这组新产物。
- [ ] 增加一个可对现有 `artifacts/memory_graph` 目录补产物的 CLI。

### 2. Bytedance: adapter + review API

- [ ] `competition-rag-adapter.ts` 读取新产物，并按 `candidate_id` 建立只读索引。
- [ ] `competition-demo-view-model.ts` 给 review response 增加 `memoryEvolution` 字段。
- [ ] `/api/competition/review` 返回该字段，但仍保持只读、安全脱敏和不写飞书。

### 3. UI: Graph RAG review panel

- [ ] 在候选人深度复核面板展示：
  - fast path 摘要
  - slow path 巩固摘要
  - 关键推断链接
- [ ] 保持现有 UI 视觉语言，不新增复杂交互。

### 4. Verification

- [ ] 补充 TypeScript 测试覆盖 adapter / view-model / route。
- [ ] 至少运行一次本地构建脚本，为当前 `competition/artifacts/memory_graph` 生成新产物。

## Acceptance

- `competition/artifacts/memory_graph/` 下出现新的记忆演化 CSV/JSON 产物。
- `GET /api/competition/review?candidateId=...` 返回 `memoryEvolution`。
- Graph RAG 面板可以展示 fast path / slow path 的结构化信息。
- 现有安全边界不变：
  - `readOnly = true`
  - `writesAllowed = false`
  - `humanDecisionRequired = true`
  - raw evidence 不进入 prompt

## Implementation Notes

- 这一版 slow path 使用基于现有图谱产物的确定性巩固逻辑，作为 MAGMA 后台结构巩固的工程化近似。
- 真实的后台 LLM 推断链路可以后续替换当前 deterministic consolidation，而不破坏前端字段和 API 结构。
