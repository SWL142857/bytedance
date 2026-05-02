# Claude / Antigravity Prompt: HireLoop Virtual Org Console Frontend

You are working in `/Users/rosscai/projects/hireloop`.

Your task is to redesign the frontend into a premium full-canvas **HireLoop Virtual Org Console** while preserving the existing backend contracts and safety boundaries.

Read this design contract first:

`/Users/rosscai/projects/hireloop/docs/superpowers/specs/2026-05-02-virtual-org-console-frontend-design.md`

## Product Direction

The user likes a full-frame Apple Pro style digital command center: calm dark surface, cinematic layout, strong system-online feeling, dense but readable operational information.

Adapt that feeling to HireLoop:

- Feishu Base is the source of truth.
- Seven Agent employees are the virtual organization.
- The real pipeline is the main operational spine.
- Competition Graph RAG is the main technical innovation layer, embedded in Graph Builder / Reviewer.
- Human confirmation and write safety must remain obvious.

Do **not** make a generic SaaS dashboard. Do **not** make a fake demo cockpit.

## Allowed Files

You may edit frontend files only:

- `/Users/rosscai/projects/hireloop/src/ui/index.html`
- `/Users/rosscai/projects/hireloop/src/ui/style.css`
- `/Users/rosscai/projects/hireloop/src/ui/app.js`
- `/Users/rosscai/projects/hireloop/src/ui/pipeline.js`
- `/Users/rosscai/projects/hireloop/src/ui/constants.js`
- `/Users/rosscai/projects/hireloop/src/ui/work-events.js`
- `/Users/rosscai/projects/hireloop/src/ui/live-records.js`
- `/Users/rosscai/projects/hireloop/src/ui/operator-tasks.js`
- `/Users/rosscai/projects/hireloop/src/ui/candidate-detail.js`
- New small `/Users/rosscai/projects/hireloop/src/ui/*.js` modules if helpful.

Do not edit backend, orchestrator, agent, server, Feishu write guard, or Competition RAG runtime files.

## Required Layout

Create a full-canvas control room:

1. Header
   - Product identity: `HireLoop Virtual Org Console` / `飞书招聘虚拟组织控制台`.
   - Feishu read-only status.
   - Runtime snapshot freshness.
   - Safety boundary: no auto hire/reject, no automatic Feishu writes.

2. Main operational canvas
   - Center or left-center pipeline spine:
     `new -> Intake -> Extraction -> Graph Builder -> Interview Kit -> Reviewer -> HR Coordinator -> decision_pending`.
   - Seven digital employee nodes/cards around or near the pipeline:
     `简历录入`, `信息抽取`, `图谱构建`, `图谱复核`, `面试准备`, `HR 协调`, `数据分析`.
   - These are status/audit surfaces, not direct execution buttons.

3. Graph RAG intelligence layer
   - Visually highlight Graph Builder and Reviewer.
   - Provide search/review UI using real APIs:
     `/api/competition/search?q=...`
     `/api/competition/review?candidateId=...`
   - Render only real fields:
     `candidateId`, `graphProjection`, `roleMemory`, `matchedFeatures`, `similarCandidates`, `humanDecisionCheckpoint`.
   - Do not show raw JSON.

4. Candidate inspector
   - Keep existing candidate detail functionality.
   - Provider preview copy must describe the full P3 Provider Pipeline.
   - Show failure agent when available.
   - Preserve all guarded action boundaries.

5. Audit timeline
   - Use real `/api/work-events` and safe runtime summaries.
   - No random logs.
   - No `setInterval` mock events.

## Data Rules

Allowed static constants:

- Agent names.
- Agent role descriptions.
- Agent avatar initials.
- Target table labels.
- Empty states.
- Safety copy.

Forbidden hardcoding:

- Candidate counts.
- Feishu connection status.
- Graph confidence.
- Similar edge counts.
- Evidence counts.
- Audit events.
- Pipeline success/failure.
- Provider success/failure.

The UI must never contradict:

- `data.completed`
- `data.failedAgent`
- `data.finalStatus`
- live Base status APIs
- Competition Graph RAG API responses

If `failedAgent` exists, map the failure node from `failedAgent` first, not from ambiguous `finalStatus`.

## Safety Boundaries

Preserve and visibly communicate:

- No automatic hire/reject.
- No automatic Feishu writes.
- Real writes require human confirmation.
- Competition evidence does not enter Agent prompts.
- No external LLM calls from Competition Graph RAG dashboard.
- No raw JSON, payload, stdout, stderr, stack trace, apiKey, endpoint, modelId, local path, record ID, or full resume text in UI.
- Do not expose the local `competition ` directory path.

## Visual Direction

Use a restrained premium operations aesthetic:

- Full-canvas layout.
- Dark calm surface.
- One main accent color plus semantic states.
- Thin dividers, precise type scale, strong spacing.
- Dense but readable information.
- Graph RAG can have a subtle intelligence-plane visual treatment.
- Avoid cyberpunk clutter, purple-heavy generic AI styling, glassmorphism excess, card soup, fake terminal spam.

Motion is allowed but must be meaningful:

- Short console-ready entrance.
- Pipeline state reveal based on actual data.
- Graph RAG evidence expansion.

## Verification Required

Run:

```bash
pnpm typecheck
pnpm exec tsx --test tests/server/server-routes.test.ts tests/server/competition-routes.test.ts tests/runtime/competition-demo-view-model.test.ts tests/orchestrator/live-candidate-runner.test.ts
```

Manual browser check at `http://localhost:3001/`:

- First viewport clearly reads as a real Feishu-backed virtual organization console.
- Seven Agent employees are visible.
- Pipeline state is dynamic and failure-aware.
- Graph RAG search uses real API data.
- Candidate detail copy is not stale.
- No raw JSON or local paths.
- Mobile has no obvious overlap or accidental horizontal overflow.

## Deliverable

Return a concise report:

- Files changed.
- What data each major section uses.
- How fake/mock data was avoided.
- Verification results.
- Any intentionally deferred backend/API gaps.
