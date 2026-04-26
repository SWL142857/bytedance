import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runScript(args: string[] = []) {
  const env = { ...process.env };
  delete env.LARK_APP_ID;
  delete env.LARK_APP_SECRET;
  delete env.BASE_APP_TOKEN;
  delete env.HIRELOOP_ALLOW_LARK_WRITE;

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/demo-live-operator-runbook.ts", ...args],
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
  "stdout",
  "raw stderr",
] as const;

function assertNoSensitiveData(output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `Must not leak: ${pattern}`);
  }
}

describe("live operator runbook script - default", () => {
  it("outputs runbook header and structure", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Live Operator Runbook ===/);
    assert.match(result.stdout, /Ready for Human Execution:/);
    assert.match(result.stdout, /Manual Approval Required: true/);
    assert.match(result.stdout, /Steps ---/);
    assert.match(result.stdout, /Final Safety Note:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live operator runbook script - sample-ready", () => {
  it("outputs readyForHumanExecution true", () => {
    const result = runScript(["--sample-ready"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Ready for Human Execution: true/);
    assert.match(result.stdout, /Live Write Allowed by Report: true/);
  });

  it("execute step is ready", () => {
    const result = runScript(["--sample-ready"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Guarded Live Execute \(READY\)/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live operator runbook script - sample-blocked", () => {
  it("outputs blocked state", () => {
    const result = runScript(["--sample-blocked"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Ready for Human Execution: false/);
    assert.match(result.stdout, /BLOCKED/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live operator runbook script - sample-after-success", () => {
  it("shows completed successfully and verification passed", () => {
    const result = runScript(["--sample-after-success"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /completed successfully/);
    assert.match(result.stdout, /passed/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-after-success"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live operator runbook script - sample-after-failure", () => {
  it("shows failed_during_write and do-not-rerun warning", () => {
    const result = runScript(["--sample-after-failure"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /failed_during_write|Do NOT re-run/);
    assert.match(result.stdout, /Do NOT blindly re-run/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-after-failure"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
