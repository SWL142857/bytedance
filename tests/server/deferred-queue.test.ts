import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  enqueueCandidateGraphRefresh,
  enqueueCandidateIntake,
  enqueueOperatorRequest,
  listDeferredQueue,
  processDeferredQueue,
} from "../../src/server/deferred-queue.js";

function makeDeps() {
  const dir = mkdtempSync(join(tmpdir(), "hireloop-deferred-queue-"));
  const queuePath = join(dir, "queue.json");
  return {
    dir,
    deps: {
      queuePath,
      now: () => "2026-05-06T10:00:00.000Z",
    },
  };
}

describe("deferred queue", () => {
  it("queues operator requests without processing graph", () => {
    const { dir, deps } = makeDeps();
    try {
      const queued = enqueueOperatorRequest(
        {
          title: "暂停实时建图",
          content: "先保存需求，本轮不要更新图，之后再集中处理。",
          requestedBy: "operator",
        },
        deps,
      );
      assert.equal(queued.status, "queued");
      assert.equal(queued.pending, 1);

      const overview = listDeferredQueue(deps);
      assert.equal(overview.total, 1);
      assert.equal(overview.pending, 1);
      assert.equal(overview.items[0]?.kind, "operator_request");
      assert.equal(overview.items[0]?.safe_label, "暂停实时建图");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("candidate intake view does not leak raw resume text", () => {
    const { dir, deps } = makeDeps();
    try {
      enqueueCandidateIntake(
        {
          displayName: "张三",
          jobTitle: "AI 产品经理",
          resumeText: "Confidential local resume text",
          jobRequirements: "5 年产品经验",
          jobRubric: "沟通、产品 sense、AI 背景",
        },
        deps,
      );

      const overview = listDeferredQueue(deps);
      const json = JSON.stringify(overview);
      assert.ok(!json.includes("Confidential local resume text"));
      assert.equal(overview.items[0]?.kind, "candidate_intake");
      assert.match(overview.items[0]?.safe_summary ?? "", /等待集中建图/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("processes request-only queue without snapshot update", async () => {
    const { dir, deps } = makeDeps();
    try {
      enqueueOperatorRequest(
        {
          title: "只保存询问",
          content: "这个时间段只先记录，不做图处理。",
        },
        deps,
      );

      const result = await processDeferredQueue({}, deps);
      assert.equal(result.totalMatched, 1);
      assert.equal(result.processedCount, 1);
      assert.equal(result.requestOnlyCount, 1);
      assert.equal(result.snapshotUpdated, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("processes candidate graph refresh with injected runner and writes snapshot", async () => {
    const { dir, deps } = makeDeps();
    try {
      enqueueCandidateGraphRefresh(
        {
          linkId: "lnk_live_candidate_001",
          displayName: "李四",
        },
        deps,
      );

      let snapshotWritten = false;
      const result = await processDeferredQueue(
        {},
        {
          ...deps,
          readLiveCandidateContext: async () => ({
            status: "ok",
            context: {
              linkId: "lnk_live_candidate_001",
              entry: {
                linkId: "lnk_live_candidate_001",
                table: "candidates",
                recordId: "rec_candidate_001",
                createdAt: Date.now(),
              },
              config: {
                larkAppId: null,
                larkAppSecret: null,
                baseAppToken: null,
                feishuBaseWebUrl: null,
                feishuTableWebUrls: {},
                modelApiKey: null,
                modelApiEndpoint: null,
                modelId: null,
                modelProvider: "volcengine-ark",
                allowLarkRead: false,
                allowLarkWrite: false,
                debug: false,
              },
              candidateRecordId: "rec_candidate_001",
              candidateId: "cand_001",
              candidateDisplayName: "李四",
              candidateStatus: "new",
              resumeText: "safe resume",
              jobRecordId: "rec_job_001",
              jobId: "job_001",
              jobRequirements: "requirements",
              jobRubric: "rubric",
              jobDisplayName: "AI 产品经理",
            },
          }),
          runCandidatePipeline: async () => ({
            commands: [],
            agentRuns: [],
            finalStatus: "decision_pending",
            completed: true,
          }),
          writeRuntimeDashboardSnapshot: () => {
            snapshotWritten = true;
          },
        },
      );

      assert.equal(result.totalMatched, 1);
      assert.equal(result.processedCount, 1);
      assert.equal(result.failedCount, 0);
      assert.equal(result.snapshotUpdated, true);
      assert.equal(snapshotWritten, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
