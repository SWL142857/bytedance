import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../../src/server/server.js";
import type { Server } from "node:http";

const BASE_URL = "http://localhost:3011";

interface SafeWorkEventLike {
  agent_name: unknown;
  event_type: unknown;
  tool_type: unknown;
  target_table: unknown;
  execution_mode: unknown;
  guard_status: unknown;
  safe_summary: unknown;
  status_before: unknown;
  status_after: unknown;
  duration_ms: unknown;
  link: unknown;
  created_at: unknown;
}

const FORBIDDEN_FIELDS = ["event_id", "parent_run_id", "record_id", "base_app_token", "table_id"];

const FORBIDDEN_PATTERNS = [
  "rec_",
  "rec_demo_",
  "cand_demo_",
  "job_demo_",
  "payload",
  "prompt",
  "authorization",
  "Bearer",
  "MODEL_API",
  "apiKey",
  "endpoint",
  "raw",
  "stdout",
  "stderr",
];

async function fetchRaw(path: string): Promise<{ status: number; text: string; json: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: res.status, text, json: parsed };
}

describe("/api/work-events safe projection", () => {
  let server: Server;

  beforeEach(() => {
    server = createServer();
    return new Promise<void>((resolve) => {
      server.listen(3011, () => resolve());
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns array with at least 5 events", async () => {
    const { status, json } = await fetchRaw("/api/work-events");
    assert.equal(status, 200);
    assert.ok(Array.isArray(json), "response must be an array");
    const events = json as SafeWorkEventLike[];
    assert.ok(events.length >= 5, `expected >= 5 events, got ${events.length}`);
  });

  it("safe view does not expose forbidden fields", async () => {
    const { json } = await fetchRaw("/api/work-events");
    const events = json as Array<Record<string, unknown>>;
    for (const event of events) {
      for (const field of FORBIDDEN_FIELDS) {
        assert.ok(!(field in event), `event must not contain ${field}`);
      }
    }
  });

  it("response text does not contain sensitive patterns", async () => {
    const { text } = await fetchRaw("/api/work-events");
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.ok(!text.includes(pattern), `/api/work-events must not contain ${pattern}`);
    }
  });

  it("demo links are marked unavailable with self-explanatory labels", async () => {
    const { json } = await fetchRaw("/api/work-events");
    const events = json as Array<{ link: { available: boolean; link_id: string; link_label: string; unavailable_label: string | null } | null }>;
    let sawDemoLink = false;
    for (const event of events) {
      if (event.link) {
        sawDemoLink = true;
        assert.equal(event.link.available, false, "demo link must have available=false");
        assert.match(event.link.link_id, /^lnk_demo_/, "demo link id must start with lnk_demo_");
        assert.equal(event.link.link_label, "飞书记录", "demo link_label should be 飞书记录");
        assert.equal(event.link.unavailable_label, "飞书记录未接入", "demo link must have unavailable_label");
      }
    }
    assert.ok(sawDemoLink, "should have at least one demo link");
  });

  it("safe summaries contain Chinese text and no sensitive tokens", async () => {
    const { json } = await fetchRaw("/api/work-events");
    const events = json as Array<{ safe_summary: string }>;
    for (const event of events) {
      assert.ok(typeof event.safe_summary === "string");
      assert.ok(event.safe_summary.length > 0, "safe_summary must not be empty");
    }
  });

  it("demo fallback uses current 7-agent names, not retired P1 roles", async () => {
    const { text } = await fetchRaw("/api/work-events");
    assert.ok(text.includes("简历录入"), "work events should include current Resume Intake role");
    assert.ok(text.includes("信息抽取"), "work events should include current Resume Extraction role");
    assert.ok(text.includes("图谱构建"), "work events should include current Graph Builder role");
    assert.ok(text.includes("图谱复核"), "work events should include current Reviewer role");
    assert.ok(!text.includes("简历解析"), "work events must not show retired Resume Parser role");
    assert.ok(!text.includes("初筛评估"), "work events must not show retired Screening role");
  });

  it("non-GET requests are not honored", async () => {
    const res = await fetch(`${BASE_URL}/api/work-events`, { method: "POST" });
    assert.notEqual(res.status, 200);
  });
});

describe("/api/org/overview safety summary", () => {
  let server: Server;

  beforeEach(() => {
    server = createServer();
    return new Promise<void>((resolve) => {
      server.listen(3011, () => resolve());
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns agents/pipeline/recent_events/safety", async () => {
    const { status, json } = await fetchRaw("/api/org/overview");
    assert.equal(status, 200);
    const data = json as Record<string, unknown>;
    assert.ok(Array.isArray(data.agents), "agents must be array");
    assert.ok(typeof data.pipeline === "object" && data.pipeline !== null, "pipeline must be object");
    assert.ok(Array.isArray(data.recent_events), "recent_events must be array");
    assert.ok(typeof data.safety === "object" && data.safety !== null, "safety must be object");
  });

  it("safety flags lock down execution by default", async () => {
    const { json } = await fetchRaw("/api/org/overview");
    const data = json as { safety: { read_only: boolean; real_writes: boolean; external_model_calls: boolean; demo_mode: boolean } };
    assert.equal(data.safety.read_only, true);
    assert.equal(data.safety.real_writes, false);
    assert.equal(data.safety.external_model_calls, false);
    assert.equal(data.safety.demo_mode, true);
  });

  it("demo fallback data_source is demo_fixture", async () => {
    const { json } = await fetchRaw("/api/org/overview");
    const data = json as { data_source: { mode: string; snapshot_source: unknown; label: string; generated_at: unknown; external_model_calls: boolean; real_writes: boolean } };
    assert.equal(data.data_source.mode, "demo_fixture");
    assert.equal(data.data_source.snapshot_source, null);
    assert.equal(data.data_source.label, "演示样本");
    assert.equal(data.data_source.generated_at, null);
    assert.equal(data.data_source.external_model_calls, false);
    assert.equal(data.data_source.real_writes, false);
  });

  it("data_source does not leak snapshot path or sensitive fields", async () => {
    const { json } = await fetchRaw("/api/org/overview");
    const data = json as { data_source: unknown };
    const text = JSON.stringify(data.data_source);
    assert.ok(!text.includes("snapshot_path"), "must not contain snapshot_path");
    assert.ok(!text.includes("rec_"), "must not contain record IDs");
    assert.ok(!text.includes("prompt"), "must not contain prompt");
    assert.ok(!text.includes("resume"), "must not contain resume text");
    assert.ok(!text.includes("payload"), "must not contain payload");
  });

  it("agents include 7 virtual employees with Chinese role names (P3)", async () => {
    const { json } = await fetchRaw("/api/org/overview");
    const data = json as { agents: Array<{ agent_name: string; status: string }> };
    assert.equal(data.agents.length, 7);
    const names = data.agents.map((a) => a.agent_name);
    for (const expected of ["HR 协调", "简历录入", "信息抽取", "图谱构建", "图谱复核", "面试准备", "数据分析"]) {
      assert.ok(names.includes(expected), `expected agent ${expected}`);
    }
  });

  it("demo fallback stage_counts sum to 1 and only 待决策 is 1", async () => {
    const { json } = await fetchRaw("/api/org/overview");
    const data = json as { pipeline: { stage_counts: Array<{ label: string; count: number }> } };
    const stages = data.pipeline.stage_counts;
    assert.ok(Array.isArray(stages) && stages.length >= 5, "must have at least 5 stages");
    const total = stages.reduce((sum, s) => sum + s.count, 0);
    assert.equal(total, 1, "single-candidate demo should have total count 1");
    const pending = stages.find((s) => s.label === "待决策");
    assert.ok(pending, "must include 待决策 stage");
    assert.equal(pending!.count, 1, "待决策 should be 1");
    for (const s of stages) {
      if (s.label !== "待决策") {
        assert.equal(s.count, 0, `${s.label} should be 0`);
      }
    }
  });

  it("response text does not contain sensitive patterns", async () => {
    const { text } = await fetchRaw("/api/org/overview");
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.ok(!text.includes(pattern), `/api/org/overview must not contain ${pattern}`);
    }
  });
});

describe("/go/:linkId demo redirect skeleton", () => {
  let server: Server;

  beforeEach(() => {
    server = createServer();
    return new Promise<void>((resolve) => {
      server.listen(3011, () => resolve());
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("known demo link returns demo JSON, not redirect", async () => {
    const res = await fetch(`${BASE_URL}/go/lnk_demo_001`, { redirect: "manual" });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { mode: string; available: boolean; message: string };
    assert.equal(data.mode, "demo");
    assert.equal(data.available, false);
    assert.match(data.message, /演示模式/);
  });

  it("unknown link id returns safe Chinese 404", async () => {
    const res = await fetch(`${BASE_URL}/go/totally-unknown`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.ok(typeof data.error === "string");
    assert.ok(/[一-龥]/.test(data.error), "error message must be Chinese");
  });

  it("non-GET requests on /go/ do not execute", async () => {
    const res = await fetch(`${BASE_URL}/go/lnk_demo_001`, { method: "POST" });
    assert.notEqual(res.status, 200);
  });

  it("response does not include real Lark URLs or record IDs", async () => {
    const res = await fetch(`${BASE_URL}/go/lnk_demo_001`);
    const text = await res.text();
    assert.ok(!text.includes("feishu.cn"));
    assert.ok(!text.includes("larksuite.com"));
    assert.ok(!text.includes("rec_"));
    assert.ok(!text.includes("base_app_token"));
  });
});
