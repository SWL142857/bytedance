import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const SCRIPT = "scripts/demo-live-e2e-runbook.ts";

function runScript(args: string[] = []): string {
  return execFileSync("node", ["--import", "tsx", SCRIPT, ...args], {
    encoding: "utf-8",
    cwd: process.cwd(),
  });
}

function assertNoSensitive(output: string, label: string): void {
  assert.ok(!output.includes("rec_"), `${label} must not contain rec_`);
  assert.ok(!output.includes("baseAppToken"), `${label} must not contain baseAppToken`);
  assert.ok(!output.includes("larkAppSecret"), `${label} must not contain larkAppSecret`);
  assert.ok(!output.includes("LARK_APP_SECRET"), `${label} must not contain LARK_APP_SECRET`);
  assert.ok(!output.includes("BASE_APP_TOKEN"), `${label} must not contain BASE_APP_TOKEN`);
  assert.ok(!output.includes("payload"), `${label} must not contain payload`);
  assert.ok(!output.includes("stdout"), `${label} must not contain stdout`);
  assert.ok(!output.includes("stderr"), `${label} must not contain stderr`);
  assert.ok(!output.includes("apiKey"), `${label} must not contain apiKey`);
  assert.ok(!output.includes("endpoint"), `${label} must not contain endpoint`);
  assert.ok(!output.includes("modelId"), `${label} must not contain modelId`);
  assert.ok(!output.includes("EXECUTE_"), `${label} must not contain prefilled execute confirm phrases`);
  assert.ok(!output.includes("REVIEWED_"), `${label} must not contain prefilled review confirm phrases`);
  assert.ok(!output.includes("--base-token"), `${label} must not contain raw base token args`);
  assert.ok(!output.includes("--json"), `${label} must not contain raw json args`);
  assert.doesNotMatch(output, /\btoken\b/i, `${label} must not contain token text`);
  assert.ok(!output.includes(".ts:"), `${label} must not contain .ts: paths`);
  assert.ok(!output.includes(".js:"), `${label} must not contain .js: paths`);
}

describe("demo-live-e2e-runbook script", () => {
  it("runs with no args and outputs blocked steps", () => {
    const output = runScript();
    assert.ok(output.includes("Live E2E Runbook"), "should have title");
    assert.ok(output.includes("阻塞"), "should have blocked status");
    assert.ok(output.includes("Done."), "should finish");
    assertNoSensitive(output, "default output");
  });

  it("runs with --sample-fresh", () => {
    const output = runScript(["--sample-fresh"]);
    assert.ok(output.includes("Live E2E Runbook"), "should have title");
    assert.ok(output.includes("阻塞"), "should have blocked status");
    assert.ok(output.includes("[1]"), "should have step 1");
    assert.ok(output.includes("[13]"), "should have step 13");
    assertNoSensitive(output, "sample-fresh output");
  });

  it("runs with --sample-after-bootstrap", () => {
    const output = runScript(["--sample-after-bootstrap"]);
    assert.ok(output.includes("Live E2E Runbook"), "should have title");
    assert.ok(output.includes("就绪"), "should have ready status for step 1");
    assertNoSensitive(output, "sample-after-bootstrap output");
  });

  it("runs with --sample-ready-to-write", () => {
    const output = runScript(["--sample-ready-to-write"]);
    assert.ok(output.includes("Live E2E Runbook"), "should have title");
    assert.ok(output.includes("成功"), "should have success status");
    assertNoSensitive(output, "sample-ready-to-write output");
  });

  it("runs with --sample-after-partial-failure", () => {
    const output = runScript(["--sample-after-partial-failure"]);
    assert.ok(output.includes("Live E2E Runbook"), "should have title");
    assert.ok(output.includes("失败"), "should have failed status");
    assert.ok(output.includes("12"), "should mention failed command index");
    assertNoSensitive(output, "sample-after-partial-failure output");
  });

  it("runs with --sample-complete", () => {
    const output = runScript(["--sample-complete"]);
    assert.ok(output.includes("Live E2E Runbook"), "should have title");
    assert.ok(output.includes("成功"), "should have success status");
    assert.ok(output.includes("COMPLETED"), "overall status should be completed");
    assertNoSensitive(output, "sample-complete output");
  });

  it("all outputs contain all 13 steps", () => {
    const scenarios = [
      [],
      ["--sample-fresh"],
      ["--sample-after-bootstrap"],
      ["--sample-ready-to-write"],
      ["--sample-after-partial-failure"],
      ["--sample-complete"],
    ];
    for (const args of scenarios) {
      const output = runScript(args);
      for (let i = 1; i <= 13; i++) {
        assert.ok(output.includes(`[${i}]`), `scenario ${args.join(" ")} should have step [${i}]`);
      }
    }
  });

  it("output contains safety note", () => {
    const output = runScript(["--sample-complete"]);
    assert.ok(output.includes("盲目"), "should contain blind-rerun warning in safety note");
  });

  it("output contains Chinese status labels", () => {
    const output = runScript(["--sample-after-partial-failure"]);
    // Should have at least one of these Chinese labels
    const hasChinese = ["阻塞", "就绪", "成功", "失败", "未执行"].some(
      (label) => output.includes(label),
    );
    assert.ok(hasChinese, "should contain Chinese status labels");
  });
});
