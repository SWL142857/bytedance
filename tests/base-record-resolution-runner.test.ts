import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runRecordResolutionPlan,
} from "../src/base/record-resolution-runner.js";
import { recordIdentityKey } from "../src/base/record-resolution.js";
import type { RecordIdentity } from "../src/base/record-resolution.js";
import type { CommandExecutor, CommandResult } from "../src/base/read-only-runner.js";
import { loadConfig } from "../src/config.js";

const JOB_IDENTITY: RecordIdentity = {
  tableName: "jobs",
  businessField: "job_id",
  businessId: "job_demo_ai_pm_001",
};

const CANDIDATE_IDENTITY: RecordIdentity = {
  tableName: "candidates",
  businessField: "candidate_id",
  businessId: "cand_demo_001",
};

function makeSuccessStdout(records: Array<{ id: string; fields: Record<string, unknown> }>): string {
  return JSON.stringify({
    items: records.map((r) => ({ record_id: r.id, fields: r.fields })),
    total: records.length,
    has_more: false,
  });
}

const JOB_STDOUT = makeSuccessStdout([
  { id: "recJob001", fields: { job_id: "job_demo_ai_pm_001" } },
]);

const CANDIDATE_STDOUT = makeSuccessStdout([
  { id: "recCand001", fields: { candidate_id: "cand_demo_001" } },
]);

function makeSuccessExecutor(
  stdoutMap: Record<string, string>,
): CommandExecutor {
  let callIdx = 0;
  const keys = Object.keys(stdoutMap);

  return (_command: string, _args: string[]): CommandResult => {
    const key = keys[callIdx]!;
    callIdx++;
    return {
      description: `faked ${key}`,
      status: "success",
      stdout: stdoutMap[key] ?? null,
      stderr: null,
      exitCode: 0,
      durationMs: 1,
    };
  };
}

function makeConfig(): ReturnType<typeof loadConfig> {
  return loadConfig({
    LARK_APP_ID: "fake",
    LARK_APP_SECRET: "fake",
    BASE_APP_TOKEN: "fake",
    HIRELOOP_ALLOW_LARK_READ: "1",
  });
}

describe("runRecordResolutionPlan — dry-run", () => {
  it("returns planned results with resolvedRecords=[]", () => {
    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: loadConfig({}),
      execute: false,
    });
    assert.equal(result.mode, "dry_run");
    assert.equal(result.runResult.mode, "dry_run");
    assert.equal(result.runResult.blocked, false);
    assert.equal(result.runResult.results[0]!.status, "planned");
    assert.equal(result.resolvedRecords.length, 0);
  });
});

describe("runRecordResolutionPlan — execute blocked", () => {
  it("returns resolvedRecords=[] when config is incomplete", () => {
    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: loadConfig({}),
      execute: true,
    });
    assert.equal(result.mode, "execute");
    assert.equal(result.runResult.mode, "execute");
    assert.equal(result.runResult.blocked, true);
    assert.equal(result.resolvedRecords.length, 0);
  });

  it("returns resolvedRecords=[] when allowLarkRead is not set", () => {
    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: loadConfig({
        LARK_APP_ID: "fake",
        LARK_APP_SECRET: "fake",
        BASE_APP_TOKEN: "fake",
      }),
      execute: true,
    });
    assert.equal(result.mode, "execute");
    assert.equal(result.runResult.mode, "execute");
    assert.equal(result.runResult.blocked, true);
    assert.equal(result.resolvedRecords.length, 0);
  });
});

describe("runRecordResolutionPlan — command failure", () => {
  it("returns resolvedRecords=[] when command is failed", () => {
    const failExecutor: CommandExecutor = (): CommandResult => ({
      description: "failed",
      status: "failed",
      stdout: null,
      stderr: "error",
      exitCode: 1,
      durationMs: 1,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor: failExecutor,
    });

    assert.equal(result.mode, "execute");
    assert.equal(result.runResult.mode, "execute");
    assert.equal(result.resolvedRecords.length, 0);
    assert.equal(result.runResult.results[0]!.status, "failed");
  });

  it("returns resolvedRecords=[] when command is skipped", () => {
    const skipExecutor: CommandExecutor = (): CommandResult => ({
      description: "skipped",
      status: "skipped",
      stdout: null,
      stderr: null,
      exitCode: null,
      durationMs: 0,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor: skipExecutor,
    });

    assert.equal(result.mode, "execute");
    assert.equal(result.runResult.mode, "execute");
    assert.equal(result.resolvedRecords.length, 0);
  });
});

describe("runRecordResolutionPlan — success resolution", () => {
  it("resolves single identity from success stdout", () => {
    const executor = makeSuccessExecutor({
      [recordIdentityKey(JOB_IDENTITY)]: JOB_STDOUT,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor,
    });

    assert.equal(result.mode, "execute");
    assert.equal(result.runResult.mode, "execute");
    assert.equal(result.resolvedRecords.length, 1);
    assert.equal(result.resolvedRecords[0]!.recordId, "recJob001");
    assert.equal(result.resolvedRecords[0]!.businessId, "job_demo_ai_pm_001");
  });

  it("resolves multiple identities in order", () => {
    const executor = makeSuccessExecutor({
      [recordIdentityKey(JOB_IDENTITY)]: JOB_STDOUT,
      [recordIdentityKey(CANDIDATE_IDENTITY)]: CANDIDATE_STDOUT,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY, CANDIDATE_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor,
    });

    assert.equal(result.mode, "execute");
    assert.equal(result.runResult.mode, "execute");
    assert.equal(result.resolvedRecords.length, 2);
    assert.equal(result.resolvedRecords[0]!.tableName, "jobs");
    assert.equal(result.resolvedRecords[0]!.recordId, "recJob001");
    assert.equal(result.resolvedRecords[1]!.tableName, "candidates");
    assert.equal(result.resolvedRecords[1]!.recordId, "recCand001");
  });
});

describe("runRecordResolutionPlan — resolution errors fail closed", () => {
  it("returns resolvedRecords=[] when stdout has zero matches", () => {
    const emptyStdout = makeSuccessStdout([]);
    const executor = makeSuccessExecutor({
      [recordIdentityKey(JOB_IDENTITY)]: emptyStdout,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor,
    });

    assert.equal(result.resolvedRecords.length, 0);
  });

  it("returns resolvedRecords=[] when stdout has multiple matches", () => {
    const dupStdout = makeSuccessStdout([
      { id: "recDup001", fields: { job_id: "job_demo_ai_pm_001" } },
      { id: "recDup002", fields: { job_id: "job_demo_ai_pm_001" } },
    ]);
    const executor = makeSuccessExecutor({
      [recordIdentityKey(JOB_IDENTITY)]: dupStdout,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor,
    });

    assert.equal(result.resolvedRecords.length, 0);
  });

  it("returns resolvedRecords=[] when stdout has invalid record ID", () => {
    const badStdout = makeSuccessStdout([
      { id: "job_demo_ai_pm_001", fields: { job_id: "job_demo_ai_pm_001" } },
    ]);
    const executor = makeSuccessExecutor({
      [recordIdentityKey(JOB_IDENTITY)]: badStdout,
    });

    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: makeConfig(),
      execute: true,
      executor,
    });

    assert.equal(result.resolvedRecords.length, 0);
  });
});

describe("runRecordResolutionPlan — write commands rejected", () => {
  it("throws ReadOnlyExecutionBlockedError for write commands", async () => {
    const { ReadOnlyExecutionBlockedError } = await import("../src/base/read-only-runner.js");
    const upsertCmd = {
      description: "write",
      command: "lark-cli",
      args: ["base", "+record-upsert"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };

    // runRecordResolutionPlan builds its own commands from identities,
    // which are always +record-list. But let's verify the runner doesn't
    // produce write commands by checking the plan.
    const result = runRecordResolutionPlan({
      identities: [JOB_IDENTITY],
      config: loadConfig({}),
      execute: false,
    });

    for (const r of result.runResult.results) {
      assert.equal(r.status, "planned");
    }

    // Direct test: assertReadOnlyCommands on a write command throws
    const { assertReadOnlyCommands } = await import("../src/base/read-only-runner.js");
    assert.throws(
      () => assertReadOnlyCommands([upsertCmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });
});
