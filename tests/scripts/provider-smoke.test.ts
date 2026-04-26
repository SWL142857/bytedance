import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runScript(args: string[] = []) {
  const env = { ...process.env };
  delete env.LARK_APP_ID;
  delete env.LARK_APP_SECRET;
  delete env.BASE_APP_TOKEN;
  delete env.HIRELOOP_ALLOW_LARK_WRITE;
  delete env.MODEL_API_ENDPOINT;
  delete env.MODEL_ID;
  delete env.MODEL_API_KEY;

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-provider-smoke.ts", ...args],
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
  "authorization",
  "Bearer",
  "MODEL_API_ENDPOINT",
  "MODEL_ID",
  "MODEL_API_KEY",
] as const;

function assertNoSensitiveData(output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `Must not leak: ${pattern}`);
  }
}

describe("provider smoke script - dry-run", () => {
  it("outputs smoke structure", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Provider Connectivity Smoke ===/);
    assert.match(result.stdout, /Mode: dry_run/);
    assert.match(result.stdout, /Status: planned/);
    assert.match(result.stdout, /Provider:/);
    assert.match(result.stdout, /Can Call External Model:/);
    assert.match(result.stdout, /HTTP Status:/);
    assert.match(result.stdout, /Has Choices:/);
    assert.match(result.stdout, /Content Length:/);
    assert.match(result.stdout, /Duration Ms:/);
    assert.match(result.stdout, /Safe Summary:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("provider smoke script - execute without env", () => {
  it("returns blocked when env is missing", () => {
    const result = runScript([
      "--execute",
      "--confirm=EXECUTE_PROVIDER_SMOKE",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Mode: execute/);
    assert.match(result.stdout, /Status: blocked/);
    assert.ok(result.stdout.includes("Blocked Reasons:") && !result.stdout.includes("Blocked Reasons: 0"));
  });

  it("does not leak sensitive data when blocked", () => {
    const result = runScript([
      "--execute",
      "--confirm=EXECUTE_PROVIDER_SMOKE",
    ]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("provider smoke script - execute without confirm", () => {
  it("returns blocked when confirm is missing", () => {
    const result = runScript(["--execute"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: blocked/);
  });
});
