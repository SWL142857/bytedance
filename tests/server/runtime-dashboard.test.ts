import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeDashboardSnapshot, loadRuntimeDashboardSnapshot } from "../../src/server/runtime-dashboard.js";
import type { CandidatePipelineResult } from "../../src/orchestrator/candidate-pipeline.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RESULT: CandidatePipelineResult = {
  commands: [
    {
      description: "Upsert record into \"Resume Facts\"",
      command: "lark-cli",
      args: [],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: true,
    },
  ],
  agentRuns: [
    {
      run_id: "run_001",
      agent_name: "resume_extraction",
      entity_type: "candidate",
      entity_ref: "cand_001",
      input_summary: "candidateId=cand_001 resumeLength=12 status=new",
      prompt_template_id: "extraction_v1",
      git_commit_hash: "abc123",
      status_before: "new",
      status_after: "parsed",
      run_status: "success",
      retry_count: 0,
      duration_ms: 88,
    },
  ],
  finalStatus: "parsed",
  completed: false,
  failedAgent: "screening_reviewer",
};

describe("runtime-dashboard snapshot", () => {
  it("builds a safe runtime snapshot with non-demo safety flags", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    assert.equal(snapshot.kind, "runtime_dashboard_snapshot");
    assert.equal(snapshot.pipeline.finalStatus, "parsed");
    assert.equal(snapshot.org_overview.safety.demo_mode, false);
    assert.equal(snapshot.org_overview.safety.external_model_calls, false);
    assert.ok(snapshot.work_events.length >= 2);
    assert.equal(snapshot.work_events[0]?.agent_name, "数据分析");
    assert.equal(snapshot.work_events[1]?.agent_name, "信息抽取");
  });

  it("runtime org overview uses the 7-agent roster", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const names = snapshot.org_overview.agents.map((a) => a.agent_name);
    assert.deepEqual(names, ["HR 协调", "简历录入", "信息抽取", "图谱构建", "图谱复核", "面试准备", "数据分析"]);
  });

  it("stage_counts only counts the finalStatus stage for a single candidate", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const stages = snapshot.org_overview.pipeline.stage_counts;
    assert.equal(stages.length, 5);
    assert.deepEqual(stages, [
      { label: "新增", count: 0 },
      { label: "已解析", count: 1 },
      { label: "已筛选", count: 0 },
      { label: "面试就绪", count: 0 },
      { label: "待决策", count: 0 },
    ]);
  });

  it("stage_counts returns all zeros for unknown finalStatus", () => {
    const unknownResult = { ...RESULT, finalStatus: "unknown_status" as CandidatePipelineResult["finalStatus"], completed: false };
    const snapshot = buildRuntimeDashboardSnapshot(unknownResult, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const stages = snapshot.org_overview.pipeline.stage_counts;
    for (const s of stages) {
      assert.equal(s.count, 0, `${s.label} should be 0 for unknown finalStatus`);
    }
  });

  it("stage_counts for decision_pending only counts 待决策", () => {
    const completedResult: CandidatePipelineResult = {
      commands: [],
      agentRuns: [
        { run_id: "run_001", agent_name: "hr_coordinator", entity_type: "candidate", entity_ref: "cand_001", input_summary: "s", prompt_template_id: "v1", git_commit_hash: "abc", status_before: "interview_kit_ready", status_after: "decision_pending", run_status: "success", retry_count: 0, duration_ms: 50 },
      ],
      finalStatus: "decision_pending",
      completed: true,
      failedAgent: undefined,
    };
    const snapshot = buildRuntimeDashboardSnapshot(completedResult, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const stages = snapshot.org_overview.pipeline.stage_counts;
    const total = stages.reduce((sum, s) => sum + s.count, 0);
    assert.equal(total, 1, "single candidate should have total count 1");
    assert.equal(stages.find((s) => s.label === "待决策")?.count, 1);
  });

  it("data_source for deterministic snapshot", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const ds = snapshot.org_overview.data_source;
    assert.equal(ds.mode, "runtime_snapshot");
    assert.equal(ds.snapshot_source, "deterministic");
    assert.equal(ds.label, "本地运行快照");
    assert.equal(ds.generated_at, "2026-04-27T10:00:00.000Z");
    assert.equal(ds.external_model_calls, false);
    assert.equal(ds.real_writes, false);
  });

  it("data_source for provider snapshot", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "provider",
      externalModelCalls: true,
    });

    const ds = snapshot.org_overview.data_source;
    assert.equal(ds.mode, "runtime_snapshot");
    assert.equal(ds.snapshot_source, "provider");
    assert.equal(ds.label, "模型运行快照");
    assert.equal(ds.external_model_calls, true);
  });

  it("data_source does not leak snapshot path or input fields", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const text = JSON.stringify(snapshot.org_overview.data_source);
    assert.ok(!text.includes("snapshot_path"), "data_source must not contain snapshot_path");
    assert.ok(!text.includes("rec_"), "data_source must not contain record IDs");
    assert.ok(!text.includes("prompt"), "data_source must not contain prompt");
    assert.ok(!text.includes("resume"), "data_source must not contain resume text");
    assert.ok(!text.includes("payload"), "data_source must not contain payload");
  });

  it("does not expose raw entity refs in safe pipeline snapshot", () => {
    const snapshot = buildRuntimeDashboardSnapshot(RESULT, {
      generatedAt: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      externalModelCalls: false,
    });

    const text = JSON.stringify(snapshot);
    assert.ok(!text.includes("cand_001"));
    assert.ok(!text.includes("run_001"));
  });

  it("normalizes legacy snapshot missing data_source", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-legacy-"));
    const snapshotPath = join(tempDir, "legacy-snapshot.json");
    const legacySnapshot = {
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T08:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
      },
    };
    writeFileSync(snapshotPath, JSON.stringify(legacySnapshot));

    try {
      const loaded = loadRuntimeDashboardSnapshot(snapshotPath);
      assert.ok(loaded, "should load legacy snapshot");
      const ds = loaded.org_overview.data_source;
      assert.equal(ds.mode, "runtime_snapshot");
      assert.equal(ds.snapshot_source, "deterministic");
      assert.equal(ds.label, "本地运行快照");
      assert.equal(ds.generated_at, "2026-04-27T08:00:00.000Z");
      assert.equal(ds.external_model_calls, false);
      assert.equal(ds.real_writes, false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot with invalid source", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-bad-src-"));
    const snapshotPath = join(tempDir, "bad-source.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T08:00:00.000Z",
      source: "unknown_source",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: { agents: [], pipeline: {}, recent_events: [], safety: {} },
    }));

    try {
      const loaded = loadRuntimeDashboardSnapshot(snapshotPath);
      assert.equal(loaded, null, "should reject snapshot with invalid source");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot containing record_id in org_overview", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-safe-"));
    const snapshotPath = join(tempDir, "unsafe-record-id.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
        record_id: "rec_malicious_001",
      },
    }));
    try {
      assert.equal(loadRuntimeDashboardSnapshot(snapshotPath), null, "must reject snapshot with record_id");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot containing payload in work_events", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-safe-"));
    const snapshotPath = join(tempDir, "unsafe-payload.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [{ agent_name: "test", payload: "secret" }],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
      },
    }));
    try {
      assert.equal(loadRuntimeDashboardSnapshot(snapshotPath), null, "must reject snapshot with payload");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot containing resumeText in pipeline agentRuns", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-safe-"));
    const snapshotPath = join(tempDir, "unsafe-resume.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: {
        finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [
          { agent_name: "resume_parser", resumeText: "John Doe, 10 years experience" },
        ], failedAgent: null,
      },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
      },
    }));
    try {
      assert.equal(loadRuntimeDashboardSnapshot(snapshotPath), null, "must reject snapshot with resumeText");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot containing api_key in nested object", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-safe-"));
    const snapshotPath = join(tempDir, "unsafe-apikey.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
        data_source: { mode: "runtime_snapshot", snapshot_source: "deterministic", api_key: "sk-leaked" },
      },
    }));
    try {
      assert.equal(loadRuntimeDashboardSnapshot(snapshotPath), null, "must reject snapshot with api_key");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot containing sensitive string value (rec_ pattern)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-safe-"));
    const snapshotPath = join(tempDir, "unsafe-rec-pattern.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [{ label: "已解析", count: 1, note: "ref rec_abc123 leaked" }] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
      },
    }));
    try {
      assert.equal(loadRuntimeDashboardSnapshot(snapshotPath), null, "must reject snapshot with rec_ string value");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts clean snapshot without forbidden keys or patterns", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-safe-"));
    const snapshotPath = join(tempDir, "clean.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [{ agent_name: "简历解析", safe_summary: "完成处理" }],
      org_overview: {
        agents: [{ agent_name: "简历解析", role_label: "信息提取", status: "工作中", last_event_summary: "完成处理", duration_ms: 88 }],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [{ label: "已解析", count: 1 }] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
        data_source: { mode: "runtime_snapshot", snapshot_source: "deterministic", label: "本地运行快照", generated_at: "2026-04-27T10:00:00.000Z", external_model_calls: false, real_writes: false },
      },
    }));
    try {
      const loaded = loadRuntimeDashboardSnapshot(snapshotPath);
      assert.ok(loaded, "clean snapshot should load successfully");
      assert.equal(loaded.org_overview.data_source.mode, "runtime_snapshot");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects snapshot with nesting deeper than MAX_SCAN_DEPTH even without forbidden keys", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-deep-"));
    const snapshotPath = join(tempDir, "deep-nest.json");
    // Build a 10-level nested object with no forbidden keys
    let nested: Record<string, unknown> = { safe_leaf: "ok" };
    for (let i = 0; i < 10; i++) {
      nested = { ["level_" + i]: nested };
    }
    const deepSnapshot = {
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T10:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
        deep: nested,
      },
    };
    writeFileSync(snapshotPath, JSON.stringify(deepSnapshot));
    try {
      assert.equal(loadRuntimeDashboardSnapshot(snapshotPath), null, "must reject deeply nested snapshot");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
