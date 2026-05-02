# Phase 5 API Handoff And Next Steps

> Historical handoff. For current project truth, read `docs/current-state.md` first.

## Current Stop Point

Stop after Phase 5.4: Guarded Provider Connectivity Smoke Runner.

Phase 5.4 scope:

- Add a guarded provider connectivity smoke runner.
- Dry-run must be default and must not call the external model.
- Real connectivity test must require explicit execute flag, explicit confirm phrase, and complete local provider env.
- Smoke request may only use a fixed safe prompt such as `ping`.
- Smoke output must not print API key, model ID, endpoint, request payload, raw provider response, authorization header, resume text, JD text, candidate details, or Base record IDs.
- This phase must not connect provider calls to business agents.
- This phase must not write Base.

Current working tree note:

- Phase 5.4 implementation may be in progress in `package.json`, `scripts/run-provider-smoke.ts`, and `src/llm/provider-smoke-runner.ts`.
- Codex should review and commit Phase 5.4 only after the implementation handoff is complete and verification passes.

## Completed Before 5.4

- Phase 5.0: MVP release gate.
- Phase 5.1: final demo output redaction.
- Phase 5.2: pre-API freeze report.
- Phase 5.3: disabled provider adapter boundary.
- Local provider credentials are kept in `.env.local`, which is ignored by git.
- README and `.env.example` document provider env variables with placeholders only.

## Safety Rules To Preserve

- Default behavior must not call any external model API.
- Default behavior must not write Base.
- Real Base writes must remain guarded by the existing live write runner.
- Model API credentials must never be committed.
- Do not store real API key, real model ID, raw prompt, raw response, authorization header, full resume text, or candidate details in tracked files.
- Do not print request payloads, stdout dumps, raw provider bodies, raw stderr, tokens, or secrets.
- Provider API work must stay behind explicit opt-in flags until release audit says otherwise.

## Next Development Phases

### Phase 5.5 — Provider Client Implementation Behind Guard

Goal:

Implement the real provider client behind the already-defined adapter boundary, but do not connect it to the business agents yet.

Deliverables:

- Add an OpenAI-compatible provider client, likely `OpenAICompatibleClient` or a provider-specific wrapper.
- Read provider config from env:
  - `MODEL_PROVIDER`
  - `MODEL_API_ENDPOINT`
  - `MODEL_ID`
  - `MODEL_API_KEY`
- Implement the existing `LlmClient.complete()` contract.
- Keep fail-closed behavior when config is missing or provider execution is not explicitly enabled.
- Return only the model content needed by downstream schema parsing.
- Do not expose raw provider responses.
- Map provider failures through safe error kinds.
- Unit tests must mock fetch and must not call the real API.

Acceptance criteria:

- Deterministic local demos still run without model API.
- Tests prove missing config blocks before network calls.
- Tests prove raw prompt, API key, model ID, endpoint, payload, and raw response are not surfaced.

### Phase 5.6 — Schema Retry And Safe Parse Loop

Goal:

Prepare agents for real model variability by adding controlled schema retry behavior.

Deliverables:

- Add a safe parse loop around agent model output.
- On invalid JSON or schema failure, retry at most once.
- Retry prompt must not include full resume text, full JD text, raw prompt, or raw provider response.
- Error records must use safe summaries only.
- Deterministic client behavior must remain unchanged.

Acceptance criteria:

- Schema-valid output succeeds normally.
- Invalid JSON retries once and then either succeeds or fails safely.
- Schema-invalid output retries once and then either succeeds or fails safely.
- Failure output does not leak prompt, resume text, payload, or raw provider body.

### Phase 5.7 — Opt-In Real Model Agent Demo

Goal:

Run one smallest possible agent path with the real provider, without writing Base and without changing the main deterministic MVP flow.

Recommended first target:

- Resume Parser only, because it has a clear schema boundary and can produce command plans without Base writes.

Guard requirements:

- Default mode remains deterministic.
- Real provider mode requires all of:
  - `--use-provider`
  - `--execute`
  - `--confirm=EXECUTE_PROVIDER_AGENT_DEMO`
  - complete local provider env
- No Base writes.
- No full prompt, full resume text, raw model output, endpoint, model ID, or API key in stdout.

Acceptance criteria:

- Dry-run shows the planned provider agent demo without network calls.
- Execute mode with missing config is blocked before network calls.
- Execute mode with mocked provider can produce a valid command plan.
- Script output passes final demo output safety checks.

### Phase 5.8 — API Boundary Release Audit

Goal:

Audit that real-provider work did not weaken existing safety boundaries.

Checks:

- Default demos do not call external model APIs.
- Provider smoke requires explicit execute and confirm.
- Provider agent demo requires explicit execute and confirm.
- Base write guard remains independent and unchanged.
- No raw prompt, raw response, provider key, provider model ID, endpoint, record ID, or resume text appears in demo stdout.
- No secrets appear in tracked files or commit history.
- Release gate documents the API boundary status accurately.

Acceptance criteria:

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- Release gate and pre-api freeze remain consistent.
- Forbidden trace scan is clean.
- Secret scan against local `.env.local` values finds no match in tracked files.

## Rough Remaining Work After 5.4

Expected remaining implementation before full API-powered pipeline:

- 5.5 provider client: small to medium.
- 5.6 schema retry loop: medium, because it touches shared agent execution behavior.
- 5.7 opt-in real model agent demo: medium.
- 5.8 release audit: small to medium.

Do not jump straight from 5.4 to full 5-agent real model pipeline. The next safe milestone is one guarded provider-backed agent demo with no Base writes.
