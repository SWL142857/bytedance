import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import type { CommandResult } from "../../src/base/lark-cli-runner.js";
import type { ResolvedRecord } from "../../src/base/record-resolution.js";
import { loadConfig } from "../../src/config.js";
import {
  assertLiveMvpWriteCommands,
  LIVE_MVP_WRITE_CONFIRMATION,
  LiveMvpWriteBlockedError,
  runLiveMvpWrites,
  type LiveMvpWriteExecutor,
} from "../../src/orchestrator/live-mvp-runner.js";

const SAMPLE_RESOLVED: ResolvedRecord[] = [
  { tableName: "jobs", businessField: "job_id", businessId: "job_demo_ai_pm_001", recordId: "rec_demo_job_001" },
  { tableName: "candidates", businessField: "candidate_id", businessId: "cand_demo_001", recordId: "rec_demo_candidate_001" },
];

function validConfig() {
  return loadConfig({
    LARK_APP_ID: "app-id",
    LARK_APP_SECRET: "app-secret",
    BASE_APP_TOKEN: "base-token-secret",
    HIRELOOP_ALLOW_LARK_WRITE: "1",
  });
}

function baseOptions() {
  return {
    resolvedRecords: SAMPLE_RESOLVED,
    config: loadConfig({}),
    execute: false,
    decision: "offer" as const,
    decidedBy: "test_hm",
    decisionNote: "Test decision note.",
  };
}

describe("assertLiveMvpWriteCommands", () => {
  it("rejects non-upsert write commands", () => {
    const cmd: BaseCommandSpec = {
      description: "Create table",
      command: "lark-cli",
      args: ["base", "+table-create", "--base-token", "<BASE_APP_TOKEN>"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };

    assert.throws(
      () => assertLiveMvpWriteCommands([cmd]),
      (err: unknown) => err instanceof LiveMvpWriteBlockedError,
    );
  });

  it("rejects commands with hardcoded tokens", () => {
    const cmd: BaseCommandSpec = {
      description: "Hardcoded upsert",
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "base-token-secret"],
      redactedArgs: [],
      needsBaseToken: false,
      writesRemote: true,
    };

    assert.throws(
      () => assertLiveMvpWriteCommands([cmd]),
      (err: unknown) => err instanceof LiveMvpWriteBlockedError,
    );
  });
});

describe("runLiveMvpWrites — dry-run", () => {
  it("returns planned results without config or executor calls", async () => {
    let calls = 0;
    const executor: LiveMvpWriteExecutor = () => {
      calls++;
      throw new Error("must not execute");
    };

    const result = await runLiveMvpWrites({
      ...baseOptions(),
      executor,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.mode, "dry_run");
    assert.equal(result.executed, false);
    assert.equal(result.plan.commands.length, 24);
    assert.equal(result.results.length, 24);
    assert.equal(result.results[0]!.status, "planned");
    assert.equal(calls, 0);
  });
});

describe("runLiveMvpWrites — execution guards", () => {
  it("blocks execute when confirmation phrase is missing", async () => {
    let calls = 0;
    const result = await runLiveMvpWrites({
      ...baseOptions(),
      resolutionSource: "readonly",
      config: validConfig(),
      execute: true,
      executor: () => {
        calls++;
        throw new Error("must not execute");
      },
    });

    assert.equal(result.blocked, true);
    assert.equal(result.mode, "execute");
    assert.equal(result.executed, false);
    assert.equal(result.results.length, 24);
    assert.equal(result.results[0]!.status, "skipped");
    assert.equal(calls, 0);
    assert.match(result.blockedReasons.join("\n"), /EXECUTE_LIVE_MVP_WRITES/);
  });

  it("blocks execute when resolution source is not readonly", async () => {
    let calls = 0;
    const result = await runLiveMvpWrites({
      ...baseOptions(),
      resolutionSource: "sample",
      config: validConfig(),
      execute: true,
      confirmation: LIVE_MVP_WRITE_CONFIRMATION,
      executor: () => {
        calls++;
        throw new Error("must not execute");
      },
    });

    assert.equal(result.blocked, true);
    assert.equal(result.mode, "execute");
    assert.equal(result.executed, false);
    assert.equal(result.results[0]!.status, "skipped");
    assert.equal(calls, 0);
    assert.match(result.blockedReasons.join("\n"), /read-only resolution source/);
  });

  it("blocks execute when config is invalid", async () => {
    let calls = 0;
    const result = await runLiveMvpWrites({
      ...baseOptions(),
      resolutionSource: "readonly",
      execute: true,
      confirmation: LIVE_MVP_WRITE_CONFIRMATION,
      executor: () => {
        calls++;
        throw new Error("must not execute");
      },
    });

    assert.equal(result.blocked, true);
    assert.equal(result.mode, "execute");
    assert.equal(result.executed, false);
    assert.equal(result.results[0]!.status, "skipped");
    assert.equal(calls, 0);
    assert.match(result.blockedReasons.join("\n"), /LARK_APP_ID/);
  });
});

describe("runLiveMvpWrites — execute with injected executor", () => {
  it("executes commands sequentially and drops stdout", async () => {
    const seenArgs: string[][] = [];
    const executor: LiveMvpWriteExecutor = (
      command: string,
      args: string[],
    ): CommandResult => {
      assert.equal(command, "lark-cli");
      seenArgs.push(args);
      return {
        description: "ignored",
        status: "success",
        stdout: "raw stdout with base-token-secret",
        stderr: null,
        exitCode: 0,
        durationMs: 1,
      };
    };

    const result = await runLiveMvpWrites({
      ...baseOptions(),
      resolutionSource: "readonly",
      config: validConfig(),
      execute: true,
      confirmation: LIVE_MVP_WRITE_CONFIRMATION,
      executor,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.mode, "execute");
    assert.equal(result.executed, true);
    assert.equal(result.results.length, 24);
    assert.equal(result.results.every((r) => r.status === "success"), true);
    assert.equal(result.results.every((r) => r.stdout === null), true);
    assert.ok(seenArgs.every((args) => args.includes("base-token-secret")));
    assert.ok(!JSON.stringify(result.results).includes("base-token-secret"));
  });

  it("stops on first failed command and redacts stderr", async () => {
    const executor: LiveMvpWriteExecutor = (): CommandResult => ({
      description: "ignored",
      status: "failed",
      stdout: "raw stdout",
      stderr: "failed with base-token-secret",
      exitCode: 1,
      durationMs: 1,
    });

    const result = await runLiveMvpWrites({
      ...baseOptions(),
      resolutionSource: "readonly",
      config: validConfig(),
      execute: true,
      confirmation: LIVE_MVP_WRITE_CONFIRMATION,
      executor,
    });

    assert.equal(result.blocked, false);
    assert.equal(result.mode, "execute");
    assert.equal(result.executed, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]!.status, "failed");
    assert.ok(!result.results[0]!.stderr?.includes("base-token-secret"));
    assert.ok(result.results[0]!.stderr?.includes("<REDACTED>"));
  });
});
