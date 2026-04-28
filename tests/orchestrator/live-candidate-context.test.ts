import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HireLoopConfig } from "../../src/config.js";
import type { CommandExecutor } from "../../src/base/read-only-runner.js";
import { getLiveLinkRegistry } from "../../src/server/live-link-registry.js";
import {
  readLiveCandidateContext,
  type LiveCandidateDeps,
} from "../../src/orchestrator/live-candidate-context.js";

const READY_CONFIG: HireLoopConfig = {
  larkAppId: "cli_test",
  larkAppSecret: "secret",
  baseAppToken: "base_token",
  feishuBaseWebUrl: null,
  feishuTableWebUrls: {},
  modelApiKey: null,
  modelApiEndpoint: null,
  modelId: null,
  modelProvider: "volcengine-ark",
  allowLarkRead: true,
  allowLarkWrite: false,
  debug: false,
};

function makeCandidateOnlyExecutor(candidateRecordId: string, resumeText: string): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const stdout = table === "Candidates"
      ? JSON.stringify({
          items: [{
            id: candidateRecordId,
            fields: {
              display_name: "Alice Candidate",
              candidate_id: "cand_test_001",
              resume_text: resumeText,
            },
          }],
        })
      : JSON.stringify({ items: [] });
    return { description: "", status: "success", stdout, stderr: null, exitCode: 0, durationMs: 0 };
  };
}

function makeFullExecutor(candidateRecordId: string, resumeText: string, jobRecordId = "rec_job_001"): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const stdout = table === "Candidates"
      ? JSON.stringify({
          items: [{
            id: candidateRecordId,
            fields: {
              display_name: "Alice Candidate",
              candidate_id: "cand_test_001",
              resume_text: resumeText,
              job: [{ id: jobRecordId }],
            },
          }],
        })
      : JSON.stringify({
          items: [{
            id: jobRecordId,
            fields: {
              title: "AI PM",
              job_id: "job_ai_pm",
              requirements: "5 years PM, AI products, data-driven.",
              rubric: "technical depth, product sense, communication",
            },
          }],
        });
    return { description: "", status: "success", stdout, stderr: null, exitCode: 0, durationMs: 0 };
  };
}

function makeFullExecutorNoRubric(candidateRecordId: string, resumeText: string, jobRecordId = "rec_job_001"): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const stdout = table === "Candidates"
      ? JSON.stringify({
          items: [{
            id: candidateRecordId,
            fields: {
              display_name: "Bob",
              candidate_id: "cand_test_002",
              resume_text: resumeText,
              job: [{ id: jobRecordId }],
            },
          }],
        })
      : JSON.stringify({
          items: [{
            id: jobRecordId,
            fields: {
              title: "PM",
              job_id: "job_pm",
              requirements: "3 years PM.",
            },
          }],
        });
    return { description: "", status: "success", stdout, stderr: null, exitCode: 0, durationMs: 0 };
  };
}

function makeNoResumeExecutor(candidateRecordId: string): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const stdout = table === "Candidates"
      ? JSON.stringify({
          items: [{
            id: candidateRecordId,
            fields: {
              display_name: "No Resume",
              candidate_id: "cand_no_resume",
            },
          }],
        })
      : JSON.stringify({ items: [] });
    return { description: "", status: "success", stdout, stderr: null, exitCode: 0, durationMs: 0 };
  };
}

function makeFailingExecutor(): CommandExecutor {
  return () => ({
    description: "",
    status: "failed",
    stdout: null,
    stderr: "lark-cli error",
    exitCode: 1,
    durationMs: 0,
  });
}

function registerCandidate(recordId: string): string {
  return getLiveLinkRegistry().register("candidates", recordId);
}

describe("live candidate context", () => {
  const readyDeps: LiveCandidateDeps = {
    loadConfig: () => READY_CONFIG,
    cliAvailable: () => true,
  };

  // ── Blocked paths ──

  it("blocks on unknown linkId", async () => {
    const result = await readLiveCandidateContext("lnk_live_nonexistent");
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("未找到"));
  });

  it("blocks on non-candidate link", async () => {
    const linkId = getLiveLinkRegistry().register("jobs", "rec_job_001");
    const result = await readLiveCandidateContext(linkId);
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("候选人"));
  });

  it("blocks when Base is unavailable", async () => {
    const linkId = registerCandidate("rec_blocked_base");
    const result = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: {
        ...readyDeps,
        cliAvailable: () => false,
      },
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("飞书只读未就绪"));
  });

  it("blocks when candidate read fails", async () => {
    const linkId = registerCandidate("rec_read_fail");
    const result = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...readyDeps, executor: makeFailingExecutor() },
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("无法读取飞书候选人数据"));
  });

  it("blocks when candidate not found in fetched records", async () => {
    // Register a different recordId than what the executor returns
    const linkId = registerCandidate("rec_not_in_list");
    const result = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...readyDeps, executor: makeCandidateOnlyExecutor("rec_other", "some resume") },
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("未在飞书中找到"));
  });

  it("blocks when resumeText is missing", async () => {
    const recordId = "rec_no_resume";
    const linkId = registerCandidate(recordId);
    const result = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...readyDeps, executor: makeNoResumeExecutor(recordId) },
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("缺少简历文本"));
  });

  // ── Candidate-only mode (requireJob: false) ──

  it("returns ok with candidate-only mode (requireJob: false)", async () => {
    const recordId = "rec_candidate_only";
    const linkId = registerCandidate(recordId);
    const result = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...readyDeps, executor: makeCandidateOnlyExecutor(recordId, "AI PM with six years experience.") },
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") throw new Error("expected ok");
    assert.equal(result.context.candidateRecordId, recordId);
    assert.equal(result.context.candidateId, "cand_test_001");
    assert.equal(result.context.candidateDisplayName, "Alice Candidate");
    assert.ok(result.context.resumeText.length > 0);
    // Job fields should be null since executor returns empty jobs
    assert.equal(result.context.jobRequirements, null);
    assert.equal(result.context.jobRubric, null);
    assert.equal(result.context.jobRecordId, null);
  });

  it("requireJob: false does not block when job is missing", async () => {
    const recordId = "rec_no_job_ok";
    const linkId = registerCandidate(recordId);
    // Executor only returns candidate, not job
    const result = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...readyDeps, executor: makeCandidateOnlyExecutor(recordId, "Resume text here.") },
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") throw new Error("expected ok");
    assert.equal(result.context.jobRequirements, null);
  });

  // ── Candidate+job mode (requireJob: true, default) ──

  it("returns ok with candidate+job mode (requireJob: true)", async () => {
    const recordId = "rec_full_context";
    const linkId = registerCandidate(recordId);
    const result = await readLiveCandidateContext(linkId, {
      requireJob: true,
      deps: { ...readyDeps, executor: makeFullExecutor(recordId, "AI PM with six years experience.") },
    });

    assert.equal(result.status, "ok");
    if (result.status !== "ok") throw new Error("expected ok");
    assert.equal(result.context.candidateRecordId, recordId);
    assert.equal(result.context.candidateId, "cand_test_001");
    assert.ok(result.context.resumeText.length > 0);
    assert.equal(result.context.jobRecordId, "rec_job_001");
    assert.equal(result.context.jobId, "job_ai_pm");
    assert.ok(result.context.jobRequirements!.length > 0);
    assert.ok(result.context.jobRubric!.length > 0);
    assert.equal(result.context.jobDisplayName, "AI PM");
  });

  it("requireJob: true blocks when job rubric is missing", async () => {
    const recordId = "rec_missing_rubric";
    const linkId = registerCandidate(recordId);
    const result = await readLiveCandidateContext(linkId, {
      requireJob: true,
      deps: { ...readyDeps, executor: makeFullExecutorNoRubric(recordId, "Resume text.") },
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("岗位要求或评分标准"));
  });

  it("context is consistent across repeated reads with same data", async () => {
    const recordId = "rec_consistent";
    const linkId = registerCandidate(recordId);
    const deps = { ...readyDeps, executor: makeFullExecutor(recordId, "Consistent resume.") };

    const first = await readLiveCandidateContext(linkId, { requireJob: true, deps });
    const second = await readLiveCandidateContext(linkId, { requireJob: true, deps });

    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    assert.equal(first.context.candidateId, second.context.candidateId);
    assert.equal(first.context.resumeText, second.context.resumeText);
    assert.equal(first.context.jobRequirements, second.context.jobRequirements);
  });

  it("different resume produces different context", async () => {
    const recordId = "rec_diff_resume";
    const linkId = registerCandidate(recordId);
    const deps: LiveCandidateDeps = readyDeps;

    const first = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...deps, executor: makeCandidateOnlyExecutor(recordId, "Short resume.") },
    });
    const second = await readLiveCandidateContext(linkId, {
      requireJob: false,
      deps: { ...deps, executor: makeCandidateOnlyExecutor(recordId, "Longer more detailed resume.") },
    });

    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    assert.notEqual(first.context.resumeText, second.context.resumeText);
  });
});
