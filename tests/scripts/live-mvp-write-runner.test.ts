import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  LIVE_MVP_WRITE_CONFIRMATION,
} from "../../src/orchestrator/live-mvp-runner.js";

function runScript(args: string[] = []) {
  const env = { ...process.env };
  delete env.LARK_APP_ID;
  delete env.LARK_APP_SECRET;
  delete env.BASE_APP_TOKEN;
  delete env.HIRELOOP_ALLOW_LARK_WRITE;

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-live-mvp-writes.ts", ...args],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf-8",
    },
  );
}

describe("live MVP write runner script — dry-run", () => {
  it("sample dry-run emits planned results without args or payloads", () => {
    const result = runScript();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Resolution source: sample/);
    assert.match(result.stdout, /Mode: DRY-RUN/);
    assert.match(result.stdout, /Executed: false/);
    assert.match(result.stdout, /Results: 24/);
    assert.match(result.stdout, /planned: Upsert record into "Agent Runs"/);
    assert.match(result.stdout, /=== Execution Audit ===/);
    assert.match(result.stdout, /mode: dry_run/);
    assert.match(result.stdout, /planned: 24/);
    assert.match(result.stdout, /recoveryNote: .*No writes were executed/);
    assert.ok(!result.stdout.includes("--json"));
    assert.ok(!result.stdout.includes("--base-token"));
    assert.ok(!result.stdout.includes("rec_demo_job_001"));
    assert.ok(!result.stdout.includes("AI Product Manager with 6 years"));
    assert.ok(!result.stdout.includes("raw stdout"));
  });
});

describe("live MVP write runner script — execute guards", () => {
  it("blocks execute without read-only resolution", () => {
    const result = runScript([
      "--execute",
      `--confirm=${LIVE_MVP_WRITE_CONFIRMATION}`,
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Execution blocked: --execute requires --use-readonly-resolution/);
    assert.match(result.stdout, /No write run generated/);
    assert.ok(!result.stdout.includes("=== Write Run ==="));
    assert.ok(!result.stdout.includes("success:"));
    assert.ok(!result.stdout.includes("--json"));
    assert.ok(!result.stdout.includes("--base-token"));
    assert.ok(!result.stdout.includes("rec_demo_job_001"));
    assert.ok(!result.stdout.includes("AI Product Manager with 6 years"));
    assert.ok(!result.stdout.includes("raw stdout"));
  });

  it("blocks execute without confirmation before resolution", () => {
    const result = runScript(["--use-readonly-resolution", "--execute"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Execution blocked: --confirm=EXECUTE_LIVE_MVP_WRITES is required/);
    assert.match(result.stdout, /No write run generated/);
    assert.ok(!result.stdout.includes("=== Write Run ==="));
    assert.ok(!result.stdout.includes("--json"));
    assert.ok(!result.stdout.includes("--base-token"));
    assert.ok(!result.stdout.includes("rec_demo_job_001"));
    assert.ok(!result.stdout.includes("AI Product Manager with 6 years"));
    assert.ok(!result.stdout.includes("raw stdout"));
  });

  it("blocks readonly execute with missing config and generates no write run", () => {
    const result = runScript([
      "--use-readonly-resolution",
      "--execute",
      `--confirm=${LIVE_MVP_WRITE_CONFIRMATION}`,
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Resolution source: read-only live resolution/);
    assert.match(result.stdout, /Read-only resolution blocked/);
    assert.ok(!result.stdout.includes("=== Write Run ==="));
    assert.ok(!result.stdout.includes("--json"));
    assert.ok(!result.stdout.includes("--base-token"));
    assert.ok(!result.stdout.includes("rec_demo_job_001"));
    assert.ok(!result.stdout.includes("AI Product Manager with 6 years"));
    assert.ok(!result.stdout.includes("raw stdout"));
  });
});
