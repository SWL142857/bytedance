import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";

const SCRIPT = resolve(dirname(import.meta.dirname), "..", "scripts", "competition-live-loop-runbook.ts");

function runScript(args: string[] = []): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", SCRIPT, ...args], {
      encoding: "utf-8",
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 15000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout ? Buffer.from(e.stdout).toString("utf-8") : "",
      stderr: e.stderr ? Buffer.from(e.stderr).toString("utf-8") : "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("competition-live-loop-runbook", () => {
  it("default mode does not execute writes", () => {
    const { stdout, exitCode } = runScript();
    assert.equal(exitCode, 0, "should exit 0 in default mode");
    assert.ok(stdout.includes("当前为默认只读模式"), "should indicate default read-only mode");
    assert.ok(stdout.includes("此脚本不执行任何 Base 写入操作"), "should state no writes executed");
  });

  it("output covers 7 Agents", () => {
    const { stdout } = runScript();
    assert.ok(stdout.includes("HR 协调"), "should include HR 协调");
    assert.ok(stdout.includes("简历录入"), "should include 简历录入");
    assert.ok(stdout.includes("信息抽取"), "should include 信息抽取");
    assert.ok(stdout.includes("图谱构建"), "should include 图谱构建");
    assert.ok(stdout.includes("图谱复核"), "should include 图谱复核");
    assert.ok(stdout.includes("面试准备"), "should include 面试准备");
    assert.ok(stdout.includes("数据分析"), "should include 数据分析");
  });

  it("output covers Base tables", () => {
    const { stdout } = runScript();
    const tables = ["Jobs", "Candidates", "Resume Facts", "Evaluations", "Interview Kits", "Agent Runs", "Work Events", "Reports"];
    for (const t of tables) {
      assert.ok(stdout.includes(t), `should include table ${t}`);
    }
  });

  it("output covers Work Events, Reports, and Analytics", () => {
    const { stdout } = runScript();
    assert.ok(stdout.includes("Work Events"), "should mention Work Events");
    assert.ok(stdout.includes("Reports"), "should mention Reports");
    assert.ok(stdout.includes("Analytics"), "should mention Analytics");
  });

  it("does not leak token/secret/payload/stdout/stderr/table_id/record_id in script-controlled output", () => {
    // JSON output is fully controlled by our script, no lark-cli side effects
    const { stdout } = runScript(["--json"]);
    const forbidden = ["table_id", "payload", "LARK_APP_SECRET", "BASE_APP_TOKEN"];
    for (const token of forbidden) {
      assert.ok(!stdout.includes(token), `JSON output must not contain ${token}`);
    }
    // Verify safety structure
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.mode, "dry_run");
    assert.equal(parsed.safety.readsOnly, true);
    assert.equal(parsed.safety.frontendNoExecute, true);
  });

  it("execute steps are marked as manual/guarded, not auto-executed", () => {
    const { stdout } = runScript();
    assert.ok(stdout.includes("需人工确认"), "should mark steps requiring human confirmation");
    assert.ok(stdout.includes("执行（需人工确认）"), "should label execute_guarded steps");
    assert.ok(stdout.includes("写入守卫"), "should mention write guard");
  });

  it("--execute without --confirm fails closed", () => {
    const { stderr, exitCode } = runScript(["--execute"]);
    assert.notEqual(exitCode, 0, "should fail without confirm");
    assert.ok(stderr.includes("确认短语错误"), "should say confirm phrase error");
  });

  it("--execute with wrong --confirm fails closed", () => {
    const { stderr, exitCode } = runScript(["--execute", "--confirm=wrong"]);
    assert.notEqual(exitCode, 0, "should fail with wrong confirm");
    assert.ok(stderr.includes("确认短语错误"), "should say confirm phrase error");
  });

  it("--execute with correct --confirm passes but still no writes", () => {
    const { stdout, exitCode } = runScript(["--execute", "--confirm=COMPETITION_LOOP_RUNBOOK_CHECK"]);
    assert.equal(exitCode, 0, "should pass with correct confirm");
    assert.ok(stdout.includes("此脚本不执行任何 Base 写入操作"), "should still state no writes");
  });

  it("--json outputs valid JSON with safety field", () => {
    const { stdout, exitCode } = runScript(["--json"]);
    assert.equal(exitCode, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(typeof parsed.title, "string");
    assert.ok(Array.isArray(parsed.agents));
    assert.ok(Array.isArray(parsed.tables));
    assert.ok(Array.isArray(parsed.steps));
    assert.equal(parsed.safety.readsOnly, true);
    assert.equal(parsed.safety.writesGuarded, true);
    assert.equal(parsed.safety.frontendNoExecute, true);
    assert.equal(parsed.safety.planNonceRequired, true);
    assert.equal(parsed.mode, "dry_run");
  });

  it("--json output does not leak sensitive fields", () => {
    const { stdout } = runScript(["--json"]);
    const forbidden = ["rec_", "table_id", "payload", "stdout", "stderr", "LARK_APP_SECRET", "BASE_APP_TOKEN", "token", "secret", "apiKey"];
    for (const token of forbidden) {
      assert.ok(!stdout.includes(token), `JSON output must not contain ${token}`);
    }
  });
});
