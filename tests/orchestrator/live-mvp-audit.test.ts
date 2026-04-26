import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import type { CommandResult } from "../../src/base/lark-cli-runner.js";
import { buildLiveMvpExecutionAudit } from "../../src/orchestrator/live-mvp-audit.js";
import type { LiveMvpWriteRunResult } from "../../src/orchestrator/live-mvp-runner.js";

interface ResultOptions {
  totalCommands?: number;
  statuses: CommandResult["status"][];
  blocked?: boolean;
  executed?: boolean;
  mode?: LiveMvpWriteRunResult["mode"];
  blockedReasons?: string[];
}

function buildCommand(index: number): BaseCommandSpec {
  return {
    description: `Command ${index}`,
    command: "lark-cli",
    args: [],
    redactedArgs: [],
    needsBaseToken: true,
    writesRemote: true,
  };
}

function buildResult(options: ResultOptions): LiveMvpWriteRunResult {
  const totalCommands = options.totalCommands ?? options.statuses.length;
  const commands = Array.from({ length: totalCommands }, (_, idx) =>
    buildCommand(idx + 1),
  );

  return {
    mode: options.mode ?? (options.executed ? "execute" : "dry_run"),
    plan: {
      commands,
      pipeline: {} as LiveMvpWriteRunResult["plan"]["pipeline"],
      finalDecisionStatus: "offer",
      reportRunStatus: "success",
    },
    results: options.statuses.map((status, idx) => ({
      description: `Command ${idx + 1}`,
      status,
      stdout: null,
      stderr: null,
      exitCode: status === "success" ? 0 : null,
      durationMs: 0,
    })),
    blocked: options.blocked ?? false,
    executed: options.executed ?? false,
    blockedReasons: options.blockedReasons ?? [],
  };
}

describe("buildLiveMvpExecutionAudit", () => {
  it("summarizes dry-run planned commands without execution", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: Array<CommandResult["status"]>(20).fill("planned"),
      }),
    );

    assert.equal(audit.mode, "dry_run");
    assert.equal(audit.blocked, false);
    assert.equal(audit.executed, false);
    assert.equal(audit.totalCommands, 20);
    assert.equal(audit.plannedCount, 20);
    assert.equal(audit.skippedCount, 0);
    assert.equal(audit.successCount, 0);
    assert.equal(audit.failedCount, 0);
    assert.equal(audit.stoppedAtCommandIndex, null);
    assert.match(audit.recoveryNote, /No writes were executed/);
  });

  it("summarizes blocked results and points to blockedReasons", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: Array<CommandResult["status"]>(20).fill("skipped"),
        blocked: true,
        blockedReasons: ["LARK_APP_ID is required", "BASE_APP_TOKEN is required"],
      }),
    );

    assert.equal(audit.mode, "dry_run");
    assert.equal(audit.blocked, true);
    assert.equal(audit.executed, false);
    assert.equal(audit.skippedCount, 20);
    assert.match(audit.recoveryNote, /No writes were executed/);
    assert.match(audit.recoveryNote, /blockedReasons/);
  });

  it("preserves execute mode for blocked execute results", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: Array<CommandResult["status"]>(20).fill("skipped"),
        blocked: true,
        mode: "execute",
        blockedReasons: ["Missing confirmation phrase"],
      }),
    );

    assert.equal(audit.mode, "execute");
    assert.equal(audit.blocked, true);
    assert.equal(audit.executed, false);
    assert.match(audit.recoveryNote, /blockedReasons/);
  });

  it("summarizes fully successful execution", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: Array<CommandResult["status"]>(20).fill("success"),
        executed: true,
      }),
    );

    assert.equal(audit.mode, "execute");
    assert.equal(audit.executed, true);
    assert.equal(audit.successCount, 20);
    assert.equal(audit.failedCount, 0);
    assert.equal(audit.stoppedAtCommandIndex, null);
    assert.equal(audit.stoppedAtDescription, null);
    assert.match(audit.recoveryNote, /All writes completed successfully/);
    assert.match(audit.recoveryNote, /Agent Runs, Candidates, and Reports/);
  });

  it("does not report full success when results stop after partial successes", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: ["success", "success"],
        executed: true,
      }),
    );

    assert.equal(audit.successCount, 2);
    assert.equal(audit.failedCount, 0);
    assert.equal(audit.skippedCount, 0);
    assert.doesNotMatch(audit.recoveryNote, /All writes completed successfully/);
    assert.match(audit.recoveryNote, /Incomplete execution/);
  });

  it("marks first command failure as the stop point", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: ["failed"],
        executed: true,
      }),
    );

    assert.equal(audit.failedCount, 1);
    assert.equal(audit.stoppedAtCommandIndex, 1);
    assert.equal(audit.stoppedAtDescription, "Command 1");
    assert.match(audit.recoveryNote, /command 1/);
    assert.match(audit.recoveryNote, /Do NOT re-run the full pipeline/);
  });

  it("marks middle command failure as the stop point", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: ["success", "success", "success", "failed"],
        executed: true,
      }),
    );

    assert.equal(audit.successCount, 3);
    assert.equal(audit.failedCount, 1);
    assert.equal(audit.stoppedAtCommandIndex, 4);
    assert.equal(audit.stoppedAtDescription, "Command 4");
  });

  it("counts skipped execution results", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        totalCommands: 20,
        statuses: ["success", "success", "skipped"],
        executed: true,
      }),
    );

    assert.equal(audit.successCount, 2);
    assert.equal(audit.skippedCount, 1);
    assert.equal(audit.failedCount, 0);
    assert.equal(audit.stoppedAtCommandIndex, null);
    assert.match(audit.recoveryNote, /skipped/);
    assert.match(audit.recoveryNote, /Check skipped reasons/);
  });

  it("does not include token, stdout, or payload text in recoveryNote", () => {
    const audit = buildLiveMvpExecutionAudit(
      buildResult({
        statuses: ["skipped"],
        blocked: true,
        blockedReasons: ["token stdout payload secret should stay out"],
      }),
    );

    assert.doesNotMatch(audit.recoveryNote, /token/i);
    assert.doesNotMatch(audit.recoveryNote, /stdout/i);
    assert.doesNotMatch(audit.recoveryNote, /payload/i);
  });
});
