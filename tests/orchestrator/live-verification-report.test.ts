import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveVerificationReport,
  type LiveVerificationReportInput,
} from "../../src/orchestrator/live-verification-report.js";

function buildInput(
  overrides: Partial<LiveVerificationReportInput> = {},
): LiveVerificationReportInput {
  return {
    mode: "sample",
    expectedWriteCount: 20,
    agentRunsVerified: null,
    candidateStatusVerified: null,
    reportsVerified: null,
    ...overrides,
  };
}

describe("buildLiveVerificationReport - sample mode", () => {
  it("returns needs_review with manualReviewRequired=true", () => {
    const report = buildLiveVerificationReport(buildInput());

    assert.equal(report.mode, "sample");
    assert.equal(report.status, "needs_review");
    assert.equal(report.manualReviewRequired, true);
    assert.equal(report.verifiedCheckCount, 0);
  });

  it("all checks are not_checked", () => {
    const report = buildLiveVerificationReport(buildInput());

    for (const check of report.checks) {
      assert.equal(check.status, "not_checked", `${check.name} should be not_checked`);
    }
  });

  it("includes Agent Runs, Candidates, and Reports checks", () => {
    const report = buildLiveVerificationReport(buildInput());
    const names = report.checks.map((c) => c.name);

    assert.ok(names.includes("Agent Runs"));
    assert.ok(names.includes("Candidates"));
    assert.ok(names.includes("Reports"));
  });

  it("nextStep mentions sample", () => {
    const report = buildLiveVerificationReport(buildInput());
    assert.match(report.nextStep, /Sample/);
  });
});

describe("buildLiveVerificationReport - readonly blocked", () => {
  it("returns failed status", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        verificationBlocked: true,
        agentRunsVerified: null,
        candidateStatusVerified: null,
        reportsVerified: null,
      }),
    );

    assert.equal(report.mode, "readonly");
    assert.equal(report.status, "failed");
    assert.equal(report.manualReviewRequired, true);
    assert.equal(report.verifiedCheckCount, 0);
  });

  it("all checks fail", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        verificationBlocked: true,
      }),
    );

    for (const check of report.checks) {
      assert.equal(check.status, "fail", `${check.name} should be fail`);
    }
  });

  it("nextStep mentions fixing readonly config", () => {
    const report = buildLiveVerificationReport(
      buildInput({ mode: "readonly", verificationBlocked: true }),
    );

    assert.match(report.nextStep, /blocked/);
    assert.match(report.nextStep, /readonly|config|Base/);
  });
});

describe("buildLiveVerificationReport - readonly all pass", () => {
  it("returns passed status", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: true,
        resumeFactsVerified: true,
        evaluationsVerified: true,
        interviewKitsVerified: true,
      }),
    );

    assert.equal(report.status, "passed");
    assert.equal(report.verifiedCheckCount, 6);
  });

  it("all checks are pass", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: true,
        resumeFactsVerified: true,
        evaluationsVerified: true,
        interviewKitsVerified: true,
      }),
    );

    for (const check of report.checks) {
      assert.equal(check.status, "pass", `${check.name} should be pass`);
    }
  });

  it("nextStep mentions spot-check", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: true,
        resumeFactsVerified: true,
        evaluationsVerified: true,
        interviewKitsVerified: true,
      }),
    );

    assert.match(report.nextStep, /passed|Spot-check/i);
  });
});

describe("buildLiveVerificationReport - readonly one false", () => {
  it("returns failed status", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: false,
        reportsVerified: true,
      }),
    );

    assert.equal(report.status, "failed");
    assert.equal(report.manualReviewRequired, true);
  });

  it("failed check has correct summary", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: false,
        reportsVerified: true,
      }),
    );

    const candidates = report.checks.find((c) => c.name === "Candidates")!;
    assert.equal(candidates.status, "fail");
    assert.match(candidates.summary, /failed|missing|incomplete/);
  });

  it("nextStep mentions checking failed tables", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: false,
        candidateStatusVerified: true,
        reportsVerified: true,
      }),
    );

    assert.match(report.nextStep, /missing|incomplete|failed/i);
  });
});

describe("buildLiveVerificationReport - readonly null check", () => {
  it("returns needs_review status", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: null,
      }),
    );

    assert.equal(report.status, "needs_review");
    assert.equal(report.manualReviewRequired, true);
  });

  it("null check is warn", () => {
    const report = buildLiveVerificationReport(
      buildInput({
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: null,
      }),
    );

    const reports = report.checks.find((c) => c.name === "Reports")!;
    assert.equal(reports.status, "warn");
    assert.match(reports.summary, /not checked|manual/i);
  });
});

describe("buildLiveVerificationReport - security", () => {
  it("summary and nextStep do not contain token, stdout, payload, raw stderr", () => {
    const scenarios: Partial<LiveVerificationReportInput>[] = [
      { mode: "sample" },
      { mode: "readonly", verificationBlocked: true },
      {
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: true,
      },
      {
        mode: "readonly",
        agentRunsVerified: false,
        candidateStatusVerified: true,
        reportsVerified: true,
      },
      {
        mode: "readonly",
        agentRunsVerified: true,
        candidateStatusVerified: true,
        reportsVerified: null,
      },
    ];

    for (const overrides of scenarios) {
      const report = buildLiveVerificationReport(buildInput(overrides));
      const allText = [
        report.nextStep,
        ...report.checks.map((c) => c.summary),
      ].join(" ");

      assert.doesNotMatch(allText, /token/i, `no token in ${overrides.mode}`);
      assert.doesNotMatch(allText, /stdout/i, `no stdout in ${overrides.mode}`);
      assert.doesNotMatch(allText, /payload/i, `no payload in ${overrides.mode}`);
      assert.doesNotMatch(
        allText,
        /raw stderr/i,
        `no raw stderr in ${overrides.mode}`,
      );
    }
  });
});
