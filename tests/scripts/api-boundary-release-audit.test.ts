import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    ["--import", "tsx", "scripts/demo-api-boundary-release-audit.ts", ...args],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf-8",
    },
  );
}

function buildCleanRoot(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# Clean\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
}

function buildDirtyRoot(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# Dirty\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "leak.ts"),
    ["MODEL_API_KEY", "=", "realProdKey123456"].join("") + ";\n",
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
}

const SENSITIVE_PATTERNS = [
  "--json", "--base-token", "realProdKey123456",
  "rec_demo_job_001", "rec_demo_candidate_001",
  "AI Product Manager with 6 years",
  "raw stdout", "payload", "token", "stdout", "raw stderr",
  "mvp:live-write:execute", "mvp:provider-smoke:execute",
  "mvp:provider-agent-demo:execute",
  "MODEL_API_ENDPOINT", "MODEL_ID", "MODEL_API_KEY",
  "Bearer", "Authorization",
] as const;

function assertNoSensitiveData(output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `Must not leak: ${pattern}`);
  }
}

describe("api boundary audit script - default", () => {
  it("exits with code 0", () => {
    const result = runScript();
    assert.equal(result.status, 0);
  });

  it("outputs audit structure", () => {
    const result = runScript();
    assert.match(result.stdout, /=== API Boundary Release Audit ===/);
    assert.match(result.stdout, /Status:/);
    assert.match(result.stdout, /Default External Model Calls Permitted: false/);
    assert.match(result.stdout, /Real Base Writes Permitted: false/);
    assert.match(result.stdout, /Provider Smoke Guarded:/);
    assert.match(result.stdout, /Provider Agent Demo Guarded:/);
    assert.match(result.stdout, /Base Write Guard Independent:/);
    assert.match(result.stdout, /Deterministic Demo Safe:/);
    assert.match(result.stdout, /Output Redaction Safe:/);
    assert.match(result.stdout, /Forbidden Trace Scan Passed:/);
    assert.match(result.stdout, /Secret Scan Passed:/);
    assert.match(result.stdout, /Release Gate Consistent:/);
    assert.match(result.stdout, /Checks ---/);
    assert.match(result.stdout, /Recommended Commands ---/);
    assert.match(result.stdout, /Final Note:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });

  it("does not contain execute commands", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes(":execute"), "Must not recommend execute commands");
  });
});

describe("api boundary audit script - sample-ready", () => {
  it("outputs ready", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: ready/);
    assert.match(result.stdout, /Provider Smoke Guarded: true/);
    assert.match(result.stdout, /Provider Agent Demo Guarded: true/);
    assert.match(result.stdout, /Base Write Guard Independent: true/);
    assert.match(result.stdout, /Deterministic Demo Safe: true/);
  });

  it("all checks pass", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[PASS\] Typecheck:/);
    assert.match(result.stdout, /\[PASS\] Tests:/);
    assert.match(result.stdout, /\[PASS\] Build:/);
    assert.match(result.stdout, /\[PASS\] Deterministic Demo:/);
    assert.match(result.stdout, /\[PASS\] Provider Smoke Guard:/);
    assert.match(result.stdout, /\[PASS\] Provider Agent Demo Guard:/);
    assert.match(result.stdout, /\[PASS\] Base Write Guard Independence:/);
    assert.match(result.stdout, /\[PASS\] Output Redaction:/);
    assert.match(result.stdout, /\[PASS\] Forbidden Trace Scan:/);
    assert.match(result.stdout, /\[PASS\] Secret Scan:/);
    assert.match(result.stdout, /\[PASS\] Release Gate Consistency:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("api boundary audit script - sample-needs-review", () => {
  it("outputs needs_review", () => {
    const result = runScript(["--sample-needs-review"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: needs_review/);
  });

  it("release gate consistency shows warn", () => {
    const result = runScript(["--sample-needs-review"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[WARN\] Release Gate Consistency:/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-needs-review"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("api boundary audit script - sample-blocked", () => {
  it("outputs blocked", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Status: blocked/);
  });

  it("shows blocked checks", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[BLOCK\] Typecheck:/);
    assert.match(result.stdout, /\[BLOCK\] Tests:/);
    assert.match(result.stdout, /\[BLOCK\] Build:/);
    assert.match(result.stdout, /\[BLOCK\] Provider Smoke Guard:/);
    assert.match(result.stdout, /\[BLOCK\] Provider Agent Demo Guard:/);
    assert.match(result.stdout, /\[BLOCK\] Base Write Guard Independence:/);
  });

  it("hard safety flags remain false", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Default External Model Calls Permitted: false/);
    assert.match(result.stdout, /Real Base Writes Permitted: false/);
  });

  it("does not leak sensitive data", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assertNoSensitiveData(`${result.stdout}\n${result.stderr}`);
  });
});

describe("api boundary audit script - --scan-root-dir", () => {
  it("clean root => Forbidden Trace Scan pass and status ready", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-ab-clean-"));
    try {
      buildCleanRoot(dir);
      const result = runScript([`--scan-root-dir=${dir}`]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Forbidden Trace Scan Passed: true/);
      assert.match(result.stdout, /Status: ready/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dirty root => Forbidden Trace Scan block and status blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-ab-dirty-"));
    try {
      buildDirtyRoot(dir);
      const result = runScript([`--scan-root-dir=${dir}`]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Forbidden Trace Scan Passed: false/);
      assert.match(result.stdout, /Status: blocked/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sample flags keep original behavior", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Forbidden Trace Scan Passed: true/);
    assert.match(result.stdout, /Status: ready/);
  });
});

describe("api boundary audit script - default with real scanner", () => {
  it("default path includes Forbidden Trace Scan check", () => {
    const result = runScript();
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Forbidden Trace Scan Passed/);
  });

  it("sample-ready shows PASS for forbidden trace scan", () => {
    const result = runScript(["--sample-ready"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[PASS\] Forbidden Trace Scan/);
  });

  it("sample-blocked shows BLOCK for forbidden trace scan", () => {
    const result = runScript(["--sample-blocked"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\[BLOCK\] Forbidden Trace Scan/);
  });
});
