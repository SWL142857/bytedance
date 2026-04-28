import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getLiveBaseStatus,
  listLiveRecords,
} from "../../src/server/live-base.js";
import type { HireLoopConfig } from "../../src/config.js";

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

describe("live-base — getLiveBaseStatus", () => {
  it("blocked when HIRELOOP_ALLOW_LARK_READ not set", () => {
    const status = getLiveBaseStatus({
      loadConfig: () => fakeConfig(),
      cliAvailable: () => true,
    });
    assert.equal(status.readEnabled, false);
    assert.ok(status.blockedReasons.length > 0);
    assert.ok(status.blockedReasons.some((r) => r.includes("HIRELOOP_ALLOW_LARK_READ")));
  });

  it("blocked when Lark env incomplete", () => {
    const status = getLiveBaseStatus({
      loadConfig: () => fakeConfig({ allowLarkRead: true }),
      cliAvailable: () => true,
    });
    assert.equal(status.readEnabled, true);
    assert.equal(status.larkEnvComplete, false);
    assert.ok(status.blockedReasons.some((r) => r.includes("飞书应用 ID")));
  });

  it("ready when all env set and read enabled", () => {
    const status = getLiveBaseStatus(readyDeps());
    assert.equal(status.readEnabled, true);
    assert.equal(status.cliAvailable, true);
    assert.equal(status.larkEnvComplete, true);
    assert.equal(status.blockedReasons.length, 0);
    assert.equal(status.writeDisabled, true);
  });

  it("blocked when lark-cli is unavailable", () => {
    const status = getLiveBaseStatus({
      loadConfig: () => readyConfig(),
      cliAvailable: () => false,
    });
    assert.equal(status.cliAvailable, false);
    assert.ok(status.blockedReasons.some((r) => r.includes("lark-cli")));
  });
});

describe("live-base — listLiveRecords", () => {
  it("returns empty when blocked", async () => {
    const result = await listLiveRecords("candidates", {
      deps: { loadConfig: () => fakeConfig() },
    });
    assert.deepEqual(result.records, []);
    assert.equal(result.total, 0);
  });

  it("returns empty for invalid table", async () => {
    const result = await listLiveRecords("invalid_table", {
      deps: readyDeps(),
    });
    assert.deepEqual(result.records, []);
  });

  it("projects candidates from mock stdout", async () => {
    const mockStdout = JSON.stringify({
      items: [
        {
          record_id: "rec_test_001",
          fields: {
            display_name: "张三",
            status: [{ text: "screened" }],
            screening_recommendation: [{ text: "strong_match" }],
            human_decision: null,
            job: "AI 产品经理",
            resume_text: "有经验的PM",
          },
        },
        {
          record_id: "rec_test_002",
          fields: {
            display_name: "李四",
            status: "new",
            screening_recommendation: null,
            human_decision: null,
            job: "后端工程师",
            resume_text: null,
          },
        },
      ],
      total: 2,
      has_more: false,
    });

    const result = await listLiveRecords("candidates", {
      deps: {
        ...readyDeps(),
        executor: () => ({
          description: "list",
          status: "success",
          stdout: mockStdout,
          stderr: null,
          exitCode: 0,
          durationMs: 10,
        }),
      },
    });

    assert.equal(result.records.length, 2);
    const first = result.records[0] as Record<string, unknown>;
    assert.equal(first.display_name, "张三");
    assert.equal(first.status, "screened");
    assert.equal(first.resume_available, true);
    assert.ok(first.link, "should have link");
    assert.equal((first.link as Record<string, unknown>).available, true);

    const second = result.records[1] as Record<string, unknown>;
    assert.equal(second.display_name, "李四");
    assert.equal(second.resume_available, false);

    // Must not contain record_id or resume_text
    const json = JSON.stringify(result);
    assert.ok(!json.includes("rec_test_001"), "must not contain record_id");
    assert.ok(!json.includes("有经验的PM"), "must not contain resume text");
  });

  it("projects jobs from mock stdout", async () => {
    const mockStdout = JSON.stringify({
      data: {
        items: [
          {
            record_id: "rec_job_001",
            fields: {
              title: "AI 产品经理",
              department: "AI 产品部",
              level: "P7",
              status: "open",
              owner: "王经理",
            },
          },
        ],
        total: 1,
        has_more: false,
      },
    });

    const result = await listLiveRecords("jobs", {
      deps: {
        ...readyDeps(),
        executor: () => ({
          description: "list",
          status: "success",
          stdout: mockStdout,
          stderr: null,
          exitCode: 0,
          durationMs: 10,
        }),
      },
    });

    assert.equal(result.records.length, 1);
    const job = result.records[0] as Record<string, unknown>;
    assert.equal(job.title, "AI 产品经理");
    assert.equal(job.department, "AI 产品部");

    const json = JSON.stringify(result);
    assert.ok(!json.includes("rec_job_001"), "must not contain record_id");
  });

  it("projects work events to safe views from real record-list shape", async () => {
    const mockStdout = JSON.stringify({
      items: [
        {
          record_id: "rec_evt_001",
          fields: {
            event_id: "evt_secret_001",
            agent_name: "简历解析",
            event_type: "tool_call",
            tool_type: "record_list",
            target_table: "candidates",
            execution_mode: "live_read",
            guard_status: "passed",
            safe_summary: "读取候选人列表",
            parent_run_id: "run_secret_001",
            link_status: "has_link",
            duration_ms: 23,
            created_at: "2026-04-28T10:00:00.000Z",
          },
        },
      ],
      total: 1,
      has_more: false,
    });

    const result = await listLiveRecords("work_events", {
      deps: {
        ...readyDeps(),
        executor: () => ({
          description: "list",
          status: "success",
          stdout: mockStdout,
          stderr: null,
          exitCode: 0,
          durationMs: 10,
        }),
      },
    });

    assert.equal(result.records.length, 1);
    const event = result.records[0] as Record<string, unknown>;
    assert.equal(event.agent_name, "简历解析");
    assert.equal(event.execution_mode, "live_read");
    assert.ok(event.link);

    const json = JSON.stringify(result);
    assert.ok(!json.includes("rec_evt_001"), "must not contain record_id");
    assert.ok(!json.includes("evt_secret_001"), "must not contain event_id");
    assert.ok(!json.includes("run_secret_001"), "must not contain parent_run_id");
  });

  it("does not allow raw agent_runs or reports listing", async () => {
    for (const table of ["agent_runs", "reports"]) {
      const result = await listLiveRecords(table, {
        deps: {
          ...readyDeps(),
          executor: () => {
            throw new Error("executor must not be called for unsupported live table");
          },
        },
      });
      assert.deepEqual(result.records, []);
      assert.equal(result.total, 0);
    }
  });

  it("returns empty on executor failure", async () => {
    const result = await listLiveRecords("candidates", {
      deps: {
        ...readyDeps(),
        executor: () => ({
          description: "list",
          status: "failed",
          stdout: null,
          stderr: "error",
          exitCode: 1,
          durationMs: 10,
        }),
      },
    });
    assert.deepEqual(result.records, []);
  });
});
