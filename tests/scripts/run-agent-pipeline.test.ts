import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runScript(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-agent-pipeline.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
    },
  );
}

describe("run-agent-pipeline script", () => {
  it("runs candidate pipeline from input JSON and returns safe summary", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-agent-run-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      "--input-json={\"candidateRecordId\":\"recCandidate001\",\"jobRecordId\":\"recJob001\",\"candidateId\":\"cand_001\",\"jobId\":\"job_001\",\"resumeText\":\"PM with SQL and Python\",\"jobRequirements\":\"5+ years PM\",\"jobRubric\":\"Product sense\"}",
      `--snapshot-path=${snapshotPath}`,
    ]);

    try {
      assert.equal(result.status, 0);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(parsed.mode, "deterministic");
      assert.equal(parsed.completed, true);
      assert.equal(parsed.finalStatus, "decision_pending");
      assert.equal(parsed.failedAgent, null);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not leak raw input text", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-agent-run-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const resumeText = "Confidential resume text for local testing";
    const result = runScript([
      `--input-json={"candidateRecordId":"recCandidate001","jobRecordId":"recJob001","candidateId":"cand_001","jobId":"job_001","resumeText":"${resumeText}","jobRequirements":"5+ years PM","jobRubric":"Product sense"}`,
      `--snapshot-path=${snapshotPath}`,
    ]);

    try {
      assert.equal(result.status, 0);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.ok(!output.includes(resumeText));
      assert.ok(!output.includes("\"commands\""));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
