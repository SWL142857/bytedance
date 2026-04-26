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
    ["--import", "tsx", "scripts/demo-live-ready-mvp.ts", ...args],
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

describe("live-ready MVP script - output structure", () => {
  it("outputs all stages and summary", () => {
    const result = runScript();
    assert.equal(result.status, 0);

    assert.match(result.stdout, /=== Stage 0: Record Resolution ===/);
    assert.match(result.stdout, /Resolution commands:/);
    assert.match(result.stdout, /job record: resolved/);
    assert.match(result.stdout, /candidate record: resolved/);

    assert.match(result.stdout, /=== Stage 1: Candidate Pipeline ===/);
    assert.match(result.stdout, /Final status:/);
    assert.match(result.stdout, /Pipeline commands:/);

    assert.match(result.stdout, /=== Stage 2: Human Decision ===/);
    assert.match(result.stdout, /Decision commands:/);

    assert.match(result.stdout, /=== Stage 3: Analytics Report ===/);
    assert.match(result.stdout, /Report commands:/);

    assert.match(result.stdout, /=== Live-Ready MVP Summary ===/);
    assert.match(result.stdout, /Total commands:/);
    assert.match(result.stdout, /records resolved/);
  });
});

describe("live-ready MVP script - output safety", () => {
  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });

  it("does not print record IDs", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes("rec_demo_"), "Must not print rec_demo_* IDs");
    assert.ok(!result.stdout.includes("rec_"), "Must not print any rec_ IDs");
  });
});
