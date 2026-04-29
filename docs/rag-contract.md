# RAG Contract

## Current State

RAG 当前只完成输入契约、loader、adapter 和 dataset verification report。真实 retriever 尚未接入，evidence 默认不进入 prompt。

相关文件：

- `src/runtime/bundle-loader.ts`
- `src/runtime/rag-dataset-verification.ts`
- `tests/runtime/bundle-loader.test.ts`
- `tests/runtime/rag-dataset-verification.test.ts`

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

## Next RAG Work

等队友把数据集和 RAG 接入后再继续：

1. 接入真实 dataset loader 输入源。
2. 运行 `verifyBundles()` 生成 coverage report。
3. 根据 evidence coverage 决定是否展示 UI evidence summary。
4. 再决定是否让 screening 或 interview kit agent 消费 evidence。

在真实数据接入前，不建议改 pipeline agent input，也不建议把 evidence 拼进 prompt。
