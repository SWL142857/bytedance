import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPreApiFreezeReport,
  type PreApiFreezeInput,
} from "../../src/orchestrator/pre-api-freeze-report.js";

function buildInput(
  overrides: Partial<PreApiFreezeInput> = {},
): PreApiFreezeInput {
  return {
    schemasLocked: true,
    stateMachineLocked: true,
    baseWriteGuardsLocked: true,
    redactionPolicyLocked: true,
    deterministicDemoPassing: true,
    releaseGatePassing: true,
    llmAdapterBoundaryDefined: true,
    ...overrides,
  };
}

describe("buildPreApiFreezeReport - all pass", () => {
  it("returns frozen", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.equal(report.status, "frozen");
    assert.equal(report.apiIntegrationAllowed, true);
  });

  it("all checks are locked", () => {
    const report = buildPreApiFreezeReport(buildInput());
    for (const check of report.checks) {
      assert.equal(check.status, "locked", `${check.name} should be locked`);
    }
  });

  it("has 7 checks", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.equal(report.checks.length, 7);
  });
});

describe("buildPreApiFreezeReport - core unlocked to blocked", () => {
  it("schemas unlocked returns blocked", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ schemasLocked: false }),
    );
    assert.equal(report.status, "blocked");
    assert.equal(report.apiIntegrationAllowed, false);
  });

  it("state machine unlocked returns blocked", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ stateMachineLocked: false }),
    );
    assert.equal(report.status, "blocked");
  });

  it("base write guards unlocked returns blocked", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ baseWriteGuardsLocked: false }),
    );
    assert.equal(report.status, "blocked");
  });

  it("redaction policy unlocked returns blocked", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ redactionPolicyLocked: false }),
    );
    assert.equal(report.status, "blocked");
  });
});

describe("buildPreApiFreezeReport - operational missing to needs_review", () => {
  it("deterministic demo missing returns needs_review", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ deterministicDemoPassing: false }),
    );
    assert.equal(report.status, "needs_review");
    assert.equal(report.apiIntegrationAllowed, false);
  });

  it("release gate missing returns needs_review", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ releaseGatePassing: false }),
    );
    assert.equal(report.status, "needs_review");
  });

  it("llm adapter boundary missing returns needs_review", () => {
    const report = buildPreApiFreezeReport(
      buildInput({ llmAdapterBoundaryDefined: false }),
    );
    assert.equal(report.status, "needs_review");
  });
});

describe("buildPreApiFreezeReport - safety flags always false", () => {
  it("externalModelCallAllowedByReport is always false", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.equal(report.externalModelCallAllowedByReport, false);
  });

  it("realBaseWriteAllowedByReport is always false", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.equal(report.realBaseWriteAllowedByReport, false);
  });

  it("safety flags false even when frozen", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.equal(report.apiIntegrationAllowed, true);
    assert.equal(report.externalModelCallAllowedByReport, false);
    assert.equal(report.realBaseWriteAllowedByReport, false);
  });
});

describe("buildPreApiFreezeReport - blockedChanges", () => {
  it("allowedNextChanges contains only adapter/config/error/retry work", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.deepEqual(report.allowedNextChanges, [
      "add disabled-by-default provider adapter",
      "add provider config validation",
      "add provider error mapping",
      "add schema retry wiring behind existing output contracts",
    ]);
  });

  it("includes schema validation bypass", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.ok(
      report.blockedChanges.some((c) => c.includes("schema validation")),
      "Must block schema validation bypass",
    );
  });

  it("includes enabling external model calls by default", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.ok(
      report.blockedChanges.some((c) => c.includes("external model calls")),
      "Must block enabling external model calls by default",
    );
  });

  it("blocks raw prompt, resume, and credential output", () => {
    const report = buildPreApiFreezeReport(buildInput());
    const joined = report.blockedChanges.join(" ");
    assert.match(joined, /raw prompts/);
    assert.match(joined, /resumes/);
    assert.match(joined, /credentials/);
    assert.match(joined, /output/);
  });
});

describe("buildPreApiFreezeReport - security", () => {
  it("finalNote does not contain token, stdout, payload, raw stderr", () => {
    const report = buildPreApiFreezeReport(buildInput());
    assert.doesNotMatch(report.finalNote, /token/i);
    assert.doesNotMatch(report.finalNote, /stdout/i);
    assert.doesNotMatch(report.finalNote, /payload/i);
    assert.doesNotMatch(report.finalNote, /raw stderr/i);
  });

  it("check summaries do not contain token, stdout, payload, raw stderr", () => {
    const scenarios: Partial<PreApiFreezeInput>[] = [
      buildInput(),
      buildInput({ schemasLocked: false }),
      buildInput({ deterministicDemoPassing: false }),
      buildInput({ releaseGatePassing: false }),
    ];

    for (const overrides of scenarios) {
      const report = buildPreApiFreezeReport(buildInput(overrides));
      for (const check of report.checks) {
        assert.doesNotMatch(check.summary, /token/i, `${check.name}: no token`);
        assert.doesNotMatch(check.summary, /stdout/i, `${check.name}: no stdout`);
        assert.doesNotMatch(check.summary, /payload/i, `${check.name}: no payload`);
        assert.doesNotMatch(check.summary, /raw stderr/i, `${check.name}: no raw stderr`);
      }
    }
  });
});
