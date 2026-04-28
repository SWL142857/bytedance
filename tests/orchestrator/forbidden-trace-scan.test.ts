import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runForbiddenTraceScan,
  type ForbiddenTraceScanReport,
} from "../../src/orchestrator/forbidden-trace-scan.js";

function assertReportSafe(report: ForbiddenTraceScanReport): void {
  const json = JSON.stringify(report);
  const forbidden = [
    "sk-", "api_key_value", "secret123", "my-real-token",
    "model_api_key_value", "Bearer abc123", "leaked-key",
  ];
  for (const f of forbidden) {
    assert.ok(!json.includes(f), `Report must not contain: "${f}"`);
  }
}

function assertFindingsSafe(report: ForbiddenTraceScanReport): void {
  for (const finding of report.findings) {
    assert.ok(finding.file.length > 0, "finding must have file");
    assert.ok(finding.line > 0, "finding must have line");
    assert.ok(finding.ruleId.length > 0, "finding must have ruleId");
    assert.ok(finding.category.length > 0, "finding must have category");
    assert.equal(
      finding.safeSummary,
      "Forbidden trace pattern detected in source text.",
    );
    assert.ok(
      !finding.safeSummary.includes("MODEL_API_KEY"),
      "safeSummary must not contain match text",
    );
  }
}

// ── secret_marker tests ──

describe("forbidden trace scan - secret_marker", () => {
  it("clean temp project returns status pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-clean-"));
    try {
      writeFileSync(join(dir, "README.md"), "# Clean Project\n\nNo secrets here.\n");
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const foo = 1;\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
      assert.equal(report.findingCount, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MODEL_API_KEY=real-value blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-key-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "config.ts"), "export const MODEL_API_KEY = sk-realvalue123;\n");
      writeFileSync(join(dir, "README.md"), "# Test\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.secret_marker > 0);
      assertReportSafe(report);
      assertFindingsSafe(report);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MODEL_API_KEY=your_key_here passes (placeholder)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-ph-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "config.ts"), "const key = MODEL_API_KEY=your_model_api_key_here;\n");
      writeFileSync(join(dir, "README.md"), "# Test\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MODEL_API_KEY= (empty value) passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-empty-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "config.ts"), "const key = MODEL_API_KEY=;\n");
      writeFileSync(join(dir, "README.md"), "# Test\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MODEL_API_KEY=test-value passes (test- prefix)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-tp-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "config.ts"), "const key = MODEL_API_KEY=test-key-123;\n");
      writeFileSync(join(dir, "README.md"), "# Test\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sk- with fake dictionary words passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-fakesk-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "test.ts"), 'const key = "sk-super-secret-key-12345";\n');
      writeFileSync(join(dir, "README.md"), "# Test\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("excludes node_modules / .git / dist / tmp", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-excl-"));
    try {
      writeFileSync(join(dir, "README.md"), "# Test\n");
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const x = 1;\n");
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules", "bad.ts"), "MODEL_API_KEY=secret-in-deps");
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".git", "config"), "MODEL_API_KEY=leaked-key");
      mkdirSync(join(dir, "dist"));
      writeFileSync(join(dir, "dist", "bundle.js"), "MODEL_API_KEY=leaked-in-build");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("findings do not contain matched text", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-safe-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"), "const key = MODEL_API_KEY=my-secret-123;\n");

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assertReportSafe(report);
      assertFindingsSafe(report);
      const json = JSON.stringify(report);
      assert.ok(!json.includes("my-secret-123"), "Must not contain matched secret value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── unsafe_raw_field tests ──

describe("forbidden trace scan - unsafe_raw_field", () => {
  it("legitimate field definitions pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-legit-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "types.ts"),
        "export interface CandidateEntry {\n" +
        "  resumeText: string;\n" +
        "  payload: Record<string, unknown>;\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log(resumeText) as variable blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-var-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function logCandidate(c: CandidateEntry) {\n" +
        "  console.log(c.resumeText);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.unsafe_raw_field > 0);
      assertReportSafe(report);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log with resumeText inside string literal passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-str-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "safe.ts"),
        "console.log('resumeText is a field name');\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.error(payload) as variable blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-payload-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function handle(req: Request) {\n" +
        "  console.error(req.payload);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.unsafe_raw_field > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.error with payload label and variable is blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-payload-label-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function handle(req: Request) {\n" +
        "  console.error('payload', req.payload);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.unsafe_raw_field > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("JSON.stringify(raw_prompt) blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-json-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function dump(prompt: unknown) {\n" +
        "  return JSON.stringify(raw_prompt);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── unsafe_output_token tests ──

describe("forbidden trace scan - unsafe_output_token", () => {
  it("config objects with endpoint/modelId/apiKey pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-config-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "config.ts"),
        "export interface ProviderConfig {\n" +
        "  endpoint: string;\n" +
        "  modelId: string;\n" +
        "  apiKey: string;\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log(endpoint) as variable blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-endpt-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function showConfig(c: ProviderConfig) {\n" +
        "  console.log(c.endpoint);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.unsafe_output_token > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log with endpoint inside string literal passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-epstr-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "safe.ts"),
        'console.log("set the local provider endpoint, model ID, and API key");\n',
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log(apiKey) as variable blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-apikey-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function debug(c: ProviderConfig) {\n" +
        "  console.log(c.apiKey);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log with apiKey label and variable is blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-apikey-label-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function debug(c: ProviderConfig) {\n" +
        "  console.log('apiKey', c.apiKey);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.unsafe_output_token > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("console.log with apiKey template interpolation is blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-apikey-template-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "leak.ts"),
        "function debug(c: ProviderConfig) {\n" +
        "  console.log(`apiKey=${c.apiKey}`);\n" +
        "}\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "blocked");
      assert.ok(report.categories.unsafe_output_token > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Allowlist / exclude tests ──

describe("forbidden trace scan - allowlist", () => {
  it("allowlisted test fixture does not block", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-alw-"));
    try {
      mkdirSync(join(dir, "tests", "orchestrator"), { recursive: true });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "app.ts"), "export const x = 1;\n");
      writeFileSync(
        join(dir, "tests", "orchestrator", "forbidden-trace-scan.test.ts"),
        "// This file contains MODEL_API_KEY=test-value for testing\n",
      );

      const report = runForbiddenTraceScan({ rootDir: dir });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects exclude option", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-exo-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "README.md"), "# Test\n");
      writeFileSync(join(dir, "src", "bad.ts"), "MODEL_API_KEY=real-leaked-key\n");

      const report = runForbiddenTraceScan({
        rootDir: dir,
        exclude: ["src/bad.ts"],
      });
      assert.equal(report.status, "pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
