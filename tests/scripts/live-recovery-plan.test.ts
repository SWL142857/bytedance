import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runScript() {
  const env = { ...process.env };
  delete env.LARK_APP_ID;
  delete env.LARK_APP_SECRET;
  delete env.BASE_APP_TOKEN;
  delete env.HIRELOOP_ALLOW_LARK_WRITE;

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/demo-live-recovery-plan.ts"],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf-8",
    },
  );
}

const SENSITIVE_PATTERNS = [
  "--json",
  "--base-token",
  "rec_demo_job_001",
  "AI Product Manager with 6 years",
  "raw stdout",
  "payload",
  "token",
] as const;

function assertNoSensitiveData(output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `Must not leak: ${pattern}`);
  }
}

describe("live recovery plan script", () => {
  it("outputs all four scenarios", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Live Recovery Plan Demo ===/);
    assert.match(result.stdout, /Scenario: Dry-Run/);
    assert.match(result.stdout, /Scenario: Blocked Execute/);
    assert.match(result.stdout, /Scenario: Failed at Command 4/);
    assert.match(result.stdout, /Scenario: All Success/);
  });

  it("dry-run scenario shows dry_run_only and none risk", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /dry_run_only/);
    assert.match(result.stdout, /Risk Level: none/);
  });

  it("failed scenario shows failed_during_write and high risk", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /failed_during_write/);
    assert.match(result.stdout, /Risk Level: high/);
  });

  it("success scenario shows completed_successfully and low risk", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /completed_successfully/);
    assert.match(result.stdout, /Risk Level: low/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
