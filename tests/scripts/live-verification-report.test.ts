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
    ["--import", "tsx", "scripts/demo-live-verification-report.ts", ...args],
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

describe("live verification report script - default sample", () => {
  it("outputs sample report with needs_review status", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Live Verification Report Demo ===/);
    assert.match(result.stdout, /Mode: sample/);
    assert.match(result.stdout, /Status: needs_review/);
    assert.match(result.stdout, /Expected Write Count: 20/);
    assert.match(result.stdout, /Manual Review Required: true/);
    assert.match(result.stdout, /\[NOT_CHECKED\] Agent Runs:/);
    assert.match(result.stdout, /\[NOT_CHECKED\] Candidates:/);
    assert.match(result.stdout, /\[NOT_CHECKED\] Reports:/);
    assert.match(result.stdout, /Next Step:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live verification report script - sample passed", () => {
  it("outputs passed scenario", () => {
    const result = runScript(["--sample-passed"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Readonly All Passed/);
    assert.match(result.stdout, /Mode: readonly/);
    assert.match(result.stdout, /Status: passed/);
    assert.match(result.stdout, /\[PASS\] Agent Runs:/);
    assert.match(result.stdout, /\[PASS\] Candidates:/);
    assert.match(result.stdout, /\[PASS\] Reports:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-passed"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live verification report script - sample failed", () => {
  it("outputs failed scenario", () => {
    const result = runScript(["--sample-failed"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Readonly Partial Failure/);
    assert.match(result.stdout, /Mode: readonly/);
    assert.match(result.stdout, /Status: failed/);
    assert.match(result.stdout, /\[FAIL\] Candidates:/);
    assert.match(result.stdout, /\[WARN\] Reports:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-failed"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
