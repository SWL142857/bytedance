import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../../src/server/server.js";
import type { Server } from "node:http";

const BASE_URL = "http://localhost:3012";

const FORBIDDEN_PATTERNS = [
  "rec_",
  "rec_demo_",
  "cand_demo_",
  "job_demo_",
  "payload",
  "authorization",
  "Bearer",
  "MODEL_API",
  "apiKey",
  "endpoint",
  "raw",
  "stdout",
  "stderr",
  "EXECUTE_LIVE",
  "HIRELOOP_ALLOW_LARK_WRITE",
  "--execute",
];

interface SafeTaskLike {
  task_kind: string;
  category: string;
  display_name: string;
  description: string;
  availability: string;
  execute_enabled: boolean;
  guard_summary: string;
  blocked_reasons: string[];
}

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

describe("/api/operator/tasks readonly skeleton", () => {
  let server: Server;

  beforeEach(() => {
    server = createServer();
    return new Promise<void>((resolve) => {
      server.listen(3012, () => resolve());
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns tasks/safety/notice", async () => {
    const { status, json } = await fetchRaw("/api/operator/tasks");
    assert.equal(status, 200);
    const data = json as Record<string, unknown>;
    assert.ok(Array.isArray(data.tasks), "tasks must be array");
    assert.ok(typeof data.safety === "object" && data.safety !== null, "safety must be object");
    assert.ok(typeof data.notice === "string" && data.notice.length > 0, "notice must be non-empty string");
  });

  it("safety flags are locked down by default", async () => {
    const { json } = await fetchRaw("/api/operator/tasks");
    const data = json as { safety: { read_only: boolean; real_writes: boolean; external_model_calls: boolean; demo_mode: boolean } };
    assert.equal(data.safety.read_only, true);
    assert.equal(data.safety.real_writes, false);
    assert.equal(data.safety.external_model_calls, false);
    assert.equal(data.safety.demo_mode, true);
  });

  it("every task has execute_enabled=false", async () => {
    const { json } = await fetchRaw("/api/operator/tasks");
    const data = json as { tasks: SafeTaskLike[] };
    assert.ok(data.tasks.length >= 8, "must have at least 8 tasks");
    for (const task of data.tasks) {
      assert.equal(task.execute_enabled, false, `${task.task_kind} must have execute_enabled=false`);
    }
  });

  it("includes expected readonly task kinds", async () => {
    const { json } = await fetchRaw("/api/operator/tasks");
    const data = json as { tasks: SafeTaskLike[] };
    const kinds = new Set(data.tasks.map((task) => task.task_kind));
    for (const expected of [
      "local_mvp_demo",
      "release_gate",
      "api_boundary_audit",
      "provider_readiness",
      "provider_smoke_dry_run",
      "provider_agent_demo_dry_run",
      "live_readiness_report",
      "analytics_report",
    ]) {
      assert.ok(kinds.has(expected), `missing operator task kind: ${expected}`);
    }
  });

  it("availability values stay within readonly/disabled domain", async () => {
    const { json } = await fetchRaw("/api/operator/tasks");
    const data = json as { tasks: SafeTaskLike[] };
    const allowed = new Set([
      "available_readonly",
      "disabled_phase_pending",
      "disabled_requires_human_approval",
    ]);
    for (const task of data.tasks) {
      assert.ok(allowed.has(task.availability), `unexpected availability: ${task.availability}`);
    }
  });

  it("display_name and description use Chinese text", async () => {
    const { json } = await fetchRaw("/api/operator/tasks");
    const data = json as { tasks: SafeTaskLike[] };
    for (const task of data.tasks) {
      assert.ok(typeof task.display_name === "string" && task.display_name.length > 0);
      assert.ok(typeof task.description === "string" && task.description.length > 0);
      assert.ok(/[一-龥]/.test(task.display_name), `${task.task_kind} display_name must include Chinese`);
      assert.ok(/[一-龥]/.test(task.description), `${task.task_kind} description must include Chinese`);
    }
  });

  it("response text does not contain sensitive patterns", async () => {
    const { text } = await fetchRaw("/api/operator/tasks");
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.ok(!text.includes(pattern), `/api/operator/tasks must not contain ${pattern}`);
    }
  });

  it("non-GET requests are not honored", async () => {
    const res = await fetch(`${BASE_URL}/api/operator/tasks`, { method: "POST" });
    assert.notEqual(res.status, 200);
  });

  it("content-type is application/json", async () => {
    const res = await fetch(`${BASE_URL}/api/operator/tasks`);
    const ct = res.headers.get("content-type");
    assert.ok(ct?.includes("application/json"), `unexpected content-type: ${ct}`);
  });
});
