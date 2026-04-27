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
    ["--import", "tsx", "scripts/run-provider-agent-demo.ts", ...args],
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

function parseStdout(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

describe("provider agent demo script - dry-run", () => {
  it("outputs safe dry-run JSON", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    const parsed = parseStdout(result.stdout);
    assert.equal(parsed.mode, "dry_run");
    assert.equal(parsed.status, "planned");
    assert.equal(parsed.canCallExternalModel, false);
    assert.equal(parsed.commandCount, null);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("provider agent demo script - execute guards", () => {
  it("execute without env is blocked", () => {
    const result = runScript([
      "--use-provider",
      "--execute",
      "--confirm=EXECUTE_PROVIDER_AGENT_DEMO",
      "--input-json={\"candidateRecordId\":\"recCandidate001\",\"candidateId\":\"cand_001\",\"resumeText\":\"PM with SQL\",\"fromStatus\":\"new\"}",
    ]);

    assert.equal(result.status, 0);
    const parsed = parseStdout(result.stdout);
    assert.equal(parsed.mode, "execute");
    assert.equal(parsed.status, "blocked");
    assert.ok(Array.isArray(parsed.blockedReasons));
    assert.ok((parsed.blockedReasons as unknown[]).length >= 3);
  });

  it("execute without input is blocked", () => {
    const result = runScript([
      "--use-provider",
      "--execute",
      "--confirm=EXECUTE_PROVIDER_AGENT_DEMO",
    ]);

    assert.equal(result.status, 0);
    const parsed = parseStdout(result.stdout);
    assert.equal(parsed.status, "blocked");
    assert.ok(
      Array.isArray(parsed.blockedReasons) &&
      (parsed.blockedReasons as string[]).some((reason) => reason.includes("input")),
    );
  });

  it("execute without --use-provider is blocked", () => {
    const result = runScript([
      "--execute",
      "--confirm=EXECUTE_PROVIDER_AGENT_DEMO",
    ]);

    assert.equal(result.status, 0);
    const parsed = parseStdout(result.stdout);
    assert.equal(parsed.status, "blocked");
  });

  it("blocked output does not leak sensitive data", () => {
    const result = runScript([
      "--use-provider",
      "--execute",
      "--confirm=EXECUTE_PROVIDER_AGENT_DEMO",
      "--input-json={\"candidateRecordId\":\"recCandidate001\",\"candidateId\":\"cand_001\",\"resumeText\":\"PM with SQL\",\"fromStatus\":\"new\"}",
    ]);

    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});
