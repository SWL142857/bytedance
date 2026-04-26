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
    ["--import", "tsx", "scripts/demo-mvp-release-gate.ts", ...args],
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
  "mvp:live-write:execute",
] as const;

function assertNoSensitiveData(output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `Must not leak: ${pattern}`);
  }
}

describe("mvp release gate script - default", () => {
  it("outputs release gate structure", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== MVP Release Gate ===/);
    assert.match(result.stdout, /Status:/);
    assert.match(result.stdout, /Local Demo Ready:/);
    assert.match(result.stdout, /Live Safety Ready:/);
    assert.match(result.stdout, /Real Write Permitted: false/);
    assert.match(result.stdout, /External Model Call Permitted: false/);
    assert.match(result.stdout, /Checks ---/);
    assert.match(result.stdout, /Recommended Demo Commands ---/);
    assert.match(result.stdout, /Final Handoff Note:/);
  });

  it("outputs recommended demo commands", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /pnpm typecheck/);
    assert.match(result.stdout, /pnpm test/);
    assert.match(result.stdout, /pnpm mvp:demo/);
    assert.match(result.stdout, /pnpm mvp:live-ready/);
    assert.match(result.stdout, /pnpm mvp:live-runbook/);
    assert.match(result.stdout, /pnpm mvp:live-write:dry-run/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("mvp release gate script - sample-ready", () => {
  it("outputs ready_for_demo", () => {
    const result = runScript(["--sample-ready"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: ready_for_demo/);
    assert.match(result.stdout, /Local Demo Ready: true/);
    assert.match(result.stdout, /Live Safety Ready: true/);
  });

  it("all checks pass", () => {
    const result = runScript(["--sample-ready"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[PASS\] Typecheck:/);
    assert.match(result.stdout, /\[PASS\] Test Suite:/);
    assert.match(result.stdout, /\[PASS\] Local MVP Demo:/);
    assert.match(result.stdout, /\[PASS\] Forbidden Trace Scan:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("mvp release gate script - sample-needs-review", () => {
  it("outputs needs_review", () => {
    const result = runScript(["--sample-needs-review"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: needs_review/);
    assert.match(result.stdout, /Live Safety Ready: false/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-needs-review"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("mvp release gate script - sample-blocked", () => {
  it("outputs blocked", () => {
    const result = runScript(["--sample-blocked"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: blocked/);
    assert.match(result.stdout, /Local Demo Ready: false/);
  });

  it("shows blocked checks", () => {
    const result = runScript(["--sample-blocked"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[BLOCK\] Typecheck:/);
    assert.match(result.stdout, /\[BLOCK\] Test Suite:/);
    assert.match(result.stdout, /\[BLOCK\] Local MVP Demo:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
