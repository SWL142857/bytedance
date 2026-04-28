import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const SCRIPT_PATH = resolve(import.meta.dirname, "../../scripts/run-forbidden-trace-scan.ts");

function runScan(rootDir: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", SCRIPT_PATH, `--root-dir=${rootDir}`],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env },
    },
  );
}

function parseResult(stdout: string | Buffer | null | undefined): Record<string, unknown> {
  return JSON.parse(String(stdout ?? "").trim()) as Record<string, unknown>;
}

function buildCleanProject(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# Clean\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "app.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
}

function buildDirtyProject(dir: string): void {
  writeFileSync(join(dir, "README.md"), "# Dirty\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "leak.ts"),
    ["const x = ", "MODEL_API_KEY", "=", "realprodkey123"].join("") + ";\n",
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
}

describe("forbidden trace scan CLI", () => {
  it("clean temp root exit 0 and status pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-cli-"));
    try {
      buildCleanProject(dir);
      const result = runScan(dir);
      assert.equal(result.status, 0);
      const parsed = parseResult(result.stdout);
      assert.equal(parsed.status, "pass");
      assert.equal(parsed.findingCount, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dirty temp root exit non-zero and status blocked", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-dirty-"));
    try {
      buildDirtyProject(dir);
      const result = runScan(dir);
      assert.notEqual(result.status, 0);
      const parsed = parseResult(result.stdout);
      assert.equal(parsed.status, "blocked");
      assert.ok((parsed.findingCount as number) > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stdout/stderr does not contain secret values", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-scan-noleak-"));
    try {
      buildDirtyProject(dir);
      const result = runScan(dir);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.ok(!output.includes("realprodkey123"), "Must not leak secret value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
