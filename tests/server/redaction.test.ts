import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactAgentRun,
  redactCommand,
  redactPipelineResult,
  redactReleaseGate,
  redactApiBoundaryAudit,
  redactProviderReadiness,
  redactProviderSmoke,
  redactProviderAgentDemo,
  redactPreApiFreeze,
  redactLiveReadiness,
  redactWorkEvent,
  redactWorkEvents,
  buildSafeLinkForWorkEvent,
  redactSafeText,
  containsSensitivePattern,
} from "../../src/server/redaction.js";
import type { WorkEvent } from "../../src/types/work-event.js";
import type { AgentRunRecord } from "../../src/base/runtime.js";
import type { BaseCommandSpec } from "../../src/base/commands.js";
import type { CandidatePipelineResult } from "../../src/orchestrator/candidate-pipeline.js";
import type { MvpReleaseGateReport } from "../../src/orchestrator/mvp-release-gate.js";
import type { ApiBoundaryAuditReport } from "../../src/orchestrator/api-boundary-release-audit.js";
import type { ProviderAdapterReadiness } from "../../src/llm/provider-adapter.js";
import type { ProviderSmokeResult } from "../../src/llm/provider-smoke-runner.js";
import type { ProviderAgentDemoResult } from "../../src/llm/provider-agent-demo-runner.js";
import type { PreApiFreezeReport } from "../../src/orchestrator/pre-api-freeze-report.js";
import type { LiveReadinessReport } from "../../src/orchestrator/live-readiness-report.js";

describe("redactAgentRun", () => {
  it("strips sensitive fields, redacts rec* entity_ref", () => {
    const run: AgentRunRecord = {
      run_id: "run_001",
      agent_name: "ResumeParser",
      entity_type: "candidate",
      entity_ref: "rec_abc123",
      input_summary: "Parsed resume for candidate",
      output_json: '{"skills":["Python","SQL"]}',
      run_status: "success",
      status_before: "new",
      status_after: "parsed",
      error_message: "some error",
      prompt_template_id: "resume-parser-v1",
      git_commit_hash: "abc1234",
      prompt_hash: "hash123",
      retry_count: 0,
      duration_ms: 120,
    };
    const safe = redactAgentRun(run);
    assert.equal(safe.agent_name, "ResumeParser");
    assert.equal(safe.entity_ref, "[已脱敏]");
    assert.equal(safe.run_status, "success");
    assert.equal(safe.status_before, "new");
    assert.equal(safe.status_after, "parsed");
    assert.equal(safe.retry_count, 0);
    assert.equal(safe.duration_ms, 120);
    assert.equal(Object.keys(safe).length, 9);
    assert.ok(!("output_json" in safe));
    assert.ok(!("error_message" in safe));
    assert.ok(!("prompt_template_id" in safe));
    assert.ok(!("run_id" in safe));
    assert.ok(!("git_commit_hash" in safe));
    assert.ok(!("prompt_hash" in safe));
  });

  it("redacts application-side IDs same as rec_ IDs", () => {
    const run: AgentRunRecord = {
      run_id: "run_002",
      agent_name: "Screening",
      entity_type: "candidate",
      entity_ref: "cand_demo_001",
      input_summary: "candidateId=cand_demo_001 jobId=job_demo_ai_pm_001 status=parsed",
      run_status: "success",
      status_before: "parsed",
      status_after: "screened",
      prompt_template_id: "screening-v1",
      git_commit_hash: "abc1234",
      retry_count: 0,
      duration_ms: 80,
    };
    const safe = redactAgentRun(run);
    assert.equal(safe.entity_ref, "[已脱敏]");
    assert.ok(!safe.input_summary.includes("cand_demo_"), "input_summary must not contain cand_demo_ IDs");
    assert.ok(!safe.input_summary.includes("job_demo_"), "input_summary must not contain job_demo_ IDs");
  });
});

describe("redactCommand", () => {
  it("keeps only description", () => {
    const cmd: BaseCommandSpec = {
      command: "+record-upsert",
      args: ["--base-token", "secret123", "--table", "Candidates"],
      redactedArgs: ["--base-token", "[redacted]", "--table", "Candidates"],
      description: "Create candidate record",
      needsBaseToken: true,
      writesRemote: true,
    };
    const safe = redactCommand(cmd);
    assert.deepEqual(safe, { description: "Create candidate record" });
  });
});

describe("redactPipelineResult", () => {
  it("returns safe pipeline view with redacted commands and agent runs", () => {
    const result: CandidatePipelineResult = {
      finalStatus: "decision_pending",
      completed: true,
      commands: [
        {
          command: "+record-upsert",
          args: ["--json", '{"fields":{}}'],
          redactedArgs: ["--json", "[redacted]"],
          description: "Update candidate status",
          needsBaseToken: true,
          writesRemote: true,
        },
      ],
      agentRuns: [
        {
          run_id: "run_003",
          agent_name: "ResumeParser",
          entity_type: "candidate",
          entity_ref: "rec_abc",
          input_summary: "Parse resume",
          output_json: '{"skills":[]}',
          run_status: "success",
          status_before: "new",
          status_after: "parsed",
          prompt_template_id: "v1",
          git_commit_hash: "abc1234",
          retry_count: 0,
          duration_ms: 50,
        },
      ],
      failedAgent: undefined,
    };
    const safe = redactPipelineResult(result);
    assert.equal(safe.finalStatus, "decision_pending");
    assert.equal(safe.completed, true);
    assert.equal(safe.commandCount, 1);
    assert.equal(safe.failedAgent, null);
    assert.equal(safe.commands.length, 1);
    assert.equal(safe.commands[0]!.description, "Update candidate status");
    assert.ok(!("args" in safe.commands[0]!));
    assert.ok(!("redactedArgs" in safe.commands[0]!));
    assert.equal(safe.agentRuns.length, 1);
    assert.equal(safe.agentRuns[0]!.entity_ref, "[已脱敏]");
  });
});

describe("redactReleaseGate", () => {
  it("passes through report unchanged", () => {
    const report: MvpReleaseGateReport = {
      title: "MVP Release Gate",
      status: "ready_for_demo",
      localDemoReady: true,
      liveSafetyReady: true,
      realWritePermittedByReport: false,
      externalModelCallPermittedByReport: false,
      checks: [],
      recommendedDemoCommands: [],
      finalHandoffNote: "",
    };
    assert.deepEqual(redactReleaseGate(report), report);
  });
});

describe("redactApiBoundaryAudit", () => {
  it("passes through report unchanged", () => {
    const report: ApiBoundaryAuditReport = {
      title: "API Boundary Release Audit",
      status: "ready",
      defaultExternalModelCallsPermittedByReport: false,
      realBaseWritesPermittedByReport: false,
      providerSmokeGuarded: true,
      providerAgentDemoGuarded: true,
      baseWriteGuardIndependent: true,
      deterministicDemoSafe: true,
      outputRedactionSafe: true,
      forbiddenTraceScanPassed: true,
      secretScanPassed: true,
      releaseGateConsistent: true,
      checks: [],
      recommendedCommands: [],
      finalNote: "",
    };
    assert.deepEqual(redactApiBoundaryAudit(report), report);
  });
});

describe("redactProviderReadiness", () => {
  it("passes through readiness unchanged", () => {
    const readiness: ProviderAdapterReadiness = {
      status: "disabled",
      providerName: "volcengine-ark",
      canCallExternalModel: false,
      blockedReasons: [],
      safeSummary: "Provider adapter is disabled.",
    };
    assert.deepEqual(redactProviderReadiness(readiness), readiness);
  });
});

describe("redactProviderSmoke", () => {
  it("passes through result unchanged", () => {
    const result: ProviderSmokeResult = {
      mode: "dry_run",
      status: "planned",
      providerName: "volcengine-ark",
      canCallExternalModel: false,
      httpStatus: null,
      hasChoices: null,
      contentLength: null,
      durationMs: 0,
      blockedReasons: [],
      errorKind: null,
      safeSummary: "Dry run plan.",
    };
    assert.deepEqual(redactProviderSmoke(result), result);
  });
});

describe("redactProviderAgentDemo", () => {
  it("passes through result unchanged", () => {
    const result: ProviderAgentDemoResult = {
      mode: "dry_run",
      status: "planned",
      providerName: "volcengine-ark",
      canCallExternalModel: false,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: [],
      safeSummary: "Dry run plan.",
    };
    assert.deepEqual(redactProviderAgentDemo(result), result);
  });
});

describe("redactPreApiFreeze", () => {
  it("passes through report unchanged", () => {
    const report: PreApiFreezeReport = {
      title: "Pre-API Freeze Report",
      status: "frozen",
      apiIntegrationAllowed: true,
      externalModelCallAllowedByReport: false,
      realBaseWriteAllowedByReport: false,
      checks: [],
      allowedNextChanges: [],
      blockedChanges: [],
      finalNote: "",
    };
    assert.deepEqual(redactPreApiFreeze(report), report);
  });
});

describe("redactLiveReadiness", () => {
  it("passes through report unchanged", () => {
    const report: LiveReadinessReport = {
      mode: "readonly",
      ready: false,
      checkedAt: "2026-01-01T00:00:00Z",
      checks: [],
      resolutionMode: "sample",
      resolvedRecordCount: 0,
      requiredRecordCount: 2,
      plannedWriteCount: 0,
      safeToExecuteLiveWrites: false,
      nextStep: "Configure environment.",
    };
    assert.deepEqual(redactLiveReadiness(report), report);
  });
});

describe("redactWorkEvent", () => {
  const baseEvent: WorkEvent = {
    event_id: "evt_demo_001",
    agent_name: "HR 协调",
    event_type: "tool_call",
    tool_type: "record_list",
    target_table: "candidates",
    execution_mode: "dry_run",
    guard_status: "passed",
    safe_summary: "HR 协调加载候选人待处理队列",
    status_before: null,
    status_after: "new",
    duration_ms: 42,
    parent_run_id: "run_demo_hr_001",
    link_status: "demo_only",
    created_at: "2026-04-27T09:01:00.000Z",
  };

  it("strips event_id and parent_run_id", () => {
    const safe = redactWorkEvent(baseEvent);
    const record = safe as unknown as Record<string, unknown>;
    assert.ok(!("event_id" in record));
    assert.ok(!("parent_run_id" in record));
  });

  it("redacts sensitive substrings inside safe_summary", () => {
    const event: WorkEvent = {
      ...baseEvent,
      safe_summary: "ran with rec_abc123 and payload preview",
    };
    const safe = redactWorkEvent(event);
    assert.ok(!safe.safe_summary.includes("rec_abc123"));
    assert.ok(!safe.safe_summary.includes("payload"));
    assert.match(safe.safe_summary, /\[已脱敏\]/);
  });

  it("rejects unsafe target_table by returning null", () => {
    const event: WorkEvent = { ...baseEvent, target_table: "tbl_secret_internal" };
    const safe = redactWorkEvent(event);
    assert.equal(safe.target_table, null);
  });

  it("clamps invalid duration to 0", () => {
    const event: WorkEvent = { ...baseEvent, duration_ms: -42 };
    const safe = redactWorkEvent(event);
    assert.equal(safe.duration_ms, 0);
  });

  it("normalizes invalid execution_mode to blocked", () => {
    const event = { ...baseEvent, execution_mode: "anything-weird" } as unknown as WorkEvent;
    const safe = redactWorkEvent(event);
    assert.equal(safe.execution_mode, "blocked");
  });
});

describe("buildSafeLinkForWorkEvent", () => {
  const baseEvent: WorkEvent = {
    event_id: "evt_demo_007",
    agent_name: "HR 协调",
    event_type: "human_action",
    tool_type: null,
    target_table: "candidates",
    execution_mode: "dry_run",
    guard_status: null,
    safe_summary: "推进到待决策节点",
    status_before: null,
    status_after: null,
    duration_ms: 50,
    parent_run_id: "run_demo_hr_002",
    link_status: "demo_only",
    created_at: "2026-04-27T09:00:00.000Z",
  };

  it("returns null for no_link", () => {
    const event: WorkEvent = { ...baseEvent, link_status: "no_link" };
    assert.equal(buildSafeLinkForWorkEvent(event), null);
  });

  it("returns demo link with available=false for demo_only", () => {
    const link = buildSafeLinkForWorkEvent(baseEvent);
    assert.ok(link, "demo_only event should have a link");
    assert.equal(link!.available, false);
    assert.match(link!.link_id, /^lnk_demo_\d{3}$/);
    assert.equal(link!.link_label, "查看飞书记录");
  });

  it("infers candidate link type from target_table", () => {
    const link = buildSafeLinkForWorkEvent(baseEvent);
    assert.equal(link!.link_type, "candidate");
  });
});

describe("redactSafeText helper", () => {
  it("redacts known sensitive substrings", () => {
    const out = redactSafeText("rec_abc and payload and authorization header");
    assert.ok(!out.includes("rec_abc"));
    assert.ok(!out.includes("payload"));
    assert.ok(!out.includes("authorization"));
    assert.match(out, /\[已脱敏\]/);
  });

  it("returns empty string for non-string input", () => {
    assert.equal(redactSafeText(undefined as unknown as string), "");
  });
});

describe("containsSensitivePattern helper", () => {
  it("detects sensitive substrings", () => {
    assert.equal(containsSensitivePattern("safe text"), false);
    assert.equal(containsSensitivePattern("contains payload"), true);
    assert.equal(containsSensitivePattern("contains rec_xyz"), true);
  });

  it("does not miss repeated matches across calls", () => {
    assert.equal(containsSensitivePattern("payload"), true);
    assert.equal(containsSensitivePattern("payload"), true);
    assert.equal(containsSensitivePattern("rec_xyz"), true);
    assert.equal(containsSensitivePattern("rec_xyz"), true);
  });
});

describe("redactWorkEvents batch", () => {
  it("redacts list of events without leaking forbidden fields", () => {
    const events: WorkEvent[] = [
      {
        event_id: "evt_demo_001",
        agent_name: "数据分析",
        event_type: "tool_call",
        tool_type: "record_list",
        target_table: "reports",
        execution_mode: "dry_run",
        guard_status: "passed",
        safe_summary: "演示生成漏斗",
        status_before: null,
        status_after: null,
        duration_ms: 10,
        parent_run_id: "run_demo_analytics_001",
        link_status: "no_link",
        created_at: "2026-04-27T09:00:00.000Z",
      },
    ];
    const safe = redactWorkEvents(events);
    assert.equal(safe.length, 1);
    const view = safe[0]! as unknown as Record<string, unknown>;
    assert.ok(!("event_id" in view));
    assert.ok(!("parent_run_id" in view));
    assert.equal(view.link, null);
  });
});
