# Competition Graph RAG 接入交接文档

Last updated: 2026-05-02
Canonical state: `docs/current-state.md`

本文给接手 Competition / Graph RAG 整合的队友使用。目标是让 Graph RAG 能力清楚地接入 HireLoop，而不是再做一个独立 demo。

## 当前定位

HireLoop 的主产品是 **Feishu Live Pipeline**。Competition Graph RAG 是解释增强层，嵌入 Graph Builder、图谱复核 Reviewer 和人工决策检查点。

当前已经完成：

- 读取 Competition memory graph CSV。
- 暴露只读 API：`/api/competition/overview`、`/api/competition/search`、`/api/competition/review`。
- 前端 Graph RAG 候选人队列和深度图谱分析使用真实 API。
- Pipeline Reviewer 已读取 `graphProjection`、`similarCandidates`，并预留 `gnnSignal` 接口。
- 所有 Graph RAG 路由只读，不写飞书，不自动录用/淘汰。

当前没有完成：

- `gnnSignal` 还没有真实数据，API 返回 `null`。
- `matchedFeatures` 主要用于 UI 解释，尚未作为 Reviewer 输入。
- `roleMemory` 主要用于 UI 解释；Reviewer 当前仍以 JD + Graph Builder 摘要为主。
- Competition 的 query-aware subgraph / `search_rag_demo.py` 排序逻辑尚未完整移植。

## 目录约定

默认本地 Competition 目录是：

```text
competition /
```

注意目录名目前带尾随空格。它是本地工作区，不建议整体提交到 GitHub。

必须存在的输入：

```text
competition /artifacts/memory_graph/resumes.csv
```

可选但强烈建议存在的输入：

```text
competition /artifacts/memory_graph/candidate_features.csv
competition /artifacts/memory_graph/candidate_similarity_edges.csv
competition /artifacts/memory_graph/graph_projection_memory.csv
competition /artifacts/memory_graph/jobs.csv
```

如果 `graph_projection_memory.csv` 或 `jobs.csv` 不在主目录，adapter 会尝试读取：

```text
competition /artifacts/memory_graph/_checkpoints/graph_projection_memory.csv
competition /artifacts/memory_graph/_checkpoints/jobs.csv
```

不要提交这些大文件：

```text
competition /artifacts/
competition /memU/
.playwright-cli/
output/playwright/
```

`.gitignore` 已经屏蔽它们。

## 当前代码接口

### 数据适配层

文件：

```text
src/runtime/competition-rag-adapter.ts
```

入口：

```ts
buildCompetitionRagEnvelope({
  competitionRoot: "competition ",
  limit,
  maxFeaturesPerCandidate,
  maxNeighborsPerCandidate,
})
```

输出：

```ts
{
  envelope: {
    candidates: CompetitionRagEnvelopeCandidate[],
    evidencePool: RetrievedEvidenceLike[]
  },
  report: {
    status: "ready" | "partial",
    candidateCount: number,
    evidenceCount: number,
    missingOptionalFiles: string[],
    safeSummary: string
  }
}
```

映射关系：

| Competition 文件 | HireLoop 输出 |
| --- | --- |
| `resumes.csv` | candidate + job base record |
| `candidate_features.csv` | matched feature evidence |
| `candidate_similarity_edges.csv` | similar candidate evidence |
| `graph_projection_memory.csv` | graph projection evidence |
| `jobs.csv` | role memory evidence |

### View model 层

文件：

```text
src/runtime/competition-demo-view-model.ts
```

入口：

```ts
buildCompetitionDemoOverview(options)
buildCompetitionSearchResult(query, options)
buildCompetitionCandidateReview(candidateId, options)
```

稳定 review response：

```ts
interface CompetitionCandidateReview {
  candidate: CompetitionCandidateCard;
  graphProjection: CompetitionGraphProjection | null;
  gnnSignal: CompetitionGnnSignal | null;
  roleMemory: string | null;
  matchedFeatures: CompetitionFeatureEvidence[];
  similarCandidates: CompetitionNeighborEvidence[];
  humanDecisionCheckpoint: string;
}

interface CompetitionGnnSignal {
  available: boolean;
  selectProbability: number;
  effectivePrediction: string;
  sourceRun: string | null;
}
```

`gnnSignal` 是给后续接入预留的稳定字段。当前返回 `null`，但 pipeline 已经会读取该字段。

### HTTP API

文件：

```text
src/server/server.ts
```

接口：

```http
GET /api/competition/overview
GET /api/competition/search?q=Python
GET /api/competition/review?candidateId=CAN-000042
```

当前本地 smoke：

```json
{
  "candidateCount": 5991,
  "evidenceCount": 23961,
  "roleCount": 38
}
```

### Pipeline 接入点

文件：

```text
src/orchestrator/candidate-pipeline.ts
src/agents/reviewer.ts
```

当前流程：

```text
runCandidatePipeline()
  -> runIntake()
  -> runExtraction()
  -> runGraphBuilder()
  -> runInterviewKit()
  -> buildCompetitionCandidateReview(candidateId)
  -> runReviewer({ graphProjection, gnnSignal, topNeighbors })
  -> runHrCoordinator()
```

如果 `review.gnnSignal?.available === true`，pipeline 会传：

```ts
{
  selectProbability: review.gnnSignal.selectProbability,
  effectivePrediction: review.gnnSignal.effectivePrediction
}
```

## 队友下一步怎么接

### 1. 接入 GNN signal

推荐新增或生成一个稳定产物：

```text
competition /artifacts/memory_graph/gnn_predictions.csv
```

建议字段：

```csv
candidate_id,select_probability,effective_prediction,source_run
CAN-000042,0.73,likely_select,graphsage_hd64_layers2
```

然后改：

```text
src/runtime/competition-rag-adapter.ts
src/runtime/competition-demo-view-model.ts
tests/runtime/competition-rag-adapter.test.ts
tests/runtime/competition-demo-view-model.test.ts
tests/server/competition-routes.test.ts
```

验收：

- `/api/competition/review?candidateId=...` 返回 `gnnSignal.available=true`。
- `runCandidatePipeline()` 的 Reviewer 输入含 `gnnSignal`。
- GNN 只作为辅助 prior，不能替代 graph projection 或人工决策。

### 2. 接入 role memory 到 Reviewer

当前 `roleMemory` 已在 review API/UI 展示，但没有直接塞进 Reviewer prompt。若要让它参与 Reviewer，需要先明确：

- 允许哪些字段进入 provider prompt。
- 最大长度。
- redaction 规则。
- 是否影响 `planNonce`。
- provider 模式下是否允许发送该内容。

建议做法：新增一个安全结构化字段，而不是直接传整段 evidence text。

### 3. 接入 matched features 到 Reviewer

当前 `matchedFeatures` 用于 UI。若要进入 Reviewer，建议传：

```ts
matchedFeatureSummary: Array<{
  featureType: string;
  canonicalName: string;
  confidence: number;
}>
```

不要传 `sourceSnippet` 原文，避免简历片段泄露。

### 4. 接入 query-aware subgraph

Competition 的 `search_rag_demo.py` 有更完整的 query-aware scoring。要接入 HireLoop，建议不要从 UI 直接调用 Python，而是把输出转成 view-model 字段：

```ts
queryAwareSubgraph?: {
  query: string;
  scoreExplanation: string;
  highlightedSignals: string[];
}
```

后续可显示在 Graph RAG 深度分析区。

## 本地验证命令

```bash
pnpm typecheck
pnpm test tests/runtime/competition-rag-adapter.test.ts \
  tests/runtime/competition-demo-view-model.test.ts \
  tests/server/competition-routes.test.ts \
  tests/server/server-routes.test.ts

pnpm competition:rag:prepare -- --limit=20
pnpm ui:dev -- --port=3001
```

API smoke：

```bash
curl -s http://localhost:3001/api/competition/overview
curl -s "http://localhost:3001/api/competition/search?q=Python"
curl -s "http://localhost:3001/api/competition/review?candidateId=CAN-000042"
```

## 安全边界

必须保持：

- Competition API 只读。
- Graph RAG 不写飞书。
- Graph RAG 不自动录用/淘汰。
- `offer` / `rejected` 只能由人类确认。
- 不在 UI/API 暴露 record ID、local path、resume text、apiKey、endpoint、stdout/stderr、stack trace。
- 不把 raw evidence 原文直接塞入 provider prompt。

当前允许：

- 展示图谱投影分、置信度、相似候选人数、命中特征摘要。
- 把安全结构化图谱摘要传给 Reviewer。
- 在 UI 中把 Graph RAG 作为人工复核辅助证据展示。

## GitHub 提交建议

建议提交：

- `src/runtime/competition-rag-adapter.ts`
- `src/runtime/competition-demo-view-model.ts`
- `src/ui/graph-rag.js`
- `src/orchestrator/candidate-pipeline.ts`
- `src/agents/intake.ts`
- `src/agents/extraction.ts`
- `src/agents/graph-builder.ts`
- `src/agents/reviewer.ts`
- tests under `tests/runtime/competition-*` and `tests/server/competition-routes.test.ts`
- docs including this handoff

不要提交：

- `competition /artifacts/`
- `competition /memU/`
- `.playwright-cli/`
- `output/playwright/`

如果要提交 `competition /src` 作为参考源码，建议先改掉目录名尾随空格，或作为独立 repo/submodule 处理。否则跨平台协作会非常容易出坑。
