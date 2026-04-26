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
    ["--import", "tsx", "scripts/demo-provider-adapter-readiness.ts", ...args],
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
  "https://ark.cn-beijing.volces.com",
  "ark-demo-key-not-real",
  "ep-demo-model-not-real",
] as const;

function assertNoSensitiveData(output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `Must not leak: ${pattern}`);
  }
}

describe("provider adapter readiness script - default", () => {
  it("outputs report structure", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /=== Provider Adapter Readiness ===/);
    assert.match(result.stdout, /Status:/);
    assert.match(result.stdout, /Provider Name:/);
    assert.match(result.stdout, /Can Call External Model:/);
    assert.match(result.stdout, /Blocked Reasons:/);
    assert.match(result.stdout, /Safe Summary:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("provider adapter readiness script - sample-disabled", () => {
  it("outputs disabled with canCallExternalModel false", () => {
    const result = runScript(["--sample-disabled"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: disabled/);
    assert.match(result.stdout, /Can Call External Model: false/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-disabled"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("provider adapter readiness script - sample-blocked", () => {
  it("outputs blocked", () => {
    const result = runScript(["--sample-blocked"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: blocked/);
    assert.match(result.stdout, /Can Call External Model: false/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("provider adapter readiness script - sample-ready", () => {
  it("outputs ready with canCallExternalModel true", () => {
    const result = runScript(["--sample-ready"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: ready/);
    assert.match(result.stdout, /Can Call External Model: true/);
  });

  it("does not leak endpoint, modelId, or apiKey", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes("https://ark.cn-beijing.volces.com"), "Must not leak endpoint");
    assert.ok(!result.stdout.includes("ep-demo-model-not-real"), "Must not leak modelId");
    assert.ok(!result.stdout.includes("ark-demo-key-not-real"), "Must not leak apiKey");
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
