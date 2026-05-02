# HireLoop Virtual Org Console Frontend Design

## Decision

HireLoop frontend will become a full-canvas virtual organization console, not a standalone demo dashboard and not a generic SaaS admin page.

The visual direction borrows the user's preferred "Apple Pro / full-frame command center" language: restrained dark surface, cinematic spatial layout, high information density, precise status lighting, and a strong system-online feeling. The product truth remains unchanged: Feishu Base is the source of truth, seven Agent employees collaborate through the pipeline, and Competition Graph RAG is the explainability and technical innovation layer inside screening/review.

## Visual Thesis

A calm, premium, full-canvas recruitment operations console where seven digital employees orbit Feishu Base data, with Competition Graph RAG rendered as an explainable intelligence layer over screening and decision stages.

## Content Plan

1. **Command Header**
   - Product name: `HireLoop Virtual Org Console` / `飞书招聘虚拟组织控制台`.
   - Live state: Feishu read-only connection, runtime snapshot freshness, safety boundary.
   - Must avoid marketing-only copy. It should orient an operator in seconds.

2. **Virtual Organization Map**
   - Seven Agent employees are visible as the organizational backbone:
     `简历录入`, `信息抽取`, `图谱构建`, `图谱复核`, `面试准备`, `HR 协调`, `数据分析`.
   - Each Agent shows role, target Feishu table, current mode, last safe summary, and status.
   - Agent cards are status/audit surfaces, not direct execution buttons.

3. **Feishu Pipeline Main Stage**
   - Main workspace shows the real candidate state machine:
     `new -> Intake -> Extraction -> Graph Builder -> Interview Kit -> Reviewer -> HR Coordinator -> decision_pending`.
   - Visual state must come from real runtime data:
     reached, current, failed, pending, completed.
   - If `failedAgent` exists, it overrides ambiguous `finalStatus` mapping.

4. **Graph RAG Intelligence Layer**
   - Embedded near `Graph Builder` and `Reviewer`, never as the primary standalone product.
   - Uses real Competition Graph RAG APIs:
     `/api/competition/search?q=...`
     `/api/competition/review?candidateId=...`
   - Shows graph projection, role memory, matched features, similar candidates, and human decision checkpoint.
   - It may be visually prominent because it is the main technical innovation, but copy must say it supports decisions and does not replace human judgment.

5. **Candidate Inspector**
   - Opens from real Feishu candidate rows.
   - Shows read-only Feishu candidate context, dry-run/provider preview actions, write plan status, failure node, and human confirmation boundary.
   - Provider preview copy must describe the full P3 Provider Pipeline, not a legacy Resume Parser.

6. **Audit Timeline**
   - Replaces random mock logs.
   - Reads from `/api/work-events`, runtime snapshots, and safe API summaries.
   - Shows only safe summaries: no raw JSON, payloads, stack traces, local paths, credentials, full resume text, endpoint, modelId, stdout, or stderr.

## Interaction Thesis

1. **System boot entrance**
   - A brief startup overlay or staged reveal is allowed.
   - It must not imply fake execution. Use wording like "控制台就绪" rather than "Agent 已完成任务" unless backed by data.

2. **Pipeline state motion**
   - Reached stages can animate in sequence based on actual data.
   - Failed stage should pulse or hold a clear red boundary.
   - Pending stages should be subdued, not displayed as completed.

3. **Graph RAG reveal**
   - Graph RAG search/review results may expand from the pipeline stage.
   - Motion should emphasize evidence explanation: graph projection, similar candidates, matched features.
   - No artificial `setTimeout` success, fake confidence, fake edge counts, or random log generation.

## Data Contract

The frontend must consume existing safe APIs and avoid inventing new data unless the backend is explicitly updated.

| Surface | Source |
| --- | --- |
| Hero KPIs | `/api/org/overview`, `/api/work-events`, `/api/live/base-status` |
| Seven Agents | `/api/org/overview` plus static display metadata only for labels/descriptions |
| Live Feishu Data | `/api/live/records?table=candidates`, `/api/live/records?table=jobs` |
| Pipeline | `/api/demo/pipeline` |
| Work Events | `/api/work-events` |
| Operator Tasks | `/api/operator/tasks` |
| Graph Search | `/api/competition/search?q=...` |
| Graph Review | `/api/competition/review?candidateId=...` |
| Candidate Actions | existing guarded candidate detail routes |

Allowed static constants:
- Agent display names.
- Agent avatars/initials.
- Role descriptions.
- Target table labels.
- Empty-state copy.
- Safety boundary copy.

Disallowed hardcoding:
- Candidate counts, evidence counts, graph scores, confidence values, similar edge counts.
- Random audit logs.
- Fake success states.
- Fake Feishu connection status.
- Fake model execution success.
- Any UI state that contradicts `completed`, `failedAgent`, `finalStatus`, live Base status, or API errors.

## Safety Requirements

These boundaries are part of the frontend contract and must remain visible:

- No automatic hire/reject.
- No automatic Feishu writes.
- Real writes require human confirmation.
- Competition evidence does not enter Agent prompts.
- The Graph RAG dashboard does not call external LLMs.
- Do not show raw JSON, payload, stdout, stderr, stack traces, apiKey, endpoint, modelId, local paths, record IDs, or full resume text.
- Do not leak the local `competition ` directory path.

## Frontend Form

Use a full-canvas layout instead of a simple bento dashboard.

Recommended structure:

```text
Header: product identity, Feishu state, safety mode, freshness

Main canvas:
  Left / center: Feishu pipeline as the operational spine
  Around spine: seven Agent employees as status nodes
  Graph RAG layer: highlighted intelligence plane between Graph Builder and Reviewer
  Right inspector: selected candidate, actions, evidence, failure state
  Bottom rail: audit timeline and operator tasks

Drawer:
  Security console, provider readiness, release gate, API boundary audit
```

The UI may feel cinematic, but it must still behave like an operations tool. If an operator scans only headings, badges, numbers, and status labels, they should understand what is live, what is simulated, what failed, and what requires human action.

## Implementation Boundaries For Claude / Antigravity

Frontend implementation may edit:
- `src/ui/index.html`
- `src/ui/style.css`
- `src/ui/pipeline.js`
- `src/ui/app.js`
- `src/ui/constants.js`
- `src/ui/work-events.js`
- `src/ui/live-records.js`
- `src/ui/operator-tasks.js`
- `src/ui/candidate-detail.js`
- small new `src/ui/*.js` modules if they reduce file size or isolate rendering logic.

Frontend implementation must not edit:
- Agent prompt modules.
- Orchestrator pipeline behavior.
- Feishu write guards.
- Competition RAG adapter/runtime scoring.
- Server API contracts, unless a missing safe display field is explicitly approved first.

## Acceptance Criteria

- First viewport clearly reads as a real Feishu-backed virtual organization console.
- The seven Agent employees are visible and explain their real responsibilities.
- The pipeline reflects actual runtime state and failure position.
- Graph RAG search/review uses real API fields:
  `candidateId`, `graphProjection`, `roleMemory`, `matchedFeatures`, `similarCandidates`, `humanDecisionCheckpoint`.
- No mock logs, fake scores, fake edge counts, or fake success states.
- Candidate detail states that provider preview runs the full P3 Provider Pipeline.
- Mobile has no horizontal overflow except intentional scrollable pipeline rails.
- `pnpm typecheck` passes.
- Existing server/UI route tests continue to pass.

## Open Follow-Up

This frontend redesign is display-layer work. Backend improvements to provider reliability, Base schema migration, and user accounts should remain separate phases so the visual redesign does not accidentally weaken safety or data contracts.
