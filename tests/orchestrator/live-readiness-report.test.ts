import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import type { ResolvedRecord } from "../../src/base/record-resolution.js";
import {
  buildLiveReadinessReport,
  type LiveReadinessReportInput,
} from "../../src/orchestrator/live-readiness-report.js";

function buildCommand(overrides?: Partial<BaseCommandSpec>): BaseCommandSpec {
  return {
    description: "Upsert record",
    command: "lark-cli",
    args: ["base", "+record-upsert", "--base-token", "<BASE_APP_TOKEN>"],
    redactedArgs: ["base", "+record-upsert", "--base-token", "****"],
    needsBaseToken: true,
    writesRemote: true,
    ...overrides,
  };
}

function buildResolvedRecord(
  overrides?: Partial<ResolvedRecord>,
): ResolvedRecord {
  return {
    tableName: "jobs",
    businessField: "job_id",
    businessId: "job_demo_ai_pm_001",
    recordId: "rec_demo_job_001",
    ...overrides,
  };
}

const sampleCommands24 = Array.from({ length: 24 }, (_, i) =>
  buildCommand({ description: `Command ${i + 1}` }),
);

function buildInput(
  overrides?: Partial<LiveReadinessReportInput>,
): LiveReadinessReportInput {
  return {
    resolutionMode: "sample",
    configErrors: [],
    resolutionBlocked: false,
    resolvedRecords: [
      buildResolvedRecord(),
      buildResolvedRecord({
        tableName: "candidates",
        businessField: "candidate_id",
        businessId: "cand_demo_001",
        recordId: "rec_demo_candidate_001",
      }),
    ],
    requiredRecordCount: 2,
    planCommands: sampleCommands24,
    planError: null,
    invalidWriteCommands: [],
    ...overrides,
  };
}

describe("buildLiveReadinessReport — sample mode ready", () => {
  it("returns ready with plannedWriteCount=24", () => {
    const report = buildLiveReadinessReport(buildInput());

    assert.equal(report.ready, true);
    assert.equal(report.mode, "readonly");
    assert.equal(report.resolutionMode, "sample");
    assert.equal(report.plannedWriteCount, 24);
    assert.equal(report.resolvedRecordCount, 2);
    assert.equal(report.requiredRecordCount, 2);
    assert.equal(report.safeToExecuteLiveWrites, false);
    assert.equal(report.checks.length, 5);
  });

  it("passes all checks", () => {
    const report = buildLiveReadinessReport(buildInput());

    for (const check of report.checks) {
      assert.ok(
        check.status === "pass" || check.status === "warn",
        `${check.name} should pass or warn, got ${check.status}`,
      );
    }
  });

  it("nextStep mentions sample mode", () => {
    const report = buildLiveReadinessReport(buildInput());
    assert.match(report.nextStep, /sample mode/);
  });
});

describe("buildLiveReadinessReport — config check", () => {
  it("warns on missing config in sample mode", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        configErrors: [
          { field: "LARK_APP_ID", message: "required" },
          { field: "BASE_APP_TOKEN", message: "required" },
        ],
      }),
    );

    const configCheck = report.checks.find((c) => c.name === "Config")!;
    assert.equal(configCheck.status, "warn");
    assert.match(configCheck.summary, /missing.*live execution/);
    assert.equal(report.ready, true);
  });

  it("fails on missing config in readonly mode", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        resolutionMode: "readonly",
        configErrors: [
          { field: "LARK_APP_ID", message: "required" },
        ],
      }),
    );

    const configCheck = report.checks.find((c) => c.name === "Config")!;
    assert.equal(configCheck.status, "fail");
    assert.match(configCheck.summary, /missing 1 required field/);
    assert.equal(report.ready, false);
  });

  it("passes config check when config is complete in readonly mode", () => {
    const report = buildLiveReadinessReport(
      buildInput({ resolutionMode: "readonly" }),
    );

    const configCheck = report.checks.find((c) => c.name === "Config")!;
    assert.equal(configCheck.status, "pass");
  });
});

describe("buildLiveReadinessReport — readonly blocked", () => {
  it("returns ready=false when resolution is blocked", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        resolutionMode: "readonly",
        configErrors: [
          { field: "LARK_APP_ID", message: "required" },
          { field: "LARK_APP_SECRET", message: "required" },
        ],
        resolutionBlocked: true,
        resolvedRecords: [],
        planCommands: null,
        planError: null,
      }),
    );

    assert.equal(report.ready, false);
    assert.equal(report.safeToExecuteLiveWrites, false);
    assert.equal(report.resolvedRecordCount, 0);
    assert.equal(report.plannedWriteCount, 0);
    assert.match(report.nextStep, /Not ready/);
  });

  it("fails resolution and records checks", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        resolutionMode: "readonly",
        configErrors: [
          { field: "LARK_APP_ID", message: "required" },
        ],
        resolutionBlocked: true,
        resolvedRecords: [],
        planCommands: null,
        planError: null,
      }),
    );

    const resolution = report.checks.find((c) => c.name === "Resolution")!;
    const records = report.checks.find((c) => c.name === "Records")!;
    assert.equal(resolution.status, "fail");
    assert.equal(records.status, "fail");
  });
});

describe("buildLiveReadinessReport — partial resolution", () => {
  it("returns ready=false when only 1 of 2 records resolved", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        resolvedRecords: [buildResolvedRecord()],
      }),
    );

    assert.equal(report.ready, false);
    assert.equal(report.resolvedRecordCount, 1);
    const records = report.checks.find((c) => c.name === "Records")!;
    assert.equal(records.status, "fail");
    assert.match(records.summary, /1 of 2/);
  });
});

describe("buildLiveReadinessReport — invalid record id", () => {
  it("returns ready=false when record ID is not rec_xxx format", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        resolvedRecords: [
          buildResolvedRecord(),
          buildResolvedRecord({
            tableName: "candidates",
            businessField: "candidate_id",
            businessId: "cand_demo_001",
            recordId: "invalid_id",
          }),
        ],
      }),
    );

    assert.equal(report.ready, false);
    const records = report.checks.find((c) => c.name === "Records")!;
    assert.equal(records.status, "fail");
    assert.match(records.summary, /invalid record IDs/);
  });
});

describe("buildLiveReadinessReport — plan generation failure", () => {
  it("returns ready=false with plan error", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        planCommands: null,
        planError: "pipeline stopped at screened",
      }),
    );

    assert.equal(report.ready, false);
    assert.equal(report.plannedWriteCount, 0);
    const plan = report.checks.find((c) => c.name === "Write Plan")!;
    assert.equal(plan.status, "fail");
    assert.match(plan.summary, /Plan generation failed/);
  });

  it("returns ready=false when plan generates 0 commands", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        planCommands: [],
        planError: null,
      }),
    );

    const plan = report.checks.find((c) => c.name === "Write Plan")!;
    assert.equal(plan.status, "fail");
    assert.match(plan.summary, /0 commands/);
  });

  it("returns ready=false when plan command count is not the MVP expected count", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        planCommands: sampleCommands24.slice(0, 23),
        planError: null,
      }),
    );

    assert.equal(report.ready, false);
    assert.equal(report.plannedWriteCount, 23);
    const plan = report.checks.find((c) => c.name === "Write Plan")!;
    assert.equal(plan.status, "fail");
    assert.match(plan.summary, /expected 24/);
  });
});

describe("buildLiveReadinessReport — safeToExecuteLiveWrites", () => {
  it("is true when readonly mode and all checks pass", () => {
    const report = buildLiveReadinessReport(
      buildInput({ resolutionMode: "readonly" }),
    );

    assert.equal(report.ready, true);
    assert.equal(report.safeToExecuteLiveWrites, true);
    assert.match(report.nextStep, /guarded live write runner/);
  });

  it("is false when sample mode even if all checks pass", () => {
    const report = buildLiveReadinessReport(buildInput());

    assert.equal(report.ready, true);
    assert.equal(report.safeToExecuteLiveWrites, false);
  });
});

describe("buildLiveReadinessReport — security", () => {
  it("checks do not contain token, stdout, or payload", () => {
    const report = buildLiveReadinessReport(
      buildInput({
        configErrors: [
          { field: "BASE_APP_TOKEN", message: "token stdout payload secret" },
        ],
        invalidWriteCommands: ["token stdout payload secret"],
        planError: "token stdout payload secret error",
      }),
    );

    for (const check of report.checks) {
      assert.doesNotMatch(check.summary, /token/i, `${check.name}: no token`);
      assert.doesNotMatch(check.summary, /stdout/i, `${check.name}: no stdout`);
      assert.doesNotMatch(check.summary, /payload/i, `${check.name}: no payload`);
    }
  });

  it("nextStep does not contain token, stdout, or payload", () => {
    const report = buildLiveReadinessReport(buildInput());

    assert.doesNotMatch(report.nextStep, /token/i);
    assert.doesNotMatch(report.nextStep, /stdout/i);
    assert.doesNotMatch(report.nextStep, /payload/i);
  });
});
