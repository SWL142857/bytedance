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
    ["--import", "tsx", "scripts/demo-pre-api-freeze-report.ts", ...args],
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
  "rec_demo_candidate_001",
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

describe("pre-api freeze report script - default", () => {
  it("outputs report structure", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Pre-API Freeze Report ===/);
    assert.match(result.stdout, /Status:/);
    assert.match(result.stdout, /API Integration Allowed:/);
    assert.match(result.stdout, /External Model Call Allowed: false/);
    assert.match(result.stdout, /Real Base Write Allowed: false/);
    assert.match(result.stdout, /--- Checks ---/);
    assert.match(result.stdout, /--- Allowed Next Changes ---/);
    assert.match(result.stdout, /--- Blocked Changes ---/);
    assert.match(result.stdout, /Final Note:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("pre-api freeze report script - sample-frozen", () => {
  it("outputs frozen with apiIntegrationAllowed true", () => {
    const result = runScript(["--sample-frozen"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: frozen/);
    assert.match(result.stdout, /API Integration Allowed: true/);
  });

  it("all checks are locked", () => {
    const result = runScript(["--sample-frozen"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[LOCKED\] Agent Output Schemas:/);
    assert.match(result.stdout, /\[LOCKED\] State Machine:/);
    assert.match(result.stdout, /\[LOCKED\] Base Write Guards:/);
    assert.match(result.stdout, /\[LOCKED\] Redaction Policy:/);
    assert.match(result.stdout, /\[LOCKED\] Deterministic Demo:/);
    assert.match(result.stdout, /\[LOCKED\] Release Gate:/);
    assert.match(result.stdout, /\[LOCKED\] LLM Adapter Boundary:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-frozen"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("pre-api freeze report script - sample-needs-review", () => {
  it("outputs needs_review", () => {
    const result = runScript(["--sample-needs-review"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: needs_review/);
    assert.match(result.stdout, /API Integration Allowed: false/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-needs-review"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("pre-api freeze report script - sample-blocked", () => {
  it("outputs blocked", () => {
    const result = runScript(["--sample-blocked"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: blocked/);
    assert.match(result.stdout, /API Integration Allowed: false/);
  });

  it("shows blocked check", () => {
    const result = runScript(["--sample-blocked"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[BLOCK\] Agent Output Schemas:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
