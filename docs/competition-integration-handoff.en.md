# Competition Graph RAG Integration Handoff

Last updated: 2026-05-02
Canonical state: `docs/current-state.md`

This handoff is for the teammate who will continue integrating the Competition / Graph RAG system into HireLoop. The goal is to make Graph RAG a clear enhancement layer inside the product, not a separate demo dashboard.

## Product Position

HireLoop's primary product is the **Feishu Live Pipeline**. Competition Graph RAG is the explainability and technical innovation layer embedded around Graph Builder, Screening Reviewer, and the human decision checkpoint.

Already implemented:

- Reads Competition memory graph CSV artifacts.
- Exposes read-only APIs: `/api/competition/overview`, `/api/competition/search`, `/api/competition/review`.
- The frontend Graph RAG queue and deep graph analysis call real APIs.
- Pipeline Reviewer already consumes `graphProjection`, `similarCandidates`, and has a stable `gnnSignal` field reserved.
- All Graph RAG routes are read-only. They do not write to Feishu and do not auto-hire or auto-reject candidates.

Not fully implemented yet:

- `gnnSignal` has no real data yet. The API currently returns `null`.
- `matchedFeatures` is mainly used for UI explanation and is not yet a Reviewer input.
- `roleMemory` is mainly used for UI explanation. Reviewer still primarily uses JD + Graph Builder summary.
- Competition's query-aware subgraph / `search_rag_demo.py` scoring logic has not been fully ported.

## Directory Contract

The default local Competition directory is:

```text
competition /
```

The directory name currently includes a trailing space. Treat it as a local workspace; do not commit the whole directory to GitHub.

Required input:

```text
competition /artifacts/memory_graph/resumes.csv
```

Optional but strongly recommended inputs:

```text
competition /artifacts/memory_graph/candidate_features.csv
competition /artifacts/memory_graph/candidate_similarity_edges.csv
competition /artifacts/memory_graph/graph_projection_memory.csv
competition /artifacts/memory_graph/jobs.csv
```

If `graph_projection_memory.csv` or `jobs.csv` is missing from the main directory, the adapter tries:

```text
competition /artifacts/memory_graph/_checkpoints/graph_projection_memory.csv
competition /artifacts/memory_graph/_checkpoints/jobs.csv
```

Do not commit these generated or large paths:

```text
competition /artifacts/
competition /memU/
.playwright-cli/
output/playwright/
```

They are ignored in `.gitignore`.

## Current Code Interfaces

### Data Adapter

File:

```text
src/runtime/competition-rag-adapter.ts
```

Entry point:

```ts
buildCompetitionRagEnvelope({
  competitionRoot: "competition ",
  limit,
  maxFeaturesPerCandidate,
  maxNeighborsPerCandidate,
})
```

Output:

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

Mapping:

| Competition file | HireLoop output |
| --- | --- |
| `resumes.csv` | candidate + job base record |
| `candidate_features.csv` | matched feature evidence |
| `candidate_similarity_edges.csv` | similar candidate evidence |
| `graph_projection_memory.csv` | graph projection evidence |
| `jobs.csv` | role memory evidence |

### View Model

File:

```text
src/runtime/competition-demo-view-model.ts
```

Entry points:

```ts
buildCompetitionDemoOverview(options)
buildCompetitionSearchResult(query, options)
buildCompetitionCandidateReview(candidateId, options)
```

Stable review response:

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

`gnnSignal` is a stable extension point. It currently returns `null`, but the pipeline already reads it when available.

### HTTP API

File:

```text
src/server/server.ts
```

Endpoints:

```http
GET /api/competition/overview
GET /api/competition/search?q=Python
GET /api/competition/review?candidateId=CAN-000042
```

Current local smoke result:

```json
{
  "candidateCount": 5991,
  "evidenceCount": 23961,
  "roleCount": 38
}
```

### Pipeline Integration

Files:

```text
src/orchestrator/candidate-pipeline.ts
src/agents/reviewer.ts
```

Current flow:

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

If `review.gnnSignal?.available === true`, the pipeline passes:

```ts
{
  selectProbability: review.gnnSignal.selectProbability,
  effectivePrediction: review.gnnSignal.effectivePrediction
}
```

## How To Continue The Integration

### 1. Add GNN Signal

Recommended stable artifact:

```text
competition /artifacts/memory_graph/gnn_predictions.csv
```

Recommended columns:

```csv
candidate_id,select_probability,effective_prediction,source_run
CAN-000042,0.73,likely_select,graphsage_hd64_layers2
```

Then update:

```text
src/runtime/competition-rag-adapter.ts
src/runtime/competition-demo-view-model.ts
tests/runtime/competition-rag-adapter.test.ts
tests/runtime/competition-demo-view-model.test.ts
tests/server/competition-routes.test.ts
```

Acceptance criteria:

- `/api/competition/review?candidateId=...` returns `gnnSignal.available=true`.
- `runCandidatePipeline()` passes `gnnSignal` to Reviewer.
- GNN remains an auxiliary prior. It must not replace graph projection or human decision.

### 2. Add Role Memory To Reviewer

`roleMemory` is already visible in the review API/UI, but it is not directly inserted into the Reviewer prompt. Before adding it to Reviewer, define:

- Which fields may enter provider prompts.
- Maximum length.
- Redaction rules.
- Whether the content affects `planNonce`.
- Whether provider mode may transmit the content.

Recommended approach: pass a safe structured summary, not the raw evidence text.

### 3. Add Matched Features To Reviewer

`matchedFeatures` is currently used by the UI. If it should influence Reviewer, prefer:

```ts
matchedFeatureSummary: Array<{
  featureType: string;
  canonicalName: string;
  confidence: number;
}>
```

Do not pass `sourceSnippet` raw text to avoid leaking resume excerpts.

### 4. Add Query-Aware Subgraph

Competition's `search_rag_demo.py` has richer query-aware scoring. Do not call Python directly from the UI. Convert the result into view-model fields instead:

```ts
queryAwareSubgraph?: {
  query: string;
  scoreExplanation: string;
  highlightedSignals: string[];
}
```

This can later be rendered in the Graph RAG deep analysis area.

## Local Verification

```bash
pnpm typecheck
pnpm test tests/runtime/competition-rag-adapter.test.ts \
  tests/runtime/competition-demo-view-model.test.ts \
  tests/server/competition-routes.test.ts \
  tests/server/server-routes.test.ts

pnpm competition:rag:prepare -- --limit=20
pnpm ui:dev -- --port=3001
```

API smoke:

```bash
curl -s http://localhost:3001/api/competition/overview
curl -s "http://localhost:3001/api/competition/search?q=Python"
curl -s "http://localhost:3001/api/competition/review?candidateId=CAN-000042"
```

## Safety Boundaries

Must remain true:

- Competition APIs are read-only.
- Graph RAG does not write to Feishu.
- Graph RAG does not auto-hire or auto-reject.
- `offer` / `rejected` can only be written by human confirmation.
- UI/API must not expose record IDs, local paths, resume text, API keys, endpoints, stdout/stderr, or stack traces.
- Raw evidence text must not be inserted directly into provider prompts.

Allowed:

- Display graph projection score, confidence, similar-candidate count, and matched feature summaries.
- Pass safe structured graph summaries to Reviewer.
- Show Graph RAG as decision-support evidence in the UI.

## GitHub Commit Guidance

Recommended to commit:

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

Do not commit:

- `competition /artifacts/`
- `competition /memU/`
- `.playwright-cli/`
- `output/playwright/`

If `competition /src` should be committed as reference source, first remove the trailing space from the directory name or treat it as a separate repository/submodule. Keeping the trailing-space directory in the main repo will create cross-platform collaboration problems.
