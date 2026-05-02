# Competition P2 Refactor Design — A 为主，B 为辅

> Historical design note. P2 product realignment is complete. Current execution should use `docs/current-state.md` and the 2026-05-02 Virtual Org Console frontend design. References to 5-Agent language or Screening/Decision naming reflect the state before P3.

## Context

P0 接入了 Graph RAG 静态 CSV 数据（5991 候选人、23961 证据、38 岗位），P1 构建了独立的 Graph RAG 驾驶舱 UI。P1 隐含的产品决策（B 为主）与比赛核心要求（Feishu Base + Multi-Agent 虚拟组织）不一致。

本设计纠正方向：

- **A（Feishu Live Pipeline）** — 主产品。5 Agent 虚拟组织，飞书读写，状态流转，人工决策，分析报告。比赛维度 1+3 的核心得分来源。
- **B（Graph RAG）** — 辅助增强层。嵌入 Screening 和 Decision 两个环节，用图投影、岗位记忆、特征匹配、相似候选人等结构化元数据增强 Agent 判断，不替代 Agent。

## Decision Recap

| 决策 | 选择 |
|------|------|
| 主次关系 | A 为主，B 为辅 |
| 嵌入位置 | Screening + Decision 两阶段 |
| 证据边界 | 结构化元数据（图投影分、特征数、邻居数），不进 prompt text |
| 数据源 | 始终读 `competition /artifacts/memory_graph/` CSV，不桥接飞书 |
| 现有 UI 处置 | 独立驾驶舱溶解进 pipeline 流程，`competition-demo.js` 合并进 `pipeline.js` |

## Architecture Target

### Product Shell

```
┌─────────────────────────────────────────┐
│  Header: 职链 HireLoop · AI 招聘虚拟组织    │
├─────────────────────────────────────────┤
│                                         │
│  ═══ Pipeline（主视觉） ═══               │
│  ┌─────────────────────────────────┐    │
│  │ 候选人流水线（横向漏斗）            │    │
│  │ new → parsed → screened → ...   │    │
│  │ ┌─────────────────────────────┐ │    │
│  │ │ 图谱增强筛选结果              │ │    │
│  │ │ （搜索/浏览/特征匹配）         │ │    │
│  │ └─────────────────────────────┘ │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ 组织运行总览   │  │ 最近活动        │   │
│  │（5 虚拟员工）  │  │（演示事件）     │   │
│  └──────────────┘  └────────────────┘   │
│                                         │
│  ═══ 决策复核（图谱增强） ═══             │
│  ┌─────────────────────────────────┐    │
│  │ 候选人详情 · 图投影 · 特征 · 相似  │    │
│  │ [人工确认] → 写入飞书             │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ═══ 系统集成状态 ═══                    │
│  │ 飞书连接 · 任务清单 · 控制台         │    │
│                                         │
└─────────────────────────────────────────┘
```

### Data Flow

```
competition /artifacts/memory_graph/
  ├── resumes.csv
  ├── candidate_features.csv
  ├── candidate_similarity_edges.csv
  ├── graph_projection_memory.csv
  └── jobs.csv
        │
        ▼
  competition-rag-adapter.ts
  (CSV → CompetitionRagEnvelope)
        │
        ▼
  competition-demo-view-model.ts
  (envelope → structured metadata:
   graphScore, neighborCount, featureCount,
   similarCandidates[], matchedFeatures[])
        │
        ├──→ Screening Agent input（结构化数字字段）
        │     • graphProjectionScore
        │     • matchedFeatureCount
        │     • similarCandidateCount
        │     （不进 prompt，作为 input 附件）
        │
        └──→ Decision UI（图谱复核面板）
              • 图投影摘要
              • 命中特征列表
              • 相似候选人
              • 人工决策检查点
```

### Pipeline Input Extension

```typescript
// 现有 CandidatePipelineInput 不变，新增可选字段
interface CandidatePipelineGraphContext {
  graphProjectionScore: number;
  graphProjectionConfidence: number;
  neighborCount: number;
  matchedFeatureCount: number;
  matchScore: number;
}
```

Screening Agent 的 input 中附加 `graphContext?: CandidatePipelineGraphContext`，Agent 在评分时作为辅助参考（非 prompt 内容，作为系统级评分权重调节）。

## Files to Delete

这些是 P0/P1 构建的独立 Graph RAG 驾驶舱 UI 文件，溶解后不再独立存在：

| 文件 | 理由 |
|------|------|
| `src/ui/competition-demo.js` | 合并进 `pipeline.js` |
| `src/ui/competition-demo-config.js` | 合并进 `pipeline.js` 或 constants |
| `src/ui/data-source-labels.js` | 简化后内联到各模块，或保留为轻量 helper |
| `docs/superpowers/specs/2026-05-01-competition-graph-rag-demo-p0-design.md` | 被本设计取代 |
| `docs/superpowers/specs/2026-05-01-competition-shell-refactor-p1-design.md` | 方向已纠正 |
| `docs/superpowers/plans/2026-05-01-competition-shell-refactor-p1-implementation-plan.md` | 被新计划取代 |
| `docs/competition-demo-script.md` | 过时，后续更新为 pipeline 演示脚本 |

## Files to Modify

### `src/ui/index.html` — 恢复 Pipeline 为主

- 移除独立 `<section id="competition-section">` 整个区块
- 移除 `integration-section` wrapper 和 `integration-notice`
- 恢复原始 hero/pipeline 作为首页第一视觉（但 hero copy 更新为当前状态）
- Pipeline 横向漏斗下方新增"图谱增强筛选"区域（嵌入 competition search/浏览能力）
- Decision 区域下方新增"图谱复核"面板（嵌入 review 能力）
- 保留飞书连接、组织总览、最近活动、任务清单、控制台

### `src/ui/pipeline.js` — 合并图谱 UI 能力

- 合并 `competition-demo.js` 的搜索、候选卡片、复核面板逻辑
- 新增 `renderGraphEnhancedScreening(container)` — 在 pipeline 下方展示图谱增强的候选人搜索/浏览
- 新增 `renderGraphReview(candidateId)` — 展示图投影、特征、相似候选人
- 保留原有 `renderHero`、`renderPipeline`、`renderOrgOverview`

### `src/ui/app.js` — 调整初始化

- 移除 `initCompetitionDemo()` 调用
- 在 pipeline 加载完成后调用图谱增强渲染
- 保持原有初始化顺序不变

### `src/ui/style.css` — 清理 + 重写

- 移除独立 competition section 的大段 CSS（~500 行）
- 保留并精简图谱增强区域的样式（嵌入 pipeline 后的内联风格）

### `src/server/server.ts` — API 路由保留

- `/api/competition/overview`、`/search`、`/review` 路由保留
- 它们仍然是 pipeline 内部调用的数据接口

### `src/server/operator-tasks-demo.ts` — 恢复原始 notice

- 移除 P1 加入的 competition 文案，恢复或更新为 pipeline 状态说明

### `src/ui/safety-badge.js` — 清理 P1 侵入

- 移除 `getDataSourceMode()` 和 `_dataSourceMode`（P1 新增的动态标签逻辑）

### `src/ui/operator-tasks.js`、`work-events.js`、`live-records.js` — 恢复原始

- 移除 P1 加入的 `data-source-badge` 动态标签

### `docs/architecture.md`、`docs/rag-contract.md`、`docs/phase-status.md`、`docs/live-mvp-work-plan.md`

- 更新为 P2 方向，移除 P1 过时信息

## Files to Keep Unchanged

| 文件 | 理由 |
|------|------|
| `src/runtime/competition-rag-adapter.ts` | 数据层，继续使用 |
| `src/runtime/competition-demo-view-model.ts` | View model，pipeline 调用 |
| `src/runtime/bundle-loader.ts` | 安全边界不变 |
| `src/orchestrator/candidate-pipeline.ts` | 核心 pipeline 不变 |
| `src/orchestrator/live-*.ts` | 飞书写入路径不变 |
| `src/server/request-guards.ts` | 安全守卫不变 |
| `src/server/redaction.ts` | 脱敏逻辑不变 |
| `scripts/prepare-competition-rag.ts` | 数据准备脚本保留 |
| `tests/runtime/competition-*.test.ts` | 测试保留 |
| `tests/server/competition-routes.test.ts` | 测试保留 |

## Safety Boundaries — Unchanged

```
evidenceMayEnterPrompt: false   → 不变
writesAllowed: false            → 不变
humanDecisionRequired: true     → 不变
loopback-only write routes      → 不变
confirm phrases                 → 不变
planNonce TOCTOU                → 不变
redaction policy                → 不变
no external LLM from dashboard  → 不变
no auto hire/reject             → 不变
```

图谱元数据作为 pipeline input 的结构化数字字段，不进入 Agent prompt 文本。Screening Agent 的评分逻辑可以读取 `graphContext` 的数值来调节权重（纯代码逻辑，不涉及 prompt 注入）。

## Non-Goals

- 不修改 `runCandidatePipeline()` 行为
- 不修改 Feishu write 路径
- 不添加新的外部 LLM 调用
- 不构建用户认证系统
- 不删除 `competition /` 目录
- 不修改 competition CSV 数据

## Verification

```bash
pnpm typecheck
pnpm exec tsx --test tests/server/server-routes.test.ts tests/server/competition-routes.test.ts tests/runtime/competition-demo-view-model.test.ts
pnpm competition:rag:prepare -- --limit=20
pnpm ui:dev -- --port=3001
```

Manual checks at http://localhost:3001:
- 首页第一视觉是 Pipeline（非独立 Graph RAG 驾驶舱）
- Pipeline 下方有图谱增强筛选区域
- 图谱复核面板在 decision 环节可见
- 飞书连接、组织总览、最近活动、任务清单正常
- 无 raw JSON / 敏感数据泄露
- 桌面和移动端无布局溢出
