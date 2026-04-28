import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runProviderDatasetVerify,
  type VerifyResult,
} from "../../scripts/run-provider-dataset-verify.js";
import type { DatasetRunnerOptions, DatasetRunnerResult } from "../../scripts/run-live-agent-dataset.js";
import type { HireLoopConfig } from "../../src/config.js";

// ── Helpers ──

const BLANK_ENV: Record<string, string> = {
  LARK_APP_ID: "",
  LARK_APP_SECRET: "",
  BASE_APP_TOKEN: "",
  HIRELOOP_ALLOW_LARK_WRITE: "",
  MODEL_API_KEY: "",
  MODEL_API_ENDPOINT: "",
  MODEL_ID: "",
};

function runScript(args: string[], env?: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-provider-dataset-verify.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, ...BLANK_ENV, ...env },
    },
  );
}

function parseResult(stderr: string): VerifyResult {
  const lastBrace = stderr.lastIndexOf("}");
  if (lastBrace === -1) throw new Error("No JSON found");
  let depth = 0;
  let start = lastBrace;
  for (let i = lastBrace; i >= 0; i--) {
    if (stderr[i] === "}") depth++;
    if (stderr[i] === "{") depth--;
    if (depth === 0) { start = i; break; }
  }
  return JSON.parse(stderr.slice(start, lastBrace + 1)) as VerifyResult;
}

const validEntry = {
  candidateRecordId: "recCandidate001",
  jobRecordId: "recJob001",
  candidateId: "cand_001",
  jobId: "job_001",
  resumeText: "PM with SQL and Python",
  jobRequirements: "5+ years PM",
  jobRubric: "Product sense",
};

const VALID_CONFIRM = "VERIFY_PROVIDER_DATASET_EXECUTE";

// ── Mock deps ──

function mockRunnerResult(overrides?: Partial<DatasetRunnerResult>): DatasetRunnerResult {
  return {
    mode: "provider",
    totalCandidates: 1,
    completedCount: 1,
    failedCount: 0,
    totalCommands: 16,
    snapshotPath: "/tmp/fake/snapshot.json",
    writeAttempted: false,
    writeBlocked: false,
    writeBlockedReasons: [],
    writeSucceededCount: 0,
    writeFailedCount: 0,
    workEventBlockedReasons: [],
    safeSummary: "Processed 1 candidates: 1 completed, 0 stopped.",
    ...overrides,
  };
}

function fakeReadyConfig(): HireLoopConfig {
  return {
    larkAppId: null,
    larkAppSecret: null,
    baseAppToken: null,
    feishuBaseWebUrl: null,
    modelApiKey: "sk-present",
    modelApiEndpoint: "https://example.com/v1",
    modelId: "test-model",
    modelProvider: "volcengine-ark",
    allowLarkRead: false,
    allowLarkWrite: false,
    debug: false,
  };
}

// ═══════════════════════════════════════
// Injectable unit tests
// ═══════════════════════════════════════

describe("runProviderDatasetVerify (injectable)", () => {
  it("blocked without --execute-provider", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: false,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.mode, "provider_blocked");
    assert.equal(result.snapshotWritten, false);
    assert.equal(result.externalModelCalls, false);
    assert.ok(result.safeSummary.includes("--execute-provider"));
  });

  it("blocked with wrong confirm", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: "wrong-confirm",
    });

    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes(VALID_CONFIRM));
  });

  it("blocked when provider env missing", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => ({
          larkAppId: null, larkAppSecret: null, baseAppToken: null, feishuBaseWebUrl: null,
          modelApiKey: null, modelApiEndpoint: null, modelId: null,
          modelProvider: "volcengine-ark", allowLarkRead: false, allowLarkWrite: false, debug: false,
        }),
      },
    });

    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("not ready"));
    // Must not leak endpoint/model/api key values or literals
    const json = JSON.stringify(result);
    assert.ok(!json.includes("sk-"), "Must not contain API key pattern");
  });

  it("blocked guards do NOT call runLiveAgentDataset", async () => {
    let called = false;
    const result = await runProviderDatasetVerify({
      executeProvider: false,
      deps: {
        runLiveAgentDataset: async () => { called = true; return mockRunnerResult(); },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(called, false);
  });

  it("wrong confirm does NOT call runLiveAgentDataset", async () => {
    let called = false;
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: "bad",
      deps: {
        runLiveAgentDataset: async () => { called = true; return mockRunnerResult(); },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(called, false);
  });

  it("missing provider env does NOT call runLiveAgentDataset", async () => {
    let called = false;
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => ({
          larkAppId: null, larkAppSecret: null, baseAppToken: null, feishuBaseWebUrl: null,
          modelApiKey: null, modelApiEndpoint: null, modelId: null,
          modelProvider: "volcengine-ark", allowLarkRead: false, allowLarkWrite: false, debug: false,
        }),
        runLiveAgentDataset: async () => { called = true; return mockRunnerResult(); },
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(called, false);
  });

  it("ready + correct confirm calls runLiveAgentDataset with provider params", async () => {
    let capturedOpts: DatasetRunnerOptions | undefined;

    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      inputFile: "test.json",
      snapshotPath: "/tmp/snap.json",
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async (opts) => {
          capturedOpts = opts;
          return mockRunnerResult();
        },
      },
    });

    assert.equal(result.status, "passed");
    assert.equal(result.snapshotWritten, true);
    assert.equal(result.externalModelCalls, true);
    assert.ok(capturedOpts, "Should have called runLiveAgentDataset");
    assert.equal(capturedOpts!.useProvider, true);
    assert.equal(capturedOpts!.executeModel, true);
    assert.equal(capturedOpts!.modelConfirm, "EXECUTE_PROVIDER_DATASET_AGENTS");
    assert.equal(capturedOpts!.writeBase, false);
    assert.equal(capturedOpts!.inputRecordIdsAreLive, false);
    assert.equal(capturedOpts!.inputFile, "test.json");
    assert.equal(capturedOpts!.snapshotPath, "/tmp/snap.json");
  });

  it("passed result does not contain snapshot path value", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () => mockRunnerResult({ snapshotPath: "/secret/path/snap.json" }),
      },
    });

    const json = JSON.stringify(result);
    assert.ok(!json.includes("/secret/path"), "Must not contain snapshot path");
    assert.ok(!json.includes("snapshotPath"), "Must not contain snapshotPath field name");
  });

  it("passed result does not leak payload, prompt, resumeText, record IDs", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () => mockRunnerResult(),
      },
    });

    const json = JSON.stringify(result);
    const forbidden = [
      "payload", "prompt", "resumeText", "resume_text",
      "rec_", "cand_", "job_", "jobRequirements", "jobRubric",
      "api_key", "apiKey", "endpoint", "model_id", "modelId",
    ];
    for (const f of forbidden) {
      assert.ok(!json.includes(f), `Result must not contain: "${f}"`);
    }
  });

  it("throws in runLiveAgentDataset => status=failed with fixed safe message", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () => {
          throw new Error("secret error with rec_secret_001 and payload leak");
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.safeSummary, "Provider dataset verification failed before producing a safe result.");
    const json = JSON.stringify(result);
    assert.ok(!json.includes("secret error"), "Must not leak error.message");
    assert.ok(!json.includes("rec_secret_001"), "Must not leak record ID from error");
    assert.ok(!json.includes("payload"), "Must not leak 'payload' from error");
  });

  it("completedCount < totalCandidates => status=failed", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () => mockRunnerResult({ completedCount: 0, failedCount: 1 }),
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.completedCount, 0);
    assert.equal(result.failedCount, 1);
  });

  it("ready + correct confirm + runner mode=deterministic with all-success counts => status=failed", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () =>
          mockRunnerResult({
            mode: "deterministic",
            totalCandidates: 1,
            completedCount: 1,
            failedCount: 0,
          }),
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.externalModelCalls, false);
    assert.equal(result.snapshotWritten, false);
    assert.equal(
      result.safeSummary,
      "Provider dataset verification did not execute provider mode.",
    );
    const json = JSON.stringify(result);
    const forbidden = [
      "snapshotPath", "payload", "prompt", "resumeText",
      "rec_", "cand_", "job_", "apiKey", "endpoint", "modelId",
    ];
    for (const f of forbidden) {
      assert.ok(!json.includes(f), `Result must not contain: "${f}"`);
    }
  });

  it("ready + correct confirm + runner mode=provider_blocked => status=blocked", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () =>
          mockRunnerResult({
            mode: "provider_blocked",
            totalCandidates: 0,
            completedCount: 0,
            failedCount: 0,
          }),
      },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.externalModelCalls, false);
    assert.equal(result.snapshotWritten, false);
    assert.equal(
      result.safeSummary,
      "Provider dataset runner blocked provider execution.",
    );
    const json = JSON.stringify(result);
    const forbidden = [
      "snapshotPath", "payload", "prompt", "resumeText",
      "rec_", "cand_", "job_", "apiKey", "endpoint", "modelId",
    ];
    for (const f of forbidden) {
      assert.ok(!json.includes(f), `Result must not contain: "${f}"`);
    }
  });

  it("ready + correct confirm + runner mode=provider but totalCandidates=0 => status=failed", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () =>
          mockRunnerResult({
            mode: "provider",
            totalCandidates: 0,
            completedCount: 0,
            failedCount: 0,
          }),
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.snapshotWritten, false);
    assert.equal(result.externalModelCalls, false);
    assert.equal(
      result.safeSummary,
      "Provider dataset verification did not complete all candidates.",
    );
    const json = JSON.stringify(result);
    const forbidden = [
      "snapshotPath", "payload", "prompt", "resumeText", "resume_text",
      "rec_", "cand_", "job_", "apiKey", "endpoint", "modelId",
      "api_key", "model_id",
    ];
    for (const f of forbidden) {
      assert.ok(!json.includes(f), `Result must not contain: "${f}"`);
    }
  });

  it("ready + correct confirm + runner mode=provider nonzero incomplete => snapshotWritten true, safeSummary fixed", async () => {
    const result = await runProviderDatasetVerify({
      executeProvider: true,
      confirm: VALID_CONFIRM,
      deps: {
        loadConfig: () => fakeReadyConfig(),
        runLiveAgentDataset: async () =>
          mockRunnerResult({
            mode: "provider",
            totalCandidates: 1,
            completedCount: 0,
            failedCount: 1,
            safeSummary: "Processed 1 candidates: 0 completed, 1 stopped. Sensitive: rec_XYZ payload leak",
          }),
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.snapshotWritten, true);
    assert.equal(result.externalModelCalls, true);
    assert.equal(
      result.safeSummary,
      "Provider dataset verification did not complete all candidates.",
    );
    const json = JSON.stringify(result);
    assert.ok(!json.includes("rec_XYZ"), "Must not leak runner safeSummary content");
    assert.ok(!json.includes("payload leak"), "Must not leak runner safeSummary content");
    assert.ok(!json.includes("Sensitive"), "Must not leak runner safeSummary content");
  });
});

// ═══════════════════════════════════════
// CLI subprocess integration tests
// ═══════════════════════════════════════

describe("run-provider-dataset-verify CLI", () => {
  it("blocks without --execute-provider, exit non-zero", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-verify-"));
    const snapPath = join(tempDir, "snap.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapPath}`,
    ]);

    try {
      assert.notEqual(result.status, 0);
      const parsed = parseResult(result.stderr);
      assert.equal(parsed.status, "blocked");
      assert.equal(parsed.snapshotWritten, false);
      assert.ok(parsed.safeSummary.includes("--execute-provider"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks with wrong confirm, exit non-zero", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-verify-"));
    const snapPath = join(tempDir, "snap.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapPath}`,
      "--execute-provider",
      "--confirm=wrong",
    ]);

    try {
      assert.notEqual(result.status, 0);
      const parsed = parseResult(result.stderr);
      assert.equal(parsed.status, "blocked");
      assert.ok(parsed.safeSummary.includes(VALID_CONFIRM));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("blocks when provider env missing, exit non-zero", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-verify-"));
    const snapPath = join(tempDir, "snap.json");
    // BLANK_ENV defaults all provider vars to ""
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapPath}`,
      "--execute-provider",
      `--confirm=${VALID_CONFIRM}`,
    ]);

    try {
      assert.notEqual(result.status, 0);
      const parsed = parseResult(result.stderr);
      assert.equal(parsed.status, "blocked");
      assert.ok(parsed.safeSummary.includes("not ready"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("output does not leak snapshot path value", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-verify-"));
    const snapPath = join(tempDir, "snap.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapPath}`,
    ]);

    try {
      const combined = `${result.stdout}\n${result.stderr}`;
      // snapshotPath value must not appear
      assert.ok(!combined.includes(snapPath), "Must not leak snapshot path value");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("output does not leak entry data", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-verify-"));
    const snapPath = join(tempDir, "snap.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapPath}`,
    ]);

    try {
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.ok(!combined.includes("recCandidate001"));
      assert.ok(!combined.includes("recJob001"));
      assert.ok(!combined.includes("cand_001"));
      assert.ok(!combined.includes("job_001"));
      assert.ok(!combined.includes("PM with SQL"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("snapshot goes to tempDir, never references default path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-verify-"));
    const snapPath = join(tempDir, "snap.json");
    // Even the blocked path should not leak the default snapshot path
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapPath}`,
    ]);

    try {
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.ok(!combined.includes("latest-agent-runtime"), "Must not reference default snapshot path");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
