# HireLoop Current State

Last updated: 2026-05-06.

This is the first file a new agent should read. It reconciles the older 5-agent MVP docs, the Competition Graph RAG work, and the current Virtual Org Console direction.

## Product Truth

HireLoop is a Feishu Base-backed recruitment virtual organization. Feishu Base is the source of truth. Agents operate around Base records, produce safe plans and audit events, and require human confirmation for real writes.

The product is not:

- A standalone Graph RAG demo dashboard.
- An automatic hire/reject system.
- A UI-only mock cockpit.

## Current Product Direction

The approved direction is:

**Feishu Live Pipeline as the main product, Competition Graph RAG as the explainability and technical innovation layer.**

Frontend direction accepted on 2026-05-02:

- Full-canvas `HireLoop Virtual Org Console`.
- Seven digital employees visible as status/audit surfaces.
- Real Feishu pipeline is the operational spine.
- Competition Graph RAG is visually prominent near Graph Builder and Reviewer, but remains decision support.
- Audit timeline and status surfaces must use real APIs, not random logs or hardcoded success.

Public operator guide:

- `docs/website-usage.zh.md`

## Current Agent Organization

The old 5-agent MVP has been superseded by the P3 7-agent organization:

| Digital employee | Internal agent key | Role |
| --- | --- | --- |
| HR 协调 | `hr_coordinator` | Coordinates handoff and final human decision readiness |
| 简历录入 | `resume_intake` | Deterministic intake and source packaging |
| 信息抽取 | `resume_extraction` | Provider/deterministic structured extraction |
| 图谱构建 | `graph_builder` | Candidate graph signal and similarity context |
| 图谱复核 | `screening_reviewer` | Graph-assisted review recommendation |
| 面试准备 | `interview_kit` | Interview questions, scorecard, and risk checks |
| 数据分析 | `analytics` | Funnel analytics and reports |

Legacy names such as `resume_parser` and `screening` may still exist in schema options or compatibility mappings. They are not the current product language.

## Runtime Pipeline

### Candidate Status Flow (persisted state machine)

This is the compact, source-of-truth candidate status machine. Only these transitions exist:

```text
new -> parsed -> screened -> interview_kit_ready -> decision_pending -> offer / rejected
```

`offer` and `rejected` are terminal states reachable only by human confirmation.

### Visual Org Relay Flow (UI display pipeline)

The UI shows an expanded 9-stage pipeline for the virtual organization:

```text
Feishu/new
  -> Intake (简历录入)
  -> Extraction (信息抽取)
  -> Graph Builder (图谱构建)
  -> Interview Kit (面试准备)
  -> Reviewer (图谱复核)
  -> HR Coordinator (HR 协调)
  -> decision_pending (待人工决策)
  -> Analytics (数据分析)
```

The first 8 stages map to the candidate status machine. The 9th stage, **Analytics (数据分析)**, is a **post-decision continuous-optimization / reporting node**:

- Analytics does NOT change candidate status (no auto hire/reject).
- Analytics does NOT trigger automatic Feishu writes.
- Analytics is **not reachable** from `finalStatus` alone — its "reached" state is driven by real work-events (`/api/work-events` agent_name === "数据分析") or org overview agent data (`/api/org/overview`).
- If no analytics events exist, the Analytics pipeline card shows "待执行" / "待运行快照".
- The Relay Player still highlights the Analytics card during playback (it's part of the visual org relay), but highlights should not imply the node completed.

Important mapping rule:

- If a runtime result has `failedAgent`, UI must map the failed node from `failedAgent` first.
- Do not infer failure location from ambiguous statuses like `screened`.
- The Analytics node's snapshot availability must NOT be inferred from candidate `finalStatus`. Use work-events or org overview agent data only, and do not label Analytics "completed" just because the candidate pipeline completed.

## Graph RAG Boundary

Competition Graph RAG data is connected through:

- `src/runtime/competition-rag-adapter.ts`
- `src/runtime/competition-demo-view-model.ts`
- `GET /api/competition/overview`
- `GET /api/competition/search?q=...`
- `GET /api/competition/review?candidateId=...`
- Handoff docs: `docs/competition-integration-handoff.zh.md` and `docs/competition-integration-handoff.en.md`

Current smoke data:

- 5991 candidates.
- 23961 evidence records.
- 38 roles.

Graph RAG must remain safe:

- `evidenceMayEnterPrompt: false`
- `writesAllowed: false`
- `humanDecisionRequired: true`
- No external LLM calls from the Competition dashboard/API.
- No Feishu writes from Competition routes.
- No raw evidence JSON, local paths, payloads, model IDs, endpoints, stdout/stderr, stack traces, or full resume text in UI.
- Raw evidence text does not enter provider prompts. Safe structured graph summaries (`graphProjection`, `topNeighbors`, future `gnnSignal`) may be passed to Reviewer.

Current interface status:

- `graphProjection`: implemented and used by API/UI/Reviewer.
- `similarCandidates`: implemented; API/UI use it, Reviewer receives it as `topNeighbors`.
- `matchedFeatures`: implemented for API/UI explanation; not yet Reviewer input.
- `roleMemory`: implemented for API/UI explanation; Reviewer still primarily uses JD + Graph Builder summary.
- `gnnSignal`: stable API field exists and is currently `null`; pipeline will pass it to Reviewer once available.

## Feishu Write Boundary

Real writes are guarded and opt-in:

- Candidate write plan and execute are separate.
- Execute requires loopback, JSON content type, body size cap, confirmation phrases, and `planNonce`.
- Human decision is a separate guarded path and only supports `decision_pending -> offer/rejected`.
- Analytics report writes are a separate guarded runner.
- UI must not add a direct execute button or prefill confirmation tokens.

## Feishu Navigation Surface

Safe browser navigation is separate from write APIs:

- Header button `打开飞书 Base` opens `/go/base`.
- Candidate detail button `打开飞书记录` opens `/go/:linkId`.
- Availability comes from `/api/live/base-status` field `feishuWebUrlAvailable`.
- `handleGo()` only returns a `302` to configured Feishu web URLs, or a safe JSON unavailable message.
- Navigation routes never mutate Base state and must not become write entry points.

## Current Verification Commands

Use these before handing work back:

```bash
pnpm typecheck
pnpm test
pnpm competition:rag:prepare -- --limit=20
pnpm ui:dev -- --port=3001
```

For focused frontend/Graph RAG/backend checks:

```bash
pnpm exec tsx --test \
  tests/server/server-routes.test.ts \
  tests/server/competition-routes.test.ts \
  tests/runtime/competition-demo-view-model.test.ts \
  tests/orchestrator/live-candidate-runner.test.ts
```

Known local gap on 2026-05-06:

- `pnpm typecheck` currently fails in `src/feishu/long-connection.ts` and related tests because `@larksuiteoapi/node-sdk` is missing from the workspace baseline.
- Feishu safe-jump and UI boundary work was verified with:

```bash
node --import tsx --test tests/server/live-base.test.ts tests/server/server-routes.test.ts
```

## Documentation Priority

When docs conflict, trust them in this order:

1. `docs/current-state.md`
2. `CLAUDE.md`
3. `README.md`
4. `docs/website-usage.zh.md`
5. `docs/architecture.md`
6. `docs/phase-status.md`
7. `docs/operations-runbook.md`
8. `docs/security-boundaries.md`
9. `docs/competition-integration-handoff.zh.md` / `docs/competition-integration-handoff.en.md`
10. `docs/rag-contract.md`

Historical specs/prompts/plans are kept out of the public repo and should not be treated as authoritative project state.
