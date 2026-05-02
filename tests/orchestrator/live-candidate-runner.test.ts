import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runLiveCandidateDryRun } from "../../src/orchestrator/live-candidate-runner.js";
import { runLiveCandidateProviderAgentDemo } from "../../src/orchestrator/live-candidate-runner.js";
import { getLiveLinkRegistry } from "../../src/server/live-link-registry.js";
import type { HireLoopConfig } from "../../src/config.js";
import type { CommandResult } from "../../src/base/read-only-runner.js";
import type { LlmRequest } from "../../src/llm/client.js";

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

function providerReadyConfig(): HireLoopConfig {
  return {
    ...readyConfig(),
    modelApiKey: "sk-test-secret",
    modelApiEndpoint: "https://api.test.example.com/v1",
    modelId: "ep-test-model",
  };
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

function providerFetchOk() {
  return async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = body.messages?.[0]?.content ?? "";
    const content = buildProviderResponseForPrompt(prompt);
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function buildProviderResponseForPrompt(prompt: string): string {
  if (prompt.includes("Extraction Agent")) {
    return JSON.stringify({
      skills: [
        { name: "SQL", canonicalName: "SQL", confidence: 0.95, evidence: "SQL and Python" },
        { name: "Python", canonicalName: "Python", confidence: 0.9, evidence: "SQL and Python" },
      ],
      features: [
        { featureType: "experience", featureName: "PM Experience", canonicalName: "PM Experience", featureValue: "6 years", confidence: 0.9, evidence: "6 years experience" },
      ],
      profile: {
        yearsOfExperience: "6",
        educationLevel: "unknown",
        industryBackground: "AI products",
        leadershipLevel: "senior",
        communicationLevel: "proficient",
        systemDesignLevel: "proficient",
        structuredSummary: "Provider extracted profile for AI product candidate.",
      },
    });
  }
  if (prompt.includes("Graph Builder Agent")) {
    return JSON.stringify({
      shouldLink: true,
      linkReason: "Shared AI product and data signals.",
      sharedSignals: ["SQL", "Python"],
    });
  }
  if (prompt.includes("Generate interview kit")) {
    return JSON.stringify({
      questions: [
        { question: "How would you evaluate an AI product launch?", purpose: "Assess product judgment", followUps: ["Which metrics matter?"] },
      ],
      scorecardDimensions: ["product_judgment", "data_depth"],
      focusAreas: ["AI product metrics"],
      riskChecks: ["Validate hands-on experience"],
    });
  }
  if (prompt.includes("Reviewer Agent")) {
    return JSON.stringify({
      decisionPred: "select",
      confidence: 0.82,
      reasonLabel: "Provider Graph Fit",
      reasonGroup: "skill_match",
      reviewSummary: "Provider preview found strong AI product and data fit.",
    });
  }
  return JSON.stringify({
    handoffSummary: "Provider preview completed and awaits human decision.",
    nextStep: "human_decision",
    coordinatorChecklist: ["Review generated plan", "Confirm human decision"],
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

  it("provider preview runs full P3 pipeline and updates provider snapshot", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");

    const originalFetch = globalThis.fetch;
    const calls: LlmRequest[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ content?: string }>;
      };
      calls.push({
        promptTemplateId: "unknown",
        prompt: body.messages?.[0]?.content ?? "",
      });
      return providerFetchOk()(url, init);
    }) as typeof fetch;
    try {
      const result = await runLiveCandidateProviderAgentDemo(linkId, {
        confirm: "EXECUTE_PROVIDER_AGENT_DEMO",
        deps: {
          loadConfig: () => providerReadyConfig(),
          cliAvailable: () => true,
          executor: multiMockExecutor(mockCandidateListStdout(), mockJobsListStdout()),
        },
      });

      assert.equal(result.status, "success");
      assert.equal(result.completed, true);
      assert.equal(result.finalStatus, "decision_pending");
      assert.equal(result.agentRunCount, 6);
      assert.equal(result.commandCount, 16);
      assert.equal(result.canCallExternalModel, true);
      assert.equal(result.realWrites, false);
      assert.equal(result.snapshotUpdated, true);
      assert.equal(calls.length, 5);

      const json = JSON.stringify(result);
      assert.ok(!json.includes("sk-test-secret"), "must not leak api key");
      assert.ok(!json.includes("api.test.example.com"), "must not leak endpoint");
      assert.ok(!json.includes("ep-test-model"), "must not leak model id");
      assert.ok(!json.includes("rec_cand_001"), "must not leak candidate record id");
      assert.ok(!json.includes("AI PM with 6 years"), "must not leak resume text");
      assert.ok(!json.includes("prompt"), "must not expose prompt field");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("provider preview blocks without provider config before model calls", async () => {
    const reg = getLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_cand_001");
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const result = await runLiveCandidateProviderAgentDemo(linkId, {
        confirm: "EXECUTE_PROVIDER_AGENT_DEMO",
        deps: {
          loadConfig: () => readyConfig(),
          cliAvailable: () => true,
          executor: multiMockExecutor(mockCandidateListStdout(), mockJobsListStdout()),
        },
      });

      assert.equal(result.status, "blocked");
      assert.equal(result.canCallExternalModel, false);
      assert.equal(result.realWrites, false);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
