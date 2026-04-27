import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../../src/server/server.js";
import type { Server } from "node:http";

const BASE_URL = "http://localhost:3010";

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}${path}`);
  assert.ok(res.ok, `GET ${path} returned ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

describe("server API routes", () => {
  let server: Server;

  beforeEach(() => {
    server = createServer();
    return new Promise<void>((resolve) => {
      server.listen(3010, () => resolve());
    });
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET /api/demo/pipeline returns safe pipeline view", async () => {
    const data = await fetchJson("/api/demo/pipeline");
    assert.equal(data.finalStatus, "decision_pending");
    assert.equal(data.completed, true);
    assert.equal(typeof data.commandCount, "number");
    assert.ok(Array.isArray(data.commands));
    assert.ok(Array.isArray(data.agentRuns));
    assert.equal(data.failedAgent, null);

    for (const cmd of data.commands as Record<string, unknown>[]) {
      assert.ok(!("args" in cmd), "commands must not contain args");
      assert.ok(!("redactedArgs" in cmd), "commands must not contain redactedArgs");
      assert.ok("description" in cmd);
    }

    for (const run of data.agentRuns as Record<string, unknown>[]) {
      assert.ok(!("output_json" in run), "agent run must not contain output_json");
      assert.ok(!("error_message" in run), "agent run must not contain error_message");
      assert.ok(!("prompt_template_id" in run), "agent run must not contain prompt_template_id");
      assert.ok(!("run_id" in run), "agent run must not contain run_id");
      assert.ok(!("git_commit_hash" in run), "agent run must not contain git_commit_hash");
      assert.ok("agent_name" in run);
      assert.ok("run_status" in run);
    }
  });

  it("GET /api/reports/release-gate returns release gate report", async () => {
    const data = await fetchJson("/api/reports/release-gate");
    assert.equal(data.title, "MVP Release Gate");
    assert.equal(data.realWritePermittedByReport, false);
    assert.equal(data.externalModelCallPermittedByReport, false);
  });

  it("GET /api/reports/api-boundary-audit returns audit report", async () => {
    const data = await fetchJson("/api/reports/api-boundary-audit");
    assert.equal(data.title, "API Boundary Release Audit");
    assert.equal(data.defaultExternalModelCallsPermittedByReport, false);
    assert.equal(data.realBaseWritesPermittedByReport, false);
  });

  it("GET /api/reports/provider-readiness returns provider readiness", async () => {
    const data = await fetchJson("/api/reports/provider-readiness");
    assert.equal(data.status, "disabled");
    assert.equal(data.canCallExternalModel, false);
  });

  it("GET /api/reports/provider-smoke returns provider smoke result", async () => {
    const data = await fetchJson("/api/reports/provider-smoke");
    assert.equal(data.mode, "dry_run");
    assert.equal(data.canCallExternalModel, false);
  });

  it("GET /api/reports/provider-agent-demo returns provider agent demo", async () => {
    const data = await fetchJson("/api/reports/provider-agent-demo");
    assert.ok(data.status);
    assert.equal(data.canCallExternalModel, false);
  });

  it("GET /api/reports/pre-api-freeze returns pre-api freeze report", async () => {
    const data = await fetchJson("/api/reports/pre-api-freeze");
    assert.equal(data.title, "Pre-API Freeze Report");
    assert.equal(data.externalModelCallAllowedByReport, false);
    assert.equal(data.realBaseWriteAllowedByReport, false);
  });

  it("GET /api/reports/live-readiness returns live readiness report", async () => {
    const data = await fetchJson("/api/reports/live-readiness");
    assert.equal(data.mode, "readonly");
    assert.equal(data.ready, false);
    assert.equal(data.safeToExecuteLiveWrites, false);
  });

  it("GET /api/unknown returns 404 with Chinese message", async () => {
    const res = await fetch(`${BASE_URL}/api/unknown`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.equal(data.error, "未找到资源");
  });

  it("GET /unknown returns 404 with Chinese message", async () => {
    const res = await fetch(`${BASE_URL}/unknown-page.html`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.equal(data.error, "未找到资源");
  });

  it("GET / serves index.html", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.ok(res.ok);
    const text = await res.text();
    assert.ok(text.includes("HireLoop"));
    assert.ok(res.headers.get("content-type")?.includes("text/html"));
  });

  it("GET /style.css serves CSS", async () => {
    const res = await fetch(`${BASE_URL}/style.css`);
    assert.ok(res.ok);
    assert.ok(res.headers.get("content-type")?.includes("text/css"));
  });

  it("GET /app.js serves JS", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    assert.ok(res.ok);
    assert.ok(res.headers.get("content-type")?.includes("javascript"));
  });

  it("pipeline response does not leak rec_ record IDs", async () => {
    const res = await fetch(`${BASE_URL}/api/demo/pipeline`);
    const text = await res.text();
    assert.ok(!text.includes("rec_"), "pipeline response must not contain rec_ record IDs");
    assert.ok(!text.includes("cand_demo_"), "pipeline response must not contain cand_demo_ IDs");
    assert.ok(!text.includes("job_demo_"), "pipeline response must not contain job_demo_ IDs");
  });

  it("API responses are JSON with correct content type", async () => {
    const paths = [
      "/api/demo/pipeline",
      "/api/reports/release-gate",
      "/api/reports/api-boundary-audit",
      "/api/reports/provider-readiness",
      "/api/reports/provider-smoke",
      "/api/reports/provider-agent-demo",
      "/api/reports/pre-api-freeze",
      "/api/reports/live-readiness",
      "/api/work-events",
      "/api/org/overview",
      "/api/operator/tasks",
    ];
    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`);
      const ct = res.headers.get("content-type");
      assert.ok(ct?.includes("application/json"), `${path} content-type: ${ct}`);
    }
  });

  it("pipeline agentRuns entity_ref values are all redacted", async () => {
    const data = await fetchJson("/api/demo/pipeline");
    const runs = data.agentRuns as Array<Record<string, unknown>>;
    assert.ok(runs.length > 0, "should have agent runs");
    for (const run of runs) {
      assert.equal(run.entity_ref, "[已脱敏]", "all entity_ref must be redacted");
    }
  });

  it("no API response contains sensitive demo IDs", async () => {
    const paths = [
      "/api/demo/pipeline",
      "/api/reports/release-gate",
      "/api/reports/api-boundary-audit",
      "/api/reports/provider-readiness",
      "/api/reports/provider-smoke",
      "/api/reports/provider-agent-demo",
      "/api/reports/pre-api-freeze",
      "/api/reports/live-readiness",
      "/api/work-events",
      "/api/org/overview",
      "/api/operator/tasks",
    ];
    const patterns = ["rec_demo_", "cand_demo_", "job_demo_"];
    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`);
      const text = await res.text();
      for (const pattern of patterns) {
        assert.ok(!text.includes(pattern), `${path} must not contain ${pattern}`);
      }
    }
  });

  it("index.html surfaces 组织运行总览 / 最近活动 sections", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const text = await res.text();
    assert.ok(text.includes("组织运行总览"), "index.html must include 组织运行总览");
    assert.ok(text.includes("最近活动"), "index.html must include 最近活动");
    assert.ok(text.includes("操作员控制台"), "index.html must include 操作员控制台");
  });

  it("UI assets do not regress to deprecated editorial tokens", async () => {
    const indexRes = await fetch(`${BASE_URL}/`);
    const cssRes = await fetch(`${BASE_URL}/style.css`);
    const jsRes = await fetch(`${BASE_URL}/app.js`);
    const indexText = await indexRes.text();
    const cssText = await cssRes.text();
    const jsText = await jsRes.text();
    const forbidden = ["Songti", "paper", "seal", "OPENING", "FUNNEL", "SEAL OF SAFETY"];
    for (const token of forbidden) {
      assert.ok(!indexText.includes(token), `index.html must not contain ${token}`);
      assert.ok(!cssText.includes(token), `style.css must not contain ${token}`);
      assert.ok(!jsText.includes(token), `app.js must not contain ${token}`);
    }
  });

  it("app.js exposes 查看飞书记录 entry without real Feishu URLs", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(text.includes("查看飞书记录"), "app.js must reference 查看飞书记录");
    assert.ok(!text.includes("feishu.cn"), "app.js must not reference real feishu.cn URLs");
    assert.ok(!text.includes("larksuite.com"), "app.js must not reference real larksuite URLs");
    assert.ok(!text.includes("base_app_token"), "app.js must not contain base_app_token");
  });

  it("app.js does not encourage live execute write actions", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(!text.includes("EXECUTE_LIVE"), "app.js must not contain live execute confirmation tokens");
    assert.ok(!text.includes("HIRELOOP_ALLOW_LARK_WRITE"), "app.js must not embed write permission env names");
    assert.ok(!text.includes("--execute"), "app.js must not embed execute CLI args");
  });

  it("index.html does not reference external fonts", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const text = await res.text();
    assert.ok(!text.includes("fonts.googleapis.com"), "must not reference Google Fonts");
    assert.ok(!text.includes("fonts.gstatic.com"), "must not reference Google Fonts static");
  });

  it("index.html does not contain scanlines", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const text = await res.text();
    assert.ok(!text.includes("scanlines"), "must not contain scanlines");
  });

  it("style.css does not contain cyber theme fonts", async () => {
    const res = await fetch(`${BASE_URL}/style.css`);
    const text = await res.text();
    assert.ok(!text.includes("Chakra Petch"), "must not contain Chakra Petch");
    assert.ok(!text.includes("Share Tech Mono"), "must not contain Share Tech Mono");
    assert.ok(!text.includes("googleapis"), "must not reference googleapis");
  });

  it("app.js does not expose raw fetch error messages", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(!text.includes("returned "), "must not contain raw fetch status text like 'returned 404'");
    assert.ok(!text.includes("GET /api"), "must not contain raw fetch path in error messages");
  });

  it("UI translates report status codes and provider summaries", async () => {
    const appRes = await fetch(`${BASE_URL}/app.js`);
    const cssRes = await fetch(`${BASE_URL}/style.css`);
    const appText = await appRes.text();
    const cssText = await cssRes.text();
    assert.ok(appText.includes('needs_review: "待复核"'), "needs_review should render as Chinese copy");
    assert.ok(appText.includes('dry_run: "干跑"'), "dry_run should render as Chinese copy");
    assert.ok(appText.includes('"Provider adapter is not enabled.": "模型供应商适配器未启用。"'));
    assert.ok(appText.includes('"No commands to validate.": "暂无可验证命令。"'));
    assert.ok(cssText.includes(".check-icon.block"), "block check status should use failure styling");
  });

  it("500 error returns fixed safe message without stack traces", async () => {
    const res = await fetch(`${BASE_URL}/api/demo/pipeline`, { method: "POST" });
    if (res.status >= 400) {
      const text = await res.text();
      assert.ok(!text.includes("Error:"), "error response must not contain Error:");
      assert.ok(!text.includes(".ts:"), "error response must not contain .ts: stack traces");
      assert.ok(!text.includes(".js:"), "error response must not contain .js: stack traces");
      assert.ok(!text.includes(" at "), "error response must not contain stack trace lines");
    }
  });
});
