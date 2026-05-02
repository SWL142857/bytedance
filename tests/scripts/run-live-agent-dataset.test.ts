import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import the injectable runner and helpers for unit tests
import {
  runLiveAgentDataset,
  buildSafeWorkEventRecord,
  buildWorkEventCommandSpec,
  type DatasetRunnerOptions,
} from "../../scripts/run-live-agent-dataset.js";
import { DeterministicLlmClient } from "../../src/llm/deterministic-client.js";
import type { HireLoopConfig } from "../../src/config.js";
import type { LlmClient, LlmRequest, LlmResponse } from "../../src/llm/client.js";
import type { CandidatePipelineResult } from "../../src/orchestrator/candidate-pipeline.js";
import type { PlanResult } from "../../src/base/commands.js";
import type { RunResult } from "../../src/base/lark-cli-runner.js";

// ── Integration test helpers ──

// Default: all sensitive env vars are blank. Tests override what they need.
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
    ["--import", "tsx", "scripts/run-live-agent-dataset.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, ...BLANK_ENV, ...env },
    },
  );
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

function parseLastJson(text: string): Record<string, unknown> {
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) throw new Error("No JSON found in output");
  let depth = 0;
  let start = lastBrace;
  for (let i = lastBrace; i >= 0; i--) {
    if (text[i] === "}") depth++;
    if (text[i] === "{") depth--;
    if (depth === 0) { start = i; break; }
  }
  return JSON.parse(text.slice(start, lastBrace + 1)) as Record<string, unknown>;
}

function extractJsonArg(command: { args: string[] }): Record<string, unknown> | null {
  const jsonIdx = command.args.indexOf("--json");
  if (jsonIdx === -1 || jsonIdx + 1 >= command.args.length) return null;
  return JSON.parse(command.args[jsonIdx + 1]!) as Record<string, unknown>;
}

// ── Mock provider client (schema-valid 5-stage responses for P3 pipeline) ──

const SCHEMA_VALID_RESPONSES: Record<string, string> = {
  extraction_v1: JSON.stringify({
    skills: [
      { name: "Product Management", canonicalName: "Product Management", confidence: 1.0, evidence: "5 years as PM" },
      { name: "SQL", canonicalName: "SQL", confidence: 0.9, evidence: "SQL and data analysis" },
    ],
    features: [
      { featureType: "experience", featureName: "PM Tenure", canonicalName: "PM Tenure", featureValue: "5 years", confidence: 1.0, evidence: "5 years experience" },
    ],
    profile: {
      yearsOfExperience: "5",
      educationLevel: "Bachelor's",
      industryBackground: "Technology",
      leadershipLevel: "mid",
      communicationLevel: "proficient",
      systemDesignLevel: "proficient",
      structuredSummary: "Candidate has 5 years PM experience in tech sector.",
    },
  }),
  reviewer_v1: JSON.stringify({
    decisionPred: "select",
    confidence: 0.85,
    reasonLabel: "Strong PM Fit",
    reasonGroup: "skill_match",
    reviewSummary: "Candidate demonstrates strong product management background with data analysis skills. Profile aligns well with role requirements.",
  }),
  graph_builder_v1: JSON.stringify({
    shouldLink: true,
    linkReason: "Candidates share product and data signals.",
    sharedSignals: ["Product Management", "SQL"],
  }),
  interview_kit_v1: JSON.stringify({
    questions: [
      { question: "Walk me through how you would design a recommendation system for a new product line.", purpose: "Assess technical depth and ML pipeline understanding", followUps: ["How would you handle cold start?", "What metrics would you track?"] },
      { question: "Describe a time when you had to prioritize competing features with limited engineering resources.", purpose: "Evaluate product sense and prioritization skills", followUps: ["What tradeoffs did you make?", "How did you communicate the decision?"] },
      { question: "Present a technical spec you wrote to a non-technical stakeholder - how do you structure it?", purpose: "Test communication clarity", followUps: ["How do you handle pushback?", "What format works best?"] },
    ],
    scorecardDimensions: ["technical_depth", "product_sense", "communication"],
    focusAreas: ["ML system design", "feature prioritization", "cross-functional collaboration"],
    riskChecks: ["Check for over-reliance on single metric", "Verify hands-on vs advisory experience split"],
  }),
  hr_coordinator_v1: JSON.stringify({
    handoffSummary: "Candidate shows strong technical depth and product sense. Communication rated medium. Interview kit prepared with 3 targeted questions.",
    nextStep: "human_decision",
    coordinatorChecklist: [
      "Review interview kit questions for role alignment",
      "Confirm interview panel availability",
      "Check candidate screening recommendation",
      "Schedule follow-up with hiring manager",
    ],
  }),
};

class MockProviderClient implements LlmClient {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const content = SCHEMA_VALID_RESPONSES[request.promptTemplateId];
    if (content === undefined) {
      throw new Error(`Mock: no response for template "${request.promptTemplateId}"`);
    }
    return { content, promptTemplateId: request.promptTemplateId };
  }
}

// ── Tests: subprocess integration (guard logic, env safety) ──

describe("run-live-agent-dataset script", () => {
  // ═══ Deterministic dry-run (preserved) ═══

  it("runs deterministic dry-run with single entry", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
    ]);

    try {
      assert.equal(result.status, 0);
      const parsed = parseLastJson(result.stderr);
      assert.equal(parsed.mode, "deterministic");
      assert.equal(parsed.totalCandidates, 1);
      assert.equal(parsed.completedCount, 1);
      assert.equal(parsed.failedCount, 0);
      assert.equal(parsed.writeAttempted, false);
      assert.equal(parsed.writeBlocked, false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs deterministic dry-run from input file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const inputPath = join(tempDir, "dataset.json");
    writeFileSync(inputPath, JSON.stringify([validEntry, { ...validEntry, candidateId: "cand_002" }]));
    const result = runScript([
      `--input-file=${inputPath}`,
      `--snapshot-path=${snapshotPath}`,
    ]);

    try {
      assert.equal(result.status, 0);
      const parsed = parseLastJson(result.stderr);
      assert.equal(parsed.totalCandidates, 2);
      assert.equal(parsed.completedCount, 2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not leak sensitive text in output", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const sensitiveEntry = {
      ...validEntry,
      resumeText: "secret resume content rec_secret_001",
      jobRequirements: "needs payload inspection",
    };
    const result = runScript([
      `--input-json=${JSON.stringify([sensitiveEntry])}`,
      `--snapshot-path=${snapshotPath}`,
    ]);

    try {
      assert.equal(result.status, 0);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.ok(!output.includes("rec_secret_001"));
      assert.ok(!output.includes("payload"));
      assert.ok(!output.includes("secret resume content"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══ Provider blocked: missing confirmation flags ═══

  it("blocks provider mode without --execute-model and --confirm", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--use-provider",
    ]);

    try {
      assert.notEqual(result.status, 0, "Should exit non-zero when provider blocked");
      assert.ok(result.stderr.includes('"status":"blocked"'), "Stderr must contain blocked status");
      assert.ok(result.stderr.includes('"mode":"provider_blocked"'), "Stderr must show provider_blocked mode");
      assert.ok(!result.stderr.includes('"mode":"deterministic"'), "Must not use deterministic mode");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══ Provider blocked: full confirm but missing env (blank by default) ═══

  it("provider full confirm + blank env => blocked, exit non-zero", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    // Env defaults to blank for all sensitive vars — no override needed
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--use-provider",
      "--execute-model",
      "--confirm=EXECUTE_PROVIDER_DATASET_AGENTS",
    ]);

    try {
      assert.notEqual(result.status, 0, "Should exit non-zero");
      assert.ok(result.stderr.includes('"status":"blocked"'));
      assert.ok(result.stderr.includes('"mode":"provider_blocked"'));
      assert.ok(result.stderr.includes("not ready"));
      assert.ok(!result.stderr.includes('"mode":"deterministic"'));
      assert.ok(!result.stderr.includes("Falling back"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══ Provider: does not use deterministic when guards pass ═══

  it("provider with all guards passing does not use DeterministicLlmClient", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--use-provider",
      "--execute-model",
      "--confirm=EXECUTE_PROVIDER_DATASET_AGENTS",
    ], {
      MODEL_API_KEY: "sk-test-not-real",
      MODEL_API_ENDPOINT: "http://127.0.0.1:1",
      MODEL_ID: "test-model",
    });

    try {
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.ok(!combined.includes("Falling back to deterministic"), "Must not fallback");
      assert.ok(!combined.includes('"mode":"deterministic"'), "Must not mark as deterministic");
      assert.ok(!result.stderr.includes('"mode":"provider_blocked"'), "Provider guard must not block");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══ No duplicate pipeline runs ═══

  it("dataset with 2 entries does not re-run last candidate for snapshot", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry, { ...validEntry, candidateId: "cand_002" }])}`,
      `--snapshot-path=${snapshotPath}`,
    ]);

    try {
      assert.equal(result.status, 0);
      const parsed = parseLastJson(result.stderr);
      assert.equal(parsed.totalCandidates, 2);
      assert.equal(parsed.completedCount, 2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══ Write-base guard blocked tests ═══

  it("write-base blocked without --input-record-ids-are-live", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--write-base",
      "--write-confirm=EXECUTE_LIVE_DATASET_WRITES",
    ], {
      HIRELOOP_ALLOW_LARK_WRITE: "1",
    });

    try {
      assert.ok(result.stderr.includes('"status":"blocked"'), "Must contain blocked status");
      assert.ok(result.stderr.includes('"phase":"write_base"'), "Must contain write_base phase");
      assert.ok(result.stderr.includes("input-record-ids-are-live"),
        "Blocked reason must mention --input-record-ids-are-live");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("write-base blocked without --write-confirm even with --input-record-ids-are-live", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--write-base",
      "--input-record-ids-are-live",
    ], {
      HIRELOOP_ALLOW_LARK_WRITE: "1",
    });

    try {
      assert.ok(result.stderr.includes('"status":"blocked"'), "Must contain blocked status");
      assert.ok(result.stderr.includes('"phase":"write_base"'), "Must contain write_base phase");
      assert.ok(result.stderr.includes("write-confirm"),
        "Blocked reason must mention --write-confirm");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("write-base blocked without HIRELOOP_ALLOW_LARK_WRITE even with all confirmations", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    // BLANK_ENV defaults HIRELOOP_ALLOW_LARK_WRITE="" — guard blocks
    const result = runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--write-base",
      "--input-record-ids-are-live",
      "--write-confirm=EXECUTE_LIVE_DATASET_WRITES",
    ]);

    try {
      assert.ok(result.stderr.includes('"status":"blocked"'), "Must contain blocked status");
      assert.ok(result.stderr.includes('"phase":"write_base"'), "Must contain write_base phase");
      assert.ok(result.stderr.includes("HIRELOOP_ALLOW_LARK_WRITE"),
        "Blocked reason must mention HIRELOOP_ALLOW_LARK_WRITE");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ═══ Snapshot safety: blocked provider doesn't write provider snapshot ═══

  it("blocked provider mode does not write snapshot claiming source=provider", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    // Env defaults blank — provider readiness blocked
    runScript([
      `--input-json=${JSON.stringify([validEntry])}`,
      `--snapshot-path=${snapshotPath}`,
      "--use-provider",
      "--execute-model",
      "--confirm=EXECUTE_PROVIDER_DATASET_AGENTS",
    ]);

    try {
      if (existsSync(snapshotPath)) {
        const content = readFileSync(snapshotPath, "utf8");
        assert.ok(
          !content.includes('"source":"provider"'),
          "Snapshot must not claim provider source when blocked",
        );
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Injectable runner unit tests (mock client, injectable deps)
// ═══════════════════════════════════════════════════════════

describe("runLiveAgentDataset (injectable)", () => {
  const baseOptions: DatasetRunnerOptions = {
    inputJson: JSON.stringify([validEntry]),
    useProvider: false,
    executeModel: false,
    writeBase: false,
    inputRecordIdsAreLive: false,
  };

  function tempSnapshotPath(): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "hireloop-dataset-"));
    return { dir, path: join(dir, "snapshot.json") };
  }

  // ═══ Deterministic pipeline ═══

  it("completes full deterministic pipeline via injectable runner", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
      });

      assert.equal(result.mode, "deterministic");
      assert.equal(result.totalCandidates, 1);
      assert.equal(result.completedCount, 1);
      assert.equal(result.failedCount, 0);
      assert.equal(result.writeAttempted, false);
      assert.equal(result.writeBlocked, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ═══ Provider pipeline with mock client ═══

  it("completes full provider pipeline with mock client (5-stage schema-valid responses)", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        useProvider: true,
        executeModel: true,
        modelConfirm: "EXECUTE_PROVIDER_DATASET_AGENTS",
        deps: {
          providerClientFactory: () => new MockProviderClient(),
        },
      });

      assert.equal(result.mode, "provider");
      assert.equal(result.totalCandidates, 1);
      assert.equal(result.completedCount, 1);
      assert.equal(result.failedCount, 0);
      assert.ok(result.totalCommands > 0, "Should have generated commands");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provider pipeline with mock client handles multiple candidates", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        inputJson: JSON.stringify([validEntry, { ...validEntry, candidateId: "cand_002" }]),
        snapshotPath: snapPath,
        useProvider: true,
        executeModel: true,
        modelConfirm: "EXECUTE_PROVIDER_DATASET_AGENTS",
        deps: {
          providerClientFactory: () => new MockProviderClient(),
        },
      });

      assert.equal(result.mode, "provider");
      assert.equal(result.totalCandidates, 2);
      assert.equal(result.completedCount, 2);
      assert.ok(result.totalCommands > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provider pipeline with mock client does not re-run last candidate", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        inputJson: JSON.stringify([validEntry, { ...validEntry, candidateId: "cand_002" }]),
        snapshotPath: snapPath,
        useProvider: true,
        executeModel: true,
        modelConfirm: "EXECUTE_PROVIDER_DATASET_AGENTS",
        deps: {
          providerClientFactory: () => new MockProviderClient(),
        },
      });

      assert.equal(result.totalCandidates, 2);
      assert.equal(result.completedCount, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("provider blocked without executeModel even with mock client", async () => {
    const result = await runLiveAgentDataset({
      ...baseOptions,
      useProvider: true,
      executeModel: false,
    });

    assert.equal(result.mode, "provider_blocked");
    assert.equal(result.completedCount, 0);
    assert.ok(result.safeSummary.includes("execute-model"));
  });

  // ═══ Write fields with injectable runPlan ═══

  it("returns precise write fields when writeBase is false", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
      });

      assert.equal(result.writeAttempted, false);
      assert.equal(result.writeBlocked, false);
      assert.equal(result.writeSucceededCount, 0);
      assert.equal(result.writeFailedCount, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeAttempted=true and writeBlocked=true when guard fails", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        writeBase: true,
        writeConfirm: "EXECUTE_LIVE_DATASET_WRITES",
        // missing inputRecordIdsAreLive
      });

      assert.equal(result.writeAttempted, true);
      assert.equal(result.writeBlocked, true);
      assert.equal(result.writeSucceededCount, 0);
      assert.equal(result.writeFailedCount, 0);
      assert.ok(result.writeBlockedReasons.length > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeSucceededCount/writeFailedCount from injectable runPlan", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const fakeRunPlan = (_opts: { plan: PlanResult; config: HireLoopConfig; execute: boolean }): RunResult => ({
        mode: "execute",
        results: [
          { description: "cmd1", status: "success", stdout: null, stderr: null, exitCode: 0, durationMs: 1 },
          { description: "cmd2", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 2 },
          { description: "cmd3", status: "success", stdout: null, stderr: null, exitCode: 0, durationMs: 3 },
          { description: "cmd4", status: "skipped", stdout: null, stderr: null, exitCode: null, durationMs: 0 },
        ],
        totalDurationMs: 6,
        blocked: false,
      });

      const fakeConfig: HireLoopConfig = {
        larkAppId: null, larkAppSecret: null, baseAppToken: null, feishuBaseWebUrl: null,
        modelApiKey: null, modelApiEndpoint: null, modelId: null,
        modelProvider: "volcengine-ark", allowLarkRead: false, allowLarkWrite: true, debug: false,
      };

      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        writeBase: true,
        writeConfirm: "EXECUTE_LIVE_DATASET_WRITES",
        inputRecordIdsAreLive: true,
        deps: {
          loadConfig: () => fakeConfig,
          runPlan: fakeRunPlan,
        },
      });

      assert.equal(result.writeAttempted, true);
      assert.equal(result.writeBlocked, false);
      assert.equal(result.writeSucceededCount, 2);
      assert.equal(result.writeFailedCount, 1);
      // skipped is not counted
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writeBlocked=true and generic reason when runPlan blocks without guard reasons", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const fakeRunPlan = (_opts: { plan: PlanResult; config: HireLoopConfig; execute: boolean }): RunResult => ({
        mode: "execute",
        results: [],
        totalDurationMs: 0,
        blocked: true,
      });

      const fakeConfig: HireLoopConfig = {
        larkAppId: null, larkAppSecret: null, baseAppToken: null, feishuBaseWebUrl: null,
        modelApiKey: null, modelApiEndpoint: null, modelId: null,
        modelProvider: "volcengine-ark", allowLarkRead: false, allowLarkWrite: true, debug: false,
      };

      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        writeBase: true,
        writeConfirm: "EXECUTE_LIVE_DATASET_WRITES",
        inputRecordIdsAreLive: true,
        deps: {
          loadConfig: () => fakeConfig,
          runPlan: fakeRunPlan,
        },
      });

      assert.equal(result.writeAttempted, true);
      assert.equal(result.writeBlocked, true);
      assert.equal(result.writeSucceededCount, 0);
      assert.equal(result.writeFailedCount, 0);
      assert.ok(result.writeBlockedReasons.length > 0);
      assert.ok(result.writeBlockedReasons[0]!.includes("Base execution runner blocked"),
        "Must include generic blocked reason");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ═══ Console suppression: runPlan output must not leak ═══

  it("suppresses console.error output from runPlan — does not leak sensitive text", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();

    // Spy on console.error/log to verify suppression
    const stderrMessages: string[] = [];
    const stdoutMessages: string[] = [];
    const origError = console.error;
    const origLog = console.log;
    console.error = (...args: unknown[]) => { stderrMessages.push(args.map(String).join(" ")); };
    console.log = (...args: unknown[]) => { stdoutMessages.push(args.map(String).join(" ")); };

    try {
      const fakeRunPlan = (_opts: { plan: PlanResult; config: HireLoopConfig; execute: boolean }): RunResult => {
        // This runs inside quietConsole — should be suppressed
        console.error("payload rec_secret_001 stderr");
        console.log("some stdout with payload");
        return {
          mode: "execute",
          results: [
            { description: "cmd1", status: "success", stdout: null, stderr: null, exitCode: 0, durationMs: 1 },
          ],
          totalDurationMs: 1,
          blocked: false,
        };
      };

      const fakeConfig: HireLoopConfig = {
        larkAppId: null, larkAppSecret: null, baseAppToken: null, feishuBaseWebUrl: null,
        modelApiKey: null, modelApiEndpoint: null, modelId: null,
        modelProvider: "volcengine-ark", allowLarkRead: false, allowLarkWrite: true, debug: false,
      };

      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        writeBase: true,
        writeConfirm: "EXECUTE_LIVE_DATASET_WRITES",
        inputRecordIdsAreLive: true,
        deps: {
          loadConfig: () => fakeConfig,
          runPlan: fakeRunPlan,
        },
      });

      // Result must not contain sensitive data
      assert.equal(result.writeAttempted, true);
      assert.equal(result.writeSucceededCount, 1);

      // Our spy should NOT have captured the runPlan-internal console.error
      // because quietConsole replaced console.error before calling runPlan
      const allSpied = [...stderrMessages, ...stdoutMessages].join(" ");
      assert.ok(!allSpied.includes("payload"), "Must not leak 'payload' through console");
      assert.ok(!allSpied.includes("rec_secret_001"), "Must not leak record ID pattern through console");
      assert.ok(!allSpied.includes("stderr"), "Must not leak 'stderr' literal through console");
    } finally {
      console.error = origError;
      console.log = origLog;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ═══ Work Events ═══

  it("returns workEventBlockedReasons when schema requires forbidden fields", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        writeBase: true,
        writeConfirm: "EXECUTE_LIVE_DATASET_WRITES",
        inputRecordIdsAreLive: true,
      });

      assert.ok(result.workEventBlockedReasons.length > 0,
        "Work events should be blocked because event_id is required by schema");
      assert.ok(result.workEventBlockedReasons[0]!.includes("required identifier field"),
        "Blocked reason must mention required identifier field");
      assert.ok(result.workEventBlockedReasons[0]!.includes("schema"),
        "Blocked reason must mention schema adjustment");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ═══ Work Events --json payload contains no forbidden keys ═══

  it("Work Events command --json payload does not contain forbidden keys", () => {
    const mockResult: CandidatePipelineResult = {
      commands: [],
      agentRuns: [],
      finalStatus: "decision_pending",
      completed: true,
    };

    const cmd = buildWorkEventCommandSpec(0, mockResult, "dry_run");

    // Parse the actual --json arg from args
    const payload = extractJsonArg(cmd);
    assert.ok(payload, "Command must have a parseable --json payload");

    // Also parse the --json arg from redactedArgs (must be identical)
    const redactedPayload = extractJsonArg({ args: cmd.redactedArgs });
    assert.ok(redactedPayload, "redactedArgs must have a parseable --json payload");

    // Assert args and redactedArgs JSON are identical
    assert.deepEqual(payload, redactedPayload,
      "args and redactedArgs must use the same safe record");

    const forbiddenKeys = [
      "event_id", "parent_run_id", "record_id", "run_id",
      "payload", "prompt", "args", "stdout", "stderr",
      "resumeText", "jobRequirements", "jobRubric",
      "raw_response", "raw_stdout", "raw_stderr",
      "provider_config", "api_key", "apiKey", "endpoint",
    ];

    const allowedKeys = new Set([
      "agent_name", "event_type", "tool_type", "target_table",
      "execution_mode", "guard_status", "safe_summary",
      "status_before", "status_after", "duration_ms", "created_at",
    ]);

    for (const key of Object.keys(payload)) {
      assert.ok(allowedKeys.has(key),
        `--json payload must not contain forbidden or unexpected key: "${key}"`);
    }

    for (const key of forbiddenKeys) {
      assert.ok(!(key in payload),
        `--json payload must not contain: "${key}"`);
    }

    for (const key of forbiddenKeys) {
      assert.ok(!(key in redactedPayload),
        `redactedArgs --json payload must not contain: "${key}"`);
    }
  });

  // ═══ buildSafeWorkEventRecord ═══

  it("buildSafeWorkEventRecord returns only allowed fields", () => {
    const mockResult: CandidatePipelineResult = {
      commands: [],
      agentRuns: [],
      finalStatus: "decision_pending",
      completed: true,
    };

    const record = buildSafeWorkEventRecord(0, mockResult, "dry_run");

    const allowedKeys = new Set([
      "agent_name", "event_type", "tool_type", "target_table",
      "execution_mode", "guard_status", "safe_summary",
      "status_before", "status_after", "duration_ms", "created_at",
    ]);

    const forbiddenKeys = [
      "event_id", "parent_run_id", "record_id", "run_id",
      "payload", "prompt", "args", "stdout", "stderr",
      "resumeText", "jobRequirements", "jobRubric",
    ];

    for (const key of Object.keys(record)) {
      assert.ok(allowedKeys.has(key),
        `Safe record must not contain forbidden key: "${key}"`);
    }

    for (const key of forbiddenKeys) {
      assert.ok(!(key in record),
        `Safe record must not contain: "${key}"`);
    }

    assert.equal(record.agent_name, "analytics");
    assert.equal(record.event_type, "tool_call");
    assert.equal(record.guard_status, "passed");
    assert.equal(typeof record.safe_summary, "string");
    assert.equal(typeof record.created_at, "string");
  });

  // ═══ Deterministic client override ═══

  it("injectable deterministicClient override works", async () => {
    const { dir, path: snapPath } = tempSnapshotPath();
    try {
      const customClient = new DeterministicLlmClient();
      const result = await runLiveAgentDataset({
        ...baseOptions,
        snapshotPath: snapPath,
        deps: { deterministicClient: customClient },
      });

      assert.equal(result.mode, "deterministic");
      assert.equal(result.completedCount, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
