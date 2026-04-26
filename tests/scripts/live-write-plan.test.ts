import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildLiveMvpPlan } from "../../src/orchestrator/live-mvp-plan.js";
import { resolveRecordsFromOutputs, recordIdentityKey } from "../../src/base/record-resolution.js";
import { MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY } from "../../src/base/mvp-resolution.js";
import { runRecordResolutionPlan } from "../../src/base/record-resolution-runner.js";
import { loadConfig } from "../../src/config.js";
import type { ResolvedRecord } from "../../src/base/record-resolution.js";

function makeSampleStdout(records: Array<{ id: string; fields: Record<string, unknown> }>): string {
  return JSON.stringify({
    items: records.map((r) => ({ record_id: r.id, fields: r.fields })),
    total: records.length,
    has_more: false,
  });
}

const SAMPLE_JOB_STDOUT = makeSampleStdout([
  { id: "rec_demo_job_001", fields: { job_id: "job_demo_ai_pm_001" } },
]);

const SAMPLE_CANDIDATE_STDOUT = makeSampleStdout([
  { id: "rec_demo_candidate_001", fields: { candidate_id: "cand_demo_001" } },
]);

function getSampleResolvedRecords(): ResolvedRecord[] {
  return resolveRecordsFromOutputs(
    [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY],
    {
      [recordIdentityKey(MVP_JOB_IDENTITY)]: SAMPLE_JOB_STDOUT,
      [recordIdentityKey(MVP_CANDIDATE_IDENTITY)]: SAMPLE_CANDIDATE_STDOUT,
    },
  );
}

function runLiveWritePlanScript(args: string[] = []) {
  const env = { ...process.env };
  delete env.LARK_APP_ID;
  delete env.LARK_APP_SECRET;
  delete env.BASE_APP_TOKEN;
  delete env.HIRELOOP_ALLOW_LARK_WRITE;

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/demo-live-write-plan.ts", ...args],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf-8",
    },
  );
}

describe("live write plan — sample mode", () => {
  it("generates a plan using sample resolution", async () => {
    const resolvedRecords = getSampleResolvedRecords();
    const plan = await buildLiveMvpPlan({
      resolvedRecords,
      decision: "offer",
      decidedBy: "test_hm",
      decisionNote: "Test note",
    });
    assert.ok(plan.commands.length > 0);
    assert.equal(plan.finalDecisionStatus, "offer");
  });

  it("script sample mode outputs only safe plan details", () => {
    const result = runLiveWritePlanScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Resolution source: sample/);
    assert.match(result.stdout, /Resolved records: 2/);
    assert.match(result.stdout, /Total commands: 20/);
    assert.match(result.stdout, /writesRemote: true/);
    assert.ok(!result.stdout.includes("--json"), "Must not print command args");
    assert.ok(!result.stdout.includes("--base-token"), "Must not print token args");
    assert.ok(!result.stdout.includes("rec_demo_job_001"), "Must not print record IDs");
    assert.ok(!result.stdout.includes("AI Product Manager with 6 years"), "Must not print resume text");
  });
});

describe("live write plan — readonly blocked fails closed", () => {
  it("does not generate write plan when resolution is blocked", () => {
    const result = runRecordResolutionPlan({
      identities: [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY],
      config: loadConfig({}),
      execute: true,
    });

    assert.equal(result.runResult.blocked, true);
    assert.equal(result.resolvedRecords.length, 0);

    // Cannot build write plan with 0 resolved records
    assert.ok(result.resolvedRecords.length === 0, "Must fail closed: no resolved records when blocked");
  });

  it("does not generate write plan when allowLarkWrite is missing", () => {
    const result = runRecordResolutionPlan({
      identities: [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY],
      config: loadConfig({
        LARK_APP_ID: "fake",
        LARK_APP_SECRET: "fake",
        BASE_APP_TOKEN: "fake",
      }),
      execute: true,
    });

    assert.equal(result.runResult.blocked, true);
    assert.equal(result.resolvedRecords.length, 0);
  });

  it("readonly script exits without generating write commands when config is missing", () => {
    const result = runLiveWritePlanScript(["--use-readonly-resolution"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Resolution source: read-only live resolution/);
    assert.match(result.stdout, /Read-only resolution blocked/);
    assert.ok(!result.stdout.includes("=== Write Plan ==="));
    assert.ok(!result.stdout.includes("Total commands: 20"));
    assert.ok(!result.stdout.includes("--json"));
    assert.ok(!result.stdout.includes("--base-token"));
  });
});

describe("live write plan — output safety", () => {
  it("plan result does not contain raw tokens in command descriptions", async () => {
    const resolvedRecords = getSampleResolvedRecords();
    const plan = await buildLiveMvpPlan({
      resolvedRecords,
      decision: "offer",
      decidedBy: "test_hm",
      decisionNote: "Test note",
    });

    for (const cmd of plan.commands) {
      assert.ok(!cmd.description.includes("Bearer"), "Description must not contain Bearer");
      assert.ok(!cmd.description.includes("token_"), "Description must not contain token_");
    }
  });

  it("plan result does not contain resume text in descriptions", async () => {
    const resolvedRecords = getSampleResolvedRecords();
    const plan = await buildLiveMvpPlan({
      resolvedRecords,
      decision: "offer",
      decidedBy: "test_hm",
      decisionNote: "Test note",
    });

    for (const cmd of plan.commands) {
      assert.ok(
        !cmd.description.includes("AI Product Manager with 6 years"),
        "Description must not contain resume text",
      );
    }
  });

  it("redactedArgs do not contain tokens", async () => {
    const resolvedRecords = getSampleResolvedRecords();
    const plan = await buildLiveMvpPlan({
      resolvedRecords,
      decision: "offer",
      decidedBy: "test_hm",
      decisionNote: "Test note",
    });

    for (const cmd of plan.commands) {
      const allRedacted = cmd.redactedArgs.join(" ");
      assert.ok(!allRedacted.includes("Bearer"), "Redacted args must not contain Bearer");
    }
  });
});
