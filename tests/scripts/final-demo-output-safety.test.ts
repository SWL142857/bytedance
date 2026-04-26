import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runScript(script: string, args: string[] = []) {
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
    ["--import", "tsx", script, ...args],
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
  "MODEL_API_ENDPOINT",
  "MODEL_ID",
  "MODEL_API_KEY",
] as const;

function assertNoSensitiveData(label: string, output: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    assert.ok(!output.includes(pattern), `[${label}] Must not leak: ${pattern}`);
  }
}

interface ScriptCase {
  name: string;
  script: string;
  args: string[];
}

const SCRIPTS: ScriptCase[] = [
  {
    name: "release-gate",
    script: "scripts/demo-mvp-release-gate.ts",
    args: [],
  },
  {
    name: "live-runbook",
    script: "scripts/demo-live-operator-runbook.ts",
    args: [],
  },
  {
    name: "live-write:dry-run",
    script: "scripts/run-live-mvp-writes.ts",
    args: [],
  },
  {
    name: "live-ready",
    script: "scripts/demo-live-ready-mvp.ts",
    args: [],
  },
  {
    name: "pre-api-freeze",
    script: "scripts/demo-pre-api-freeze-report.ts",
    args: [],
  },
  {
    name: "provider-readiness",
    script: "scripts/demo-provider-adapter-readiness.ts",
    args: [],
  },
  {
    name: "provider-smoke",
    script: "scripts/run-provider-smoke.ts",
    args: [],
  },
  {
    name: "provider-agent-demo",
    script: "scripts/run-provider-agent-demo.ts",
    args: [],
  },
];

for (const { name, script, args } of SCRIPTS) {
  describe(`final demo output safety - ${name}`, () => {
    it("exits with code 0", () => {
      const result = runScript(script, args);
      assert.equal(result.status, 0, `${name} exited with ${result.status}`);
    });

    it("does not leak sensitive data in stdout or stderr", () => {
      const result = runScript(script, args);
      assert.equal(result.status, 0);
      assertNoSensitiveData(name, `${result.stdout}\n${result.stderr}`);
    });

    it("does not print rec_demo record IDs", () => {
      const result = runScript(script, args);
      assert.equal(result.status, 0);
      assert.ok(!result.stdout.includes("rec_demo_"), `[${name}] Must not print rec_demo_*`);
    });
  });
}

describe("final demo output safety - cross-script invariants", () => {
  it("no script outputs real-write permission as true", () => {
    const realWritePatterns = [
      "Real Write Permitted: true",
      "Real Base Write Allowed: true",
    ];
    for (const { script, args } of SCRIPTS) {
      const result = runScript(script, args);
      assert.equal(result.status, 0);
      for (const pattern of realWritePatterns) {
        assert.ok(
          !result.stdout.includes(pattern),
          `${script} must not report ${pattern}`,
        );
      }
    }
  });
});
