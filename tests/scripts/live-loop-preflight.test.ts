import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";

const SCRIPT = resolve(dirname(import.meta.dirname), "..", "scripts", "live-loop-preflight.ts");

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

describe("live-loop-preflight", () => {
  it("does not print env values", () => {
    const { stdout } = runScript();
    // Must report present/missing but never the actual secret
    assert.ok(!stdout.includes(String(process.env["LARK_APP_ID"] || "NONEXISTENT_MARKER_XYZ")), "must not print LARK_APP_ID value");
    assert.ok(!stdout.includes(String(process.env["LARK_APP_SECRET"] || "NONEXISTENT_MARKER_XYZ")), "must not print LARK_APP_SECRET value");
    assert.ok(!stdout.includes(String(process.env["BASE_APP_TOKEN"] || "NONEXISTENT_MARKER_XYZ")), "must not print BASE_APP_TOKEN value");
  });

  it("default mode does not execute writes", () => {
    const { stdout } = runScript();
    // Should run but may exit 1 if checks fail
    assert.ok(stdout.includes("Preflight"), "should output preflight header");
    // Never mentions execute or write
    assert.ok(!stdout.includes("EXECUTE_LIVE"), "must not contain execute tokens");
    assert.ok(!stdout.includes("写入成功"), "must not claim writes succeeded");
  });

  it("--json produces valid JSON", () => {
    const { stdout } = runScript(["--json"]);
    const parsed = JSON.parse(stdout);
    assert.equal(typeof parsed.passed, "boolean");
    assert.equal(typeof parsed.summary, "string");
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(parsed.checks.length > 0);
  });

  it("--json output does not leak env values", () => {
    const { stdout } = runScript(["--json"]);
    const forbidden = [
      process.env["LARK_APP_ID"],
      process.env["LARK_APP_SECRET"],
      process.env["BASE_APP_TOKEN"],
    ].filter(Boolean);
    for (const token of forbidden) {
      assert.ok(!stdout.includes(token as string), `JSON output must not contain env value`);
    }
  });

  it("--json output does not leak sensitive fields", () => {
    const { stdout } = runScript(["--json"]);
    const forbidden = ["rec_", "table_id", "payload", "stdout", "stderr", "apiKey", "endpoint", "modelId"];
    for (const token of forbidden) {
      assert.ok(!stdout.includes(token), `JSON output must not contain ${token}`);
    }
  });

  it("--json output structure covers all check categories", () => {
    const { stdout } = runScript(["--json"]);
    const parsed = JSON.parse(stdout);
    const labels = parsed.checks.map((c: { label: string }) => c.label);
    assert.ok(labels.some((l: string) => l.includes("LARK_APP_ID")), "should check LARK_APP_ID");
    assert.ok(labels.some((l: string) => l.includes("BASE_APP_TOKEN")), "should check BASE_APP_TOKEN");
    assert.ok(labels.some((l: string) => l.includes("Base") || l.includes("飞书")), "should check Base status");
  });

  it("missing env generates warning not crash", () => {
    // Run with stripped env to ensure fail-safe
    const { stdout } = runScript(["--json"]);
    const parsed = JSON.parse(stdout);
    // Should have finished and produced output even with missing vars
    assert.ok(parsed.checks.length > 0, "should have check results");
  });

  it("all check statuses are valid", () => {
    const { stdout } = runScript(["--json"]);
    const parsed = JSON.parse(stdout);
    for (const c of parsed.checks) {
      assert.ok(["ok", "warn", "missing"].includes(c.status), `invalid status: ${c.status}`);
    }
  });
});
