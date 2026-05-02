# RAG Contract

## Current State

Current canonical handoff: `docs/current-state.md`.

RAG 当前包含两层：通用 `AgentInputBundle`/verification 契约，以及已接入的 Competition Graph RAG 只读数据层。Evidence 默认不进入 prompt。

**2026-05-02 更新 (P2/P3)**: Competition Graph RAG 已通过 `competition-rag-adapter.ts` 和 `competition-demo-view-model.ts` 集成。方向为 A（Feishu Live Pipeline）为主、B（Graph RAG）为辅。图谱能力作为结构化元数据增强 Graph Builder、Screening Reviewer 和 Decision 环节。Raw evidence 不直接进入 provider prompt；安全结构化摘要（`graphProjection`、`topNeighbors`、预留 `gnnSignal`）可作为 Reviewer 输入。`evidenceMayEnterPrompt: false` 仍表示不把原始 evidence/snippet 透传进 prompt。

相关文件：

- `src/runtime/bundle-loader.ts`
- `src/runtime/rag-dataset-verification.ts`
- `src/runtime/competition-rag-adapter.ts`
- `src/runtime/competition-demo-view-model.ts`
- `tests/runtime/bundle-loader.test.ts`
- `tests/runtime/rag-dataset-verification.test.ts`
- `docs/competition-integration-handoff.zh.md`
- `docs/competition-integration-handoff.en.md`

## AgentInputBundle

`AgentInputBundle` 是外部数据/RAG 层进入系统的契约。它作为外部契约层存在，不替代 pipeline 内部的 `CandidatePipelineInput`。

核心字段：

- `candidate: CandidateProfile`
- `job: JobContext`
- `evidence: RetrievedEvidence[]`
- `provenance`
- `runMode`
- `guardFlags`

`agentInputBundleToPipelineInput(bundle)` 是单向 adapter。Pipeline 内部继续使用 `CandidatePipelineInput`，避免一次性改动 30+ 测试文件和多个 agent 输入类型。

## Evidence Input Forms

Loader 支持两种形态：

1. 每个 candidate 内嵌 evidence：

```json
[
  {
    "candidate": {},
    "job": {},
    "evidence": []
  }
]
```

2. Envelope：`evidencePool + evidenceIds`，loader 负责 join 成每个 candidate 专属 evidence 子集。

这种设计允许队友先产出独立 evidence 池和 candidate 映射，后续 retriever 直接用 candidate + job 做 query 时也不用改 `AgentInputBundle`。

## SourceRef Boundary

`RetrievedEvidence.sourceRef` 只允许以下前缀：

- `dataset:`
- `note:`
- `base:`

不能放 raw path、record ID、URL token 或本地文件路径。

## Snippet Cleaning

Loader 对 snippet 做安全处理：

- 命中敏感模式：`redactionStatus = "blocked"`，snippet 置空。
- 超过 500 字符：截断并加 `[已截断]` 标记。
- 正常文本：`redactionStatus = "clean"`。

Blocked evidence 不计入 usable evidence coverage，也不进入 evidence usage。

## Verification Report

`verifyBundles()` 输出 `RagDatasetVerificationReport`：

- `status: "passed" | "needs_review" | "failed"`
- `totalCandidates`
- `completed`
- `failed`
- `evidenceCoverage`
- `redactionBlockedCount`
- `schemaErrors`
- `providerBlockedCount`
- `evidenceUsage`
- `guardrailSummary`
- `safeSummary`

`schemaErrors.field` 经过白名单处理，未知或恶意字段名统一映射为 `unknown`。

## Prompt Boundary

默认规则：

- Evidence 不进入 `resumeText`。
- Evidence 不进入 `jobRequirements`。
- Evidence 不进入 `jobRubric`。
- Evidence 只进入 snapshot/UI/verification。

如果后续要让 evidence 进入某个 agent prompt，需要单独设计：

- 哪些 `usedFor` 可以给哪些 agent。
- snippet 最大长度。
- redaction blocked 时如何降级。
- evidence hash 是否影响 planNonce。
- provider 模式下是否允许发送 evidence。

## Current / Next RAG Work

当前方向：Graph RAG 作为 pipeline 增强层，嵌入 Graph Builder、Screening Reviewer 和 Decision 环节。

1. 图谱结构化元数据（图投影分、特征数、邻居数）作为 Graph Builder / Reviewer 的安全结构化上下文。
2. 图谱复核面板嵌入 Decision 阶段的 UI。
3. 保持 `evidenceMayEnterPrompt: false`，raw evidence/snippet 不直接进 provider prompt。
4. 数据源：`competition /artifacts/memory_graph/` 静态 CSV，通过 `competition-rag-adapter.ts` 读取。
5. `gnnSignal` 已作为稳定 review response 字段预留，当前为 `null`。

## Competition Graph RAG Preparation

`competition ` 目录是队友的 Graph-Based Hiring Memory System。当前接入方式有两层：

- Dataset / verification 层：通过 `AgentInputBundle.evidence` 接入。
- Product / UI / Reviewer 层：通过 `/api/competition/*` 和 `buildCompetitionCandidateReview()` 暴露安全结构化摘要。

准备脚本：

```bash
pnpm competition:rag:prepare --limit=20
```

默认输入：

- `competition /artifacts/memory_graph/resumes.csv`
- `competition /artifacts/memory_graph/candidate_features.csv`
- `competition /artifacts/memory_graph/candidate_similarity_edges.csv`
- `competition /artifacts/memory_graph/graph_projection_memory.csv`
- `competition /artifacts/memory_graph/jobs.csv`
- 如果主产物缺少 `graph_projection_memory.csv` 或 `jobs.csv`，脚本会回退读取 `_checkpoints`。

默认输出：

- `tmp/competition-rag-bundles.json`
- 命令输出 adapter report 和 `RagDatasetVerificationReport`

映射规则：

- `resumes.csv` -> bundle `candidate` + `job`
- `graph_projection_memory.csv` -> `usedFor: "hr_review"` evidence
- `jobs.csv` -> `usedFor: "display"` role memory evidence
- `candidate_features.csv` -> `usedFor: "display"` candidate feature evidence
- `candidate_similarity_edges.csv` -> `usedFor: "display"` similar-candidate evidence
- future `gnn_predictions.csv` -> `gnnSignal`（见 `docs/competition-integration-handoff.zh.md`）

安全边界保持不变：

- 该准备层只读本地 CSV，不写飞书 Base。
- raw evidence/snippet 仍不直接进入 provider prompt。
- 安全结构化摘要可以用于 verification、UI 展示、demo view model 和 Reviewer 输入。
- HR 决策仍必须走人工确认，图谱 projection 只能作为解释性 prior。
