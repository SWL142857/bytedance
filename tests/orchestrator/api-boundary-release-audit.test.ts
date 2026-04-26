import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildApiBoundaryReleaseAuditReport,
  type ApiBoundaryAuditInput,
} from "../../src/orchestrator/api-boundary-release-audit.js";

const ALL_PASS: ApiBoundaryAuditInput = {
  typecheckPassed: true,
  testsPassed: true,
  buildPassed: true,
  deterministicDemoPassed: true,
  providerSmokeGuarded: true,
  providerAgentDemoGuarded: true,
  baseWriteGuardIndependent: true,
  outputRedactionSafe: true,
  forbiddenTraceScanPassed: true,
  secretScanPassed: true,
  releaseGateConsistent: true,
};

describe("API boundary release audit — all pass => ready", () => {
  it("returns status ready when all checks pass", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    assert.equal(report.status, "ready");
  });

  it("all checks are pass", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    for (const check of report.checks) {
      assert.equal(check.status, "pass", `${check.name} should be pass`);
    }
  });

  it("hard safety flags are always false", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    assert.equal(report.defaultExternalModelCallsPermittedByReport, false);
    assert.equal(report.realBaseWritesPermittedByReport, false);
  });
});

describe("API boundary release audit — core failure => blocked", () => {
  it("typecheck failed => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, typecheckPassed: false });
    assert.equal(report.status, "blocked");
  });

  it("tests failed => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, testsPassed: false });
    assert.equal(report.status, "blocked");
  });

  it("build failed => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, buildPassed: false });
    assert.equal(report.status, "blocked");
  });

  it("deterministic demo failed => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, deterministicDemoPassed: false });
    assert.equal(report.status, "blocked");
  });
});

describe("API boundary release audit — guard failure => blocked", () => {
  it("provider smoke not guarded => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, providerSmokeGuarded: false });
    assert.equal(report.status, "blocked");
    assert.equal(report.providerSmokeGuarded, false);
  });

  it("provider agent demo not guarded => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, providerAgentDemoGuarded: false });
    assert.equal(report.status, "blocked");
    assert.equal(report.providerAgentDemoGuarded, false);
  });

  it("base write guard not independent => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, baseWriteGuardIndependent: false });
    assert.equal(report.status, "blocked");
    assert.equal(report.baseWriteGuardIndependent, false);
  });
});

describe("API boundary release audit — safety failure => blocked", () => {
  it("output redaction not safe => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, outputRedactionSafe: false });
    assert.equal(report.status, "blocked");
  });

  it("forbidden trace scan not passed => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, forbiddenTraceScanPassed: false });
    assert.equal(report.status, "blocked");
  });

  it("secret scan not passed => blocked", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, secretScanPassed: false });
    assert.equal(report.status, "blocked");
  });
});

describe("API boundary release audit — consistency failure => needs_review", () => {
  it("release gate inconsistent => needs_review", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, releaseGateConsistent: false });
    assert.equal(report.status, "needs_review");
  });

  it("release gate check shows warn", () => {
    const report = buildApiBoundaryReleaseAuditReport({ ...ALL_PASS, releaseGateConsistent: false });
    const check = report.checks.find((c) => c.name === "Release Gate Consistency");
    assert.ok(check);
    assert.equal(check!.status, "warn");
  });
});

describe("API boundary release audit — recommendedCommands safety", () => {
  it("does not contain execute commands", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    for (const cmd of report.recommendedCommands) {
      assert.ok(!cmd.includes(":execute"), `Must not recommend execute: ${cmd}`);
    }
  });

  it("contains expected safe commands", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    const cmds = report.recommendedCommands;
    assert.ok(cmds.includes("pnpm typecheck"));
    assert.ok(cmds.includes("pnpm test"));
    assert.ok(cmds.includes("pnpm build"));
    assert.ok(cmds.includes("pnpm mvp:demo"));
    assert.ok(cmds.includes("pnpm mvp:api-boundary-audit"));
  });
});

describe("API boundary release audit — output safety", () => {
  const UNSAFE_PATTERNS = [
    "token",
    "stdout",
    "payload",
    "raw stderr",
    "authorization",
    "Bearer",
    "MODEL_API_KEY",
    "MODEL_ID",
    "MODEL_API_ENDPOINT",
  ];

  it("check summaries do not contain unsafe patterns", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    for (const check of report.checks) {
      for (const pattern of UNSAFE_PATTERNS) {
        assert.ok(
          !check.summary.toLowerCase().includes(pattern.toLowerCase()),
          `Check "${check.name}" summary contains unsafe pattern: ${pattern}`,
        );
      }
    }
  });

  it("finalNote does not contain unsafe patterns", () => {
    const report = buildApiBoundaryReleaseAuditReport(ALL_PASS);
    for (const pattern of UNSAFE_PATTERNS) {
      assert.ok(
        !report.finalNote.toLowerCase().includes(pattern.toLowerCase()),
        `finalNote contains unsafe pattern: ${pattern}`,
      );
    }
  });

  it("hard safety flags remain false even with all failures", () => {
    const allFail: ApiBoundaryAuditInput = {
      typecheckPassed: false,
      testsPassed: false,
      buildPassed: false,
      deterministicDemoPassed: false,
      providerSmokeGuarded: false,
      providerAgentDemoGuarded: false,
      baseWriteGuardIndependent: false,
      outputRedactionSafe: false,
      forbiddenTraceScanPassed: false,
      secretScanPassed: false,
      releaseGateConsistent: false,
    };
    const report = buildApiBoundaryReleaseAuditReport(allFail);
    assert.equal(report.defaultExternalModelCallsPermittedByReport, false);
    assert.equal(report.realBaseWritesPermittedByReport, false);
    assert.equal(report.status, "blocked");
  });
});
