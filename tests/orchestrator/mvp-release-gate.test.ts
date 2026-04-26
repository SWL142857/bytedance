import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMvpReleaseGateReport,
  type MvpReleaseGateInput,
} from "../../src/orchestrator/mvp-release-gate.js";

function buildInput(
  overrides: Partial<MvpReleaseGateInput> = {},
): MvpReleaseGateInput {
  return {
    typecheckPassed: true,
    testsPassed: true,
    localMvpDemoPassed: true,
    liveReadyDemoPassed: true,
    liveRunbookAvailable: true,
    guardedExecuteBlocksWithoutConfig: true,
    apiBoundaryAuditPassed: true,
    forbiddenTraceScanPassed: true,
    ...overrides,
  };
}

describe("buildMvpReleaseGateReport - all pass", () => {
  it("returns ready_for_demo", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    assert.equal(report.status, "ready_for_demo");
    assert.equal(report.localDemoReady, true);
    assert.equal(report.liveSafetyReady, true);
  });

  it("all checks are pass", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    for (const check of report.checks) {
      assert.equal(check.status, "pass", `${check.name} should be pass`);
    }
  });
});

describe("buildMvpReleaseGateReport - typecheck failed", () => {
  it("returns blocked", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ typecheckPassed: false }),
    );
    assert.equal(report.status, "blocked");
    assert.equal(report.localDemoReady, false);
  });

  it("typecheck check is block", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ typecheckPassed: false }),
    );
    const tc = report.checks.find((c) => c.name === "Typecheck")!;
    assert.equal(tc.status, "block");
  });
});

describe("buildMvpReleaseGateReport - tests failed", () => {
  it("returns blocked", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ testsPassed: false }),
    );
    assert.equal(report.status, "blocked");
  });
});

describe("buildMvpReleaseGateReport - localMvpDemo failed", () => {
  it("returns blocked", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ localMvpDemoPassed: false }),
    );
    assert.equal(report.status, "blocked");
    assert.equal(report.localDemoReady, false);
  });
});

describe("buildMvpReleaseGateReport - live safety missing runbook", () => {
  it("returns needs_review", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ liveRunbookAvailable: false }),
    );
    assert.equal(report.status, "needs_review");
    assert.equal(report.liveSafetyReady, false);
  });

  it("runbook check is warn", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ liveRunbookAvailable: false }),
    );
    const runbook = report.checks.find((c) => c.name === "Live Operator Runbook")!;
    assert.equal(runbook.status, "warn");
  });
});

describe("buildMvpReleaseGateReport - forbidden trace scan failed", () => {
  it("returns needs_review", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ forbiddenTraceScanPassed: false }),
    );
    assert.equal(report.status, "needs_review");
    assert.equal(report.liveSafetyReady, false);
  });

  it("scan check is block", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ forbiddenTraceScanPassed: false }),
    );
    const scan = report.checks.find((c) => c.name === "Forbidden Trace Scan")!;
    assert.equal(scan.status, "block");
  });
});

describe("buildMvpReleaseGateReport - guarded execute block failed", () => {
  it("returns blocked", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ guardedExecuteBlocksWithoutConfig: false }),
    );
    assert.equal(report.status, "blocked");
    assert.equal(report.liveSafetyReady, false);
  });

  it("guarded execute check is block", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ guardedExecuteBlocksWithoutConfig: false }),
    );
    const guard = report.checks.find((c) => c.name === "Guarded Execute Block")!;
    assert.equal(guard.status, "block");
  });
});

describe("buildMvpReleaseGateReport - API boundary audit failed", () => {
  it("returns needs_review", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ apiBoundaryAuditPassed: false }),
    );
    assert.equal(report.status, "needs_review");
    assert.equal(report.liveSafetyReady, false);
  });

  it("API boundary audit check is block", () => {
    const report = buildMvpReleaseGateReport(
      buildInput({ apiBoundaryAuditPassed: false }),
    );
    const audit = report.checks.find((c) => c.name === "API Boundary Audit")!;
    assert.equal(audit.status, "block");
  });
});

describe("buildMvpReleaseGateReport - hard safety flags", () => {
  it("realWritePermittedByReport is always false", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    assert.equal(report.realWritePermittedByReport, false);
  });

  it("externalModelCallPermittedByReport is always false", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    assert.equal(report.externalModelCallPermittedByReport, false);
  });
});

describe("buildMvpReleaseGateReport - recommended commands", () => {
  it("does not include execute command", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    for (const cmd of report.recommendedDemoCommands) {
      assert.ok(!cmd.includes("execute"), `Must not include execute: ${cmd}`);
    }
  });

  it("includes typecheck, test, demo, live-ready, runbook, dry-run", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    const cmds = report.recommendedDemoCommands;
    assert.ok(cmds.includes("pnpm typecheck"));
    assert.ok(cmds.includes("pnpm test"));
    assert.ok(cmds.includes("pnpm mvp:demo"));
    assert.ok(cmds.includes("pnpm mvp:live-ready"));
    assert.ok(cmds.includes("pnpm mvp:live-runbook"));
    assert.ok(cmds.includes("pnpm mvp:live-write:dry-run"));
    assert.ok(cmds.includes("pnpm mvp:api-boundary-audit"));
  });
});

describe("buildMvpReleaseGateReport - security", () => {
  it("finalHandoffNote does not contain token, stdout, payload, raw stderr", () => {
    const report = buildMvpReleaseGateReport(buildInput());
    assert.doesNotMatch(report.finalHandoffNote, /token/i);
    assert.doesNotMatch(report.finalHandoffNote, /stdout/i);
    assert.doesNotMatch(report.finalHandoffNote, /payload/i);
    assert.doesNotMatch(report.finalHandoffNote, /raw stderr/i);
  });

  it("check summaries do not contain token, stdout, payload, raw stderr", () => {
    const scenarios: Partial<MvpReleaseGateInput>[] = [
      buildInput(),
      buildInput({ typecheckPassed: false }),
      buildInput({ forbiddenTraceScanPassed: false }),
      buildInput({ liveRunbookAvailable: false }),
    ];

    for (const overrides of scenarios) {
      const report = buildMvpReleaseGateReport(buildInput(overrides));
      for (const check of report.checks) {
        assert.doesNotMatch(check.summary, /token/i, `${check.name}: no token`);
        assert.doesNotMatch(check.summary, /stdout/i, `${check.name}: no stdout`);
        assert.doesNotMatch(check.summary, /payload/i, `${check.name}: no payload`);
        assert.doesNotMatch(check.summary, /raw stderr/i, `${check.name}: no raw stderr`);
      }
    }
  });
});
