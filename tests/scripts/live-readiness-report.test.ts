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
    ["--import", "tsx", "scripts/demo-live-readiness-report.ts", ...args],
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

describe("live readiness report script — sample mode", () => {
  it("outputs readiness report with all fields", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Live Readiness Report ===/);
    assert.match(result.stdout, /Ready: true/);
    assert.match(result.stdout, /Resolution Mode: sample/);
    assert.match(result.stdout, /Resolved Records: 2/);
    assert.match(result.stdout, /Required Records: 2/);
    assert.match(result.stdout, /Planned Write Count: 24/);
    assert.match(result.stdout, /Safe to Execute Live Writes: false/);
    assert.match(result.stdout, /--- Checks ---/);
    assert.match(result.stdout, /\[(PASS|WARN)\] Config:/);
    assert.match(result.stdout, /\[PASS\] Resolution:/);
    assert.match(result.stdout, /\[PASS\] Records:/);
    assert.match(result.stdout, /\[PASS\] Write Plan:/);
    assert.match(result.stdout, /\[PASS\] Write Commands:/);
    assert.match(result.stdout, /Next Step:/);
    assert.match(result.stdout, /sample mode/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("live readiness report script — readonly blocked", () => {
  it("outputs readiness false when config is missing", () => {
    const result = runScript(["--use-readonly-resolution"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Resolution source: read-only live resolution/);
    assert.match(result.stdout, /Ready: false/);
    assert.match(result.stdout, /Safe to Execute Live Writes: false/);
    assert.match(result.stdout, /Resolved Records: 0/);
    assert.match(result.stdout, /Planned Write Count: 0/);
    assert.match(result.stdout, /\[FAIL\] Config:/);
    assert.match(result.stdout, /\[FAIL\] Resolution:/);
    assert.match(result.stdout, /\[FAIL\] Records:/);
    assert.match(result.stdout, /\[FAIL\] Write Plan:/);
    assert.match(result.stdout, /\[FAIL\] Write Commands:/);
    assert.match(result.stdout, /Not ready/);
  });

  it("does not leak sensitive data when blocked", () => {
    const result = runScript(["--use-readonly-resolution"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
