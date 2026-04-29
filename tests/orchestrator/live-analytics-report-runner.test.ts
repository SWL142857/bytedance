import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HireLoopConfig } from "../../src/config.js";
import type { CommandExecutor } from "../../src/base/read-only-runner.js";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import {
  generateLiveAnalyticsReportPlan,
  executeLiveAnalyticsReport,
  validateLiveAnalyticsReportScope,
  LIVE_ANALYTICS_REPORT_CONFIRM,
  REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
} from "../../src/orchestrator/live-analytics-report-runner.js";

const READY_CONFIG: HireLoopConfig = {
  larkAppId: "cli_a_test",
  larkAppSecret: "secret",
  baseAppToken: "base_token",
  feishuBaseWebUrl: null,
  feishuTableWebUrls: {},
  modelApiKey: null,
  modelApiEndpoint: null,
  modelId: null,
  modelProvider: "volcengine-ark",
  allowLarkRead: true,
  allowLarkWrite: true,
  debug: false,
};

const NO_WRITE_CONFIG: HireLoopConfig = {
  ...READY_CONFIG,
  allowLarkWrite: false,
};

const NO_READ_CONFIG: HireLoopConfig = {
  ...READY_CONFIG,
  allowLarkRead: false,
};

function makeAnalyticsExecutor(options?: {
  candidateCount?: number;
  failTable?: string;
  failOnWrite?: boolean;
}): { executor: CommandExecutor; getWriteCount: () => number } {
  const candidateCount = options?.candidateCount ?? 2;
  let writeCount = 0;

  const executor: CommandExecutor = (_command, args) => {
    // Write commands
    if (args[1] === "+record-upsert") {
      writeCount += 1;
      if (options?.failOnWrite) {
        return { description: "", status: "failed", stdout: null, stderr: "write error", exitCode: 1, durationMs: 0 };
      }
      return { description: "", status: "success", stdout: "{}", stderr: null, exitCode: 0, durationMs: 0 };
    }

    // Read commands
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";

    if (options?.failTable && table?.toLowerCase().includes(options.failTable.toLowerCase())) {
      return { description: "", status: "failed", stdout: null, stderr: "read error", exitCode: 1, durationMs: 0 };
    }

    if (table === "Candidates" || table === "candidates") {
      const items = Array.from({ length: candidateCount }, (_, i) => ({
        id: `rec_cand_${i + 1}`,
        fields: {
          candidate_id: `cand_${String(i + 1).padStart(3, "0")}`,
          status: i === 0 ? "decision_pending" : "screened",
          screening_recommendation: i === 0 ? "strong_match" : "review_needed",
          talent_pool_candidate: i === 1,
        },
      }));
      return { description: "", status: "success", stdout: JSON.stringify({ items }), stderr: null, exitCode: 0, durationMs: 0 };
    }

    if (table === "Evaluations" || table === "evaluations") {
      const items = [
        {
          id: "rec_eval_001",
          fields: {
            candidate: [{ id: "rec_cand_1" }],
            dimension: "technical_depth",
            rating: "strong",
            recommendation: "strong_match",
            fairness_flags: "none",
            talent_pool_signal: null,
          },
        },
        {
          id: "rec_eval_002",
          fields: {
            candidate: [{ id: "rec_cand_2" }],
            dimension: "communication",
            rating: "medium",
            recommendation: "review_needed",
            fairness_flags: "none",
            talent_pool_signal: "promising",
          },
        },
      ];
      return { description: "", status: "success", stdout: JSON.stringify({ items }), stderr: null, exitCode: 0, durationMs: 0 };
    }

    if (table === "Agent Runs" || table === "agent_runs") {
      const items = [
        {
          id: "rec_run_001",
          fields: {
            agent_name: "Resume Parser",
            run_status: "success",
          },
        },
        {
          id: "rec_run_002",
          fields: {
            agent_name: "Screening",
            run_status: "success",
          },
        },
      ];
      return { description: "", status: "success", stdout: JSON.stringify({ items }), stderr: null, exitCode: 0, durationMs: 0 };
    }

    return { description: "", status: "success", stdout: JSON.stringify({ items: [] }), stderr: null, exitCode: 0, durationMs: 0 };
  };

  return { executor, getWriteCount: () => writeCount };
}

function makeEmptyCandidatesExecutor(): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";

    if (table === "Candidates" || table === "candidates") {
      return { description: "", status: "success", stdout: JSON.stringify({ items: [] }), stderr: null, exitCode: 0, durationMs: 0 };
    }
    return { description: "", status: "success", stdout: JSON.stringify({ items: [] }), stderr: null, exitCode: 0, durationMs: 0 };
  };
}

function makeBadScopeCommand(): BaseCommandSpec {
  return {
    description: 'Upsert record into "Candidates"',
    command: "lark-cli",
    args: [
      "base",
      "+record-upsert",
      "--base-token",
      "<BASE_APP_TOKEN>",
      "--table-id",
      "Candidates",
      "--record-id",
      "rec_bad_001",
      "--json",
      '{"status": "offer"}',
    ],
    redactedArgs: [],
    needsBaseToken: true,
    writesRemote: true,
  };
}

describe("live analytics report runner", () => {
  // ── generateLiveAnalyticsReportPlan ──

  it("generates a planned report with Reports + Agent Runs commands", async () => {
    const { executor } = makeAnalyticsExecutor();
    const plan = await generateLiveAnalyticsReportPlan({}, {
      loadConfig: () => READY_CONFIG,
      executor,
      cliAvailable: () => true,
    });

    assert.equal(plan.status, "planned");
    assert.equal(plan.blockedReasons.length, 0);
    assert.ok(plan.candidateCount > 0, "should have candidates");
    assert.ok(plan.evaluationCount > 0, "should have evaluations");
    assert.ok(plan.agentRunCount > 0, "should have agent runs");
    assert.ok(plan.commandCount > 0, "should have commands");
    assert.ok(plan.planNonce.length > 0, "should have planNonce");
    assert.ok(plan.periodStart.length > 0, "should have periodStart");
    assert.ok(plan.periodEnd.length > 0, "should have periodEnd");

    const targetTables = plan.commands.map((c) => c.targetTable);
    assert.ok(targetTables.includes("reports"), "should include Reports command");
    assert.ok(targetTables.includes("agent_runs"), "should include Agent Runs command");
  });

  it("returns needs_review when no candidates", async () => {
    const executor = makeEmptyCandidatesExecutor();
    const plan = await generateLiveAnalyticsReportPlan({}, {
      loadConfig: () => READY_CONFIG,
      executor,
      cliAvailable: () => true,
    });

    assert.equal(plan.status, "needs_review");
    assert.equal(plan.commandCount, 0);
    assert.equal(plan.candidateCount, 0);
    assert.ok(plan.blockedReasons.length > 0);
    assert.ok(plan.safeSummary.includes("候选人"));
  });

  it("returns blocked when Base is unreadable", async () => {
    const { executor } = makeAnalyticsExecutor({ failTable: "candidates" });
    const plan = await generateLiveAnalyticsReportPlan({}, {
      loadConfig: () => NO_READ_CONFIG,
      executor,
      cliAvailable: () => true,
    });

    assert.equal(plan.status, "blocked");
    assert.ok(plan.blockedReasons.length > 0);
  });

  it("changes planNonce when period changes", async () => {
    const { executor } = makeAnalyticsExecutor();
    const deps = { loadConfig: () => READY_CONFIG, executor, cliAvailable: () => true };

    const plan1 = await generateLiveAnalyticsReportPlan({ periodStart: "2026-04-01 00:00:00", periodEnd: "2026-04-07 23:59:59" }, deps);
    const plan2 = await generateLiveAnalyticsReportPlan({ periodStart: "2026-04-08 00:00:00", periodEnd: "2026-04-14 23:59:59" }, deps);

    assert.equal(plan1.status, "planned");
    assert.equal(plan2.status, "planned");
    assert.notEqual(plan1.planNonce, plan2.planNonce, "nonce should change when period changes");
  });

  it("changes planNonce when candidate count changes", async () => {
    const deps1 = { loadConfig: () => READY_CONFIG, executor: makeAnalyticsExecutor({ candidateCount: 1 }).executor, cliAvailable: () => true };
    const deps2 = { loadConfig: () => READY_CONFIG, executor: makeAnalyticsExecutor({ candidateCount: 3 }).executor, cliAvailable: () => true };

    const plan1 = await generateLiveAnalyticsReportPlan({}, deps1);
    const plan2 = await generateLiveAnalyticsReportPlan({}, deps2);

    assert.equal(plan1.status, "planned");
    assert.equal(plan2.status, "planned");
    assert.notEqual(plan1.planNonce, plan2.planNonce, "nonce should change when data changes");
  });

  // ── validateLiveAnalyticsReportScope ──

  it("validateLiveAnalyticsReportScope rejects Candidates table write", () => {
    const errors = validateLiveAnalyticsReportScope([makeBadScopeCommand()]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("候选人") || e.includes("Candidates") || e.includes("candidates")));
  });

  it("validateLiveAnalyticsReportScope rejects status transitions", () => {
    const cmd: BaseCommandSpec = {
      description: "Transition candidate status: screened -> decision_pending",
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "<BASE_APP_TOKEN>", "--table-id", "Candidates", "--json", "{}"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };
    const errors = validateLiveAnalyticsReportScope([cmd]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("状态转换")));
  });

  it("validateLiveAnalyticsReportScope rejects offer/rejected in payload", () => {
    const cmd: BaseCommandSpec = {
      description: 'Upsert record into "Candidates"',
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "<BASE_APP_TOKEN>", "--table-id", "Candidates", "--json", '{"status": "offer"}'],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };
    const errors = validateLiveAnalyticsReportScope([cmd]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("候选人") || e.includes("Candidates")));
  });

  it("validateLiveAnalyticsReportScope rejects Evaluations table write", () => {
    const cmd: BaseCommandSpec = {
      description: 'Upsert record into "Evaluations"',
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "<BASE_APP_TOKEN>", "--table-id", "Evaluations", "--json", "{}"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };
    const errors = validateLiveAnalyticsReportScope([cmd]);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes("Evaluations") || e.includes("evaluations")));
  });

  it("validateLiveAnalyticsReportScope accepts Reports and Agent Runs", () => {
    const reportsCmd: BaseCommandSpec = {
      description: 'Upsert record into "Reports"',
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "<BASE_APP_TOKEN>", "--table-id", "Reports", "--json", '{"report_id": "rpt_001", "period_start": "2026-04-01"}'],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };
    const agentRunsCmd: BaseCommandSpec = {
      description: 'Upsert record into "Agent Runs"',
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "<BASE_APP_TOKEN>", "--table-id", "Agent Runs", "--json", '{"agent_name": "Analytics", "run_status": "success"}'],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    };
    const errors = validateLiveAnalyticsReportScope([reportsCmd, agentRunsCmd]);
    assert.equal(errors.length, 0, `should accept Reports + Agent Runs, got: ${errors.join(", ")}`);
  });

  // ── executeLiveAnalyticsReport ──

  it("blocks when confirm is wrong", async () => {
    const result = await executeLiveAnalyticsReport({
      confirm: "wrong",
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: "abc123",
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.ok(result.safeSummary.includes("第一确认"));
  });

  it("blocks when reviewConfirm is wrong", async () => {
    let readCalled = false;
    const result = await executeLiveAnalyticsReport({
      confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
      reviewConfirm: "wrong",
      planNonce: "abc123",
      deps: {
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "must not read when reviewConfirm is wrong");
  });

  it("blocks when planNonce is empty", async () => {
    const result = await executeLiveAnalyticsReport({
      confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: "",
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.safeSummary.includes("planNonce"));
  });

  it("blocks on planNonce mismatch (TOCTOU guard)", async () => {
    const { executor } = makeAnalyticsExecutor();
    const result = await executeLiveAnalyticsReport({
      confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: "ffffffffffffffff",
      deps: {
        loadConfig: () => READY_CONFIG,
        executor,
        cliAvailable: () => true,
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.ok(result.safeSummary.includes("planNonce"), "must mention planNonce mismatch");
  });

  it("executes with injected executor when nonce matches", async () => {
    const mockExec = makeAnalyticsExecutor();
    const deps = {
      loadConfig: () => READY_CONFIG,
      executor: mockExec.executor,
      cliAvailable: () => true,
    };

    const plan = await generateLiveAnalyticsReportPlan({}, deps);
    assert.equal(plan.status, "planned");

    const result = await executeLiveAnalyticsReport({
      confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: plan.planNonce,
      deps,
    });

    assert.equal(result.status, "success");
    assert.equal(result.executed, true);
    assert.ok(result.successCount > 0);
    assert.equal(result.failedCount, 0);
  });

  it("stops execution on first write failure", async () => {
    const mockExec = makeAnalyticsExecutor({ failOnWrite: true });
    const deps = {
      loadConfig: () => READY_CONFIG,
      executor: mockExec.executor,
      cliAvailable: () => true,
    };

    const plan = await generateLiveAnalyticsReportPlan({}, deps);
    assert.equal(plan.status, "planned");

    const result = await executeLiveAnalyticsReport({
      confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: plan.planNonce,
      deps,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.executed, true);
    assert.ok(result.failedCount > 0);
    assert.ok(result.stoppedAtCommandIndex !== null);
  });

  it("blocks when config is invalid for writes", async () => {
    const mockExec = makeAnalyticsExecutor();
    const deps = {
      loadConfig: () => NO_WRITE_CONFIG,
      executor: mockExec.executor,
      cliAvailable: () => true,
    };

    const plan = await generateLiveAnalyticsReportPlan({}, deps);
    assert.equal(plan.status, "planned");

    const result = await executeLiveAnalyticsReport({
      confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: plan.planNonce,
      deps,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
  });

  it("blocks before read when confirm is wrong (not after)", async () => {
    let readCalled = false;
    const result = await executeLiveAnalyticsReport({
      confirm: "wrong_confirm",
      reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
      planNonce: "abc123",
      deps: {
        executor: () => {
          readCalled = true;
          return { description: "", status: "failed", stdout: null, stderr: null, exitCode: 1, durationMs: 0 };
        },
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.executed, false);
    assert.equal(readCalled, false, "must not read when confirm is wrong");
  });

  it("blocks when Base data becomes empty between plan and execute", async () => {
    let callCount = 0;
    const executor: CommandExecutor = (_command, args) => {
      if (args[1] === "+record-upsert") {
        return { description: "", status: "success", stdout: "{}", stderr: null, exitCode: 0, durationMs: 0 };
      }
      callCount += 1;
      const tableIdx = args.indexOf("--table-id");
      const table = tableIdx >= 0 ? args[tableIdx + 1] : "";

      // First call (plan): return candidates. Second call (execute): return empty
      if ((table === "Candidates" || table === "candidates") && callCount > 3) {
        return { description: "", status: "success", stdout: JSON.stringify({ items: [] }), stderr: null, exitCode: 0, durationMs: 0 };
      }

      // Default: return data
      if (table === "Candidates" || table === "candidates") {
        return {
          description: "", status: "success",
          stdout: JSON.stringify({ items: [{ id: "rec_c1", fields: { candidate_id: "c001", status: "screened" } }] }),
          stderr: null, exitCode: 0, durationMs: 0,
        };
      }
      return { description: "", status: "success", stdout: JSON.stringify({ items: [] }), stderr: null, exitCode: 0, durationMs: 0 };
    };

    const deps = { loadConfig: () => READY_CONFIG, executor, cliAvailable: () => true };
    const plan = await generateLiveAnalyticsReportPlan({}, deps);

    if (plan.status === "planned") {
      const result = await executeLiveAnalyticsReport({
        confirm: LIVE_ANALYTICS_REPORT_CONFIRM,
        reviewConfirm: REVIEWED_ANALYTICS_REPORT_PLAN_CONFIRM,
        planNonce: plan.planNonce,
        deps,
      });
      // Either blocked (data gone) or blocked (nonce mismatch)
      assert.ok(result.status === "blocked" || result.status === "failed");
      assert.equal(result.executed, false);
    }
  });
});
