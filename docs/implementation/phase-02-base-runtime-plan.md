# Phase 2 Implementation Plan: Base Runtime Contract

> Historical implementation plan. For current project truth, read `docs/current-state.md` first.

## Goal

Turn the current static contracts into an executable runtime layer that can:

1. Build a deterministic Feishu Base setup plan from `src/base/schema.ts`.
2. Seed one demo job and one demo candidate.
3. Run in dry-run mode by default without touching any external API.
4. Execute real `lark-cli base +...` commands only when explicitly enabled.
5. Preserve the project boundary: no model calls, no real candidate PII, no fake success logs.

This phase prepares for real Base integration while keeping all tests deterministic.

## Non-Goals

- Do not call any LLM provider.
- Do not implement real resume parsing or screening prompts yet.
- Do not create dashboards, workflows, permissions, or reports in Base yet.
- Do not store real credentials or real candidate data.
- Do not make `--execute` the default.

## Safety Rules

- Default mode is `--dry-run`.
- Real writes require both:
  - CLI flag: `--execute`
  - Env flag: `HIRELOOP_ALLOW_LARK_WRITE=1`
- If either is missing, the command must print the planned operations only.
- The runtime must never print `LARK_APP_SECRET`, model keys, or full candidate resume text.
- Any real command failure must be reported as failure, never converted into success.
- No Base list command should run concurrently.

## Deliverables

### 1. Runtime Config

Files:

- `src/config.ts`

Responsibilities:

- Read environment variables.
- Validate required values only when execution mode is enabled.
- Expose a typed `HireLoopConfig`.
- Redact secrets in any printable representation.

Expected env vars:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `BASE_APP_TOKEN`
- `MODEL_API_KEY`
- `MODEL_API_ENDPOINT`
- `HIRELOOP_ALLOW_LARK_WRITE`
- `DEBUG`

### 2. Base Command Planner

Files:

- `src/base/commands.ts`
- `src/base/field-mapping.ts`

Responsibilities:

- Convert `TableDef` and `FieldDef` into command specs.
- Generate deterministic operation order:
  1. Create or ensure tables.
  2. Create fields.
  3. Seed Jobs.
  4. Seed Candidates.
- Return structured command specs, not shell strings.
- Keep command execution separate from planning.

Command spec shape should include:

- `description`
- `command`
- `args`
- `redactedArgs`
- `writesRemote`

Notes:

- Use only `lark-cli base +...` command shapes.
- Exact Feishu field properties can be conservative in this phase. If a field type is not safely mapped yet, the planner should mark it as unsupported rather than guessing.

### 3. Lark CLI Runner

Files:

- `src/base/lark-cli-runner.ts`

Responsibilities:

- Execute command specs serially.
- Support dry-run mode.
- Use `node:child_process` with argv arrays, not shell-concatenated strings.
- Redact secrets in logs.
- Return structured results:
  - planned
  - skipped
  - success
  - failed

Execution guard:

```text
execute === true && HIRELOOP_ALLOW_LARK_WRITE === "1"
```

### 4. Demo Fixtures

Files:

- `src/fixtures/demo-data.ts`

Responsibilities:

- Provide one demo job and one demo candidate.
- Candidate must be synthetic and non-PII.
- Resume text must be short and fake.
- Use deterministic IDs.

### 5. Scripts

Files:

- `scripts/plan-base.ts`
- `scripts/seed-base.ts`

Responsibilities:

- `plan-base`: print Base setup plan only.
- `seed-base`: dry-run by default; supports `--execute`.
- Both should use the shared command planner.
- Both should fail fast on invalid config in execute mode.

Package scripts:

- `base:plan`
- `base:seed:dry-run`
- `base:seed:execute`

### 6. Tests

Files:

- `tests/base-command-planner.test.ts`
- `tests/config.test.ts`

Coverage:

- Dry-run does not execute remote commands.
- Execute mode is blocked without `HIRELOOP_ALLOW_LARK_WRITE=1`.
- Command order is deterministic.
- No command spec contains raw secrets.
- Unsupported field types fail explicitly.
- Demo fixture contains no obvious real PII.

## Acceptance Criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm base:plan` prints deterministic planned operations.
- `pnpm base:seed:dry-run` prints planned operations and performs no remote writes.
- No real Feishu API call happens in tests.
- No dependency beyond existing Node/TypeScript/tsx unless justified.

## Codex Review Focus

- Execution guard cannot be bypassed accidentally.
- Command runner uses argv arrays, not shell string concatenation.
- No secrets or full resume text are logged.
- Planner does not guess unsupported Feishu field properties.
- Dry-run output is honest and cannot be mistaken for successful remote execution.
- Seed data is synthetic and deterministic.

## Next Phase After This

Phase 3 should add the first actual Agent pipeline in local deterministic form:

1. Resume Parser prompt contract.
2. Screening prompt contract.
3. Interview Kit prompt contract.
4. Model client abstraction for domestic models.
5. A dry-run demo pipeline that validates schema output before any Base write.
