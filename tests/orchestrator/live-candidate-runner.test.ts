import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runLiveCandidateDryRun } from "../../src/orchestrator/live-candidate-runner.js";
import { getLiveLinkRegistry } from "../../src/server/live-link-registry.js";
import type { HireLoopConfig } from "../../src/config.js";
import type { CommandResult } from "../../src/base/read-only-runner.js";

function fakeConfig(overrides?: Partial<HireLoopConfig>): HireLoopConfig {
  return {
    larkAppId: null,
    larkAppSecret: null,
    baseAppToken: null,
    feishuBaseWebUrl: null,
    modelApiKey: null,
    modelApiEndpoint: null,
    modelId: null,
    modelProvider: "volcengine-ark",
    allowLarkRead: false,
    allowLarkWrite: false,
    debug: false,
    ...overrides,
  };
}

function readyConfig(): HireLoopConfig {
  return fakeConfig({
    larkAppId: "app-123",
    larkAppSecret: "sec-456",
    baseAppToken: "tok-789",
    allowLarkRead: true,
  });
}

function readyDeps() {
  return {
    loadConfig: () => readyConfig(),
    cliAvailable: () => true,
  };
}

function mockCandidateListStdout(): string {
  return JSON.stringify({
    items: [
      {
        record_id: "rec_cand_001",
        fields: {
          candidate_id: "cand_live_001",
          display_name: "张三",
          status: "new",
          resume_text: "AI PM with 6 years experience. Skills: SQL, Python, A/B testing.",
          job: [{ id: "rec_job_001", text: "AI 产品经理" }],
        },
      },
    ],
    total: 1,
  });
}

function mockJobsListStdout(): string {
  return JSON.stringify({
    items: [
      {
        record_id: "rec_job_001",
        fields: {
          job_id: "job_ai_pm_001",
          title: "岗位标题已改",
          department: "AI 产品部",
          requirements: "5+ years in product management. Experience with AI/ML products.",
          rubric: "Technical depth. Product sense. Communication.",
        },
      },
    ],
    total: 1,
  });
}

function mockExecutor(stdout: string): () => CommandResult {
  return () => ({
    description: "list",
    status: "success",
    stdout,
    stderr: null,
    exitCode: 0,
    durationMs: 10,
  });
}

function multiMockExecutor(...stdouts: string[]): () => CommandResult {
  let callCount = 0;
  return () => {
    const s = stdouts[callCount] ?? stdouts[stdouts.length - 1];
    callCount++;
    return {
      description: "list",
      status: "success",
      stdout: s ?? null,
      stderr: null,
      exitCode: 0,
      durationMs: 10,
    };
  };
}

function mockFailedExecutor(): () => CommandResult {
  return () => ({
    description: "list",
    status: "failed",
    stdout: null,
    stderr: "payload rec_secret_001 stderr",
    exitCode: 1,
    durationMs: 10,
  });
}

describe("live-candidate-runner", () => {
  beforeEach(() => {
    const snapPath = join(process.cwd(), "tmp", "latest-agent-runtime.json");
    if (existsSync(snapPath)) rmSync(snapPath);
  });

  it("unknown linkId returns blocked", async () => {
    const result = await runLiveCandidateDryRun("lnk_live_nonexistent");
    assert.equal(result.status, "blocked");
    assert.equal(result.externalModelCalls, false);
    assert.equal(result.realWrites, false);
    const json = JSON.stringify(result);
    assert.ok(!json.includes("rec_"), "must not contain rec_");
  });

  it("non-candidate link returns blocked", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("jobs", "rec_job_001");
    const result = await runLiveCandidateDryRun(linkId);
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("候选人"));
  });

  it("read env blocked does not call runner", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");
    const result = await runLiveCandidateDryRun(linkId, {
      loadConfig: () => fakeConfig(),
      cliAvailable: () => true,
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("只读未就绪"));
  });

  it("candidate missing resume_text fail closed", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_noresume");
    const noResumeStdout = JSON.stringify({
      items: [
        {
          record_id: "rec_cand_noresume",
          fields: {
            candidate_id: "cand_001",
            display_name: "李四",
            status: "new",
          },
        },
      ],
      total: 1,
    });

    const result = await runLiveCandidateDryRun(linkId, {
      ...readyDeps(),
      executor: mockExecutor(noResumeStdout),
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("缺少简历文本"));
  });

  it("missing job requirements/rubric fail closed", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");
    const noJobStdout = JSON.stringify({
      items: [
        {
          record_id: "rec_job_001",
          fields: {
            job_id: "job_001",
            title: "AI 产品经理",
          },
        },
      ],
      total: 1,
    });

    const result = await runLiveCandidateDryRun(linkId, {
      ...readyDeps(),
      executor: multiMockExecutor(mockCandidateListStdout(), noJobStdout),
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("岗位要求"));
  });

  it("executor failure returns blocked", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");

    const result = await runLiveCandidateDryRun(linkId, {
      ...readyDeps(),
      executor: mockFailedExecutor(),
    });
    assert.equal(result.status, "blocked");
    const json = JSON.stringify(result);
    assert.ok(!json.includes("payload"), "must not leak raw payload text");
    assert.ok(!json.includes("rec_secret_001"), "must not leak record ID from stderr");
    assert.ok(!json.includes("stdout"), "must not leak stdout");
  });

  it("suppresses read-only runner console output", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");
    const messages: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => { messages.push(args.map(String).join(" ")); };
    console.log = (...args: unknown[]) => { messages.push(args.map(String).join(" ")); };
    try {
      const result = await runLiveCandidateDryRun(linkId, {
        ...readyDeps(),
        executor: mockFailedExecutor(),
      });
      assert.equal(result.status, "blocked");
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
    const text = messages.join("\n");
    assert.ok(!text.includes("payload"), "must not leak payload through console");
    assert.ok(!text.includes("rec_secret_001"), "must not leak record ID through console");
    assert.ok(!text.includes("stderr"), "must not leak stderr through console");
  });

  it("full mock records runs deterministic pipeline successfully", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");

    const result = await runLiveCandidateDryRun(linkId, {
      ...readyDeps(),
      executor: multiMockExecutor(mockCandidateListStdout(), mockJobsListStdout()),
    });

    assert.equal(result.status, "success");
    assert.equal(result.externalModelCalls, false);
    assert.equal(result.realWrites, false);
    assert.equal(result.completed, true);
    assert.ok(result.agentRunCount > 0);
    assert.ok(result.commandCount > 0);
    assert.ok(result.snapshotUpdated);

    // Output safety
    const json = JSON.stringify(result);
    assert.ok(!json.includes("rec_cand_001"), "must not contain recordId");
    assert.ok(!json.includes("rec_job_001"), "must not contain job recordId");
    assert.ok(!json.includes("resume_text"), "must not contain resume_text field name");
    assert.ok(!json.includes("AI PM with 6 years"), "must not contain resume content");
    assert.ok(!json.includes("payload"), "must not contain payload");
    assert.ok(!json.includes("stdout"), "must not contain stdout");
    assert.ok(!json.includes("stderr"), "must not contain stderr");
    assert.ok(!json.includes("prompt"), "must not contain prompt");
  });
});
