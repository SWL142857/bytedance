import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("provider report routes do not leak untrusted MODEL_PROVIDER strings", async () => {
    const previous = process.env.MODEL_PROVIDER;
    process.env.MODEL_PROVIDER = "custom-provider-sensitive-probe";
    try {
      const paths = [
        "/api/reports/provider-readiness",
        "/api/reports/provider-smoke",
        "/api/reports/provider-agent-demo",
      ];
      for (const path of paths) {
        const res = await fetch(`${BASE_URL}${path}`);
        const text = await res.text();
        assert.ok(!text.includes("custom-provider-sensitive-probe"), `${path} must not leak MODEL_PROVIDER`);
        assert.ok(text.includes("自定义供应商"), `${path} should use safe provider label`);
      }
    } finally {
      if (previous === undefined) {
        delete process.env.MODEL_PROVIDER;
      } else {
        process.env.MODEL_PROVIDER = previous;
      }
    }
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

  it("GET /style.css with query string still serves CSS", async () => {
    const res = await fetch(`${BASE_URL}/style.css?v=cache-check`);
    assert.ok(res.ok);
    assert.ok(res.headers.get("content-type")?.includes("text/css"));
  });

  it("GET /app.js serves JS", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    assert.ok(res.ok);
    assert.ok(res.headers.get("content-type")?.includes("javascript"));
  });

  it("HEAD / serves headers without a body", async () => {
    const res = await fetch(`${BASE_URL}/`, { method: "HEAD" });
    assert.ok(res.ok);
    assert.ok(res.headers.get("content-type")?.includes("text/html"));
    assert.equal(await res.text(), "");
  });

  it("POST requests do not serve static assets", async () => {
    const indexRes = await fetch(`${BASE_URL}/`, { method: "POST" });
    const jsRes = await fetch(`${BASE_URL}/app.js`, { method: "POST" });
    assert.equal(indexRes.status, 404);
    assert.equal(jsRes.status, 404);
    assert.ok(indexRes.headers.get("content-type")?.includes("application/json"));
    assert.ok(jsRes.headers.get("content-type")?.includes("application/json"));
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

  it("app.js renders link.available-gated event links without real Feishu URLs", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(text.includes("available"), "app.js must check link.available");
    assert.ok(text.includes("event-link-unavailable"), "app.js must include unavailable link class");
    assert.ok(text.includes("飞书记录未接入"), "app.js must include unavailable link text");
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

  it("app.js and index.html include source hints for static-only sections", async () => {
    const appRes = await fetch(`${BASE_URL}/app.js`);
    const appText = await appRes.text();
    const indexRes = await fetch(`${BASE_URL}/`);
    const indexText = await indexRes.text();
    assert.ok(appText.includes("静态只读清单"), "app.js must include operator tasks source hint");
    assert.ok(appText.includes("不来自运行快照"), "app.js must include snapshot exclusion hint");
    assert.ok(indexText.includes("本地安全报告，不来自运行快照"), "index.html must include console source hint");
  });

  it("app.js has data_source display logic and does not hardcode 演示模式", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(text.includes("updateModePill"), "app.js must include updateModePill function");
    assert.ok(text.includes("updateFooterMeta"), "app.js must include updateFooterMeta function");
    assert.ok(text.includes("data_source"), "app.js must reference data_source field");
    assert.ok(text.includes("runtime_snapshot"), "app.js must reference runtime_snapshot mode");
    assert.ok(text.includes("运行快照已脱敏"), "app.js must include runtime snapshot redaction label");
    assert.ok(text.includes("演示样本已脱敏"), "app.js must include demo fixture redaction label");
  });

  it("app.js safety sub text is data-source aware, not hardcoded", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(!text.includes("当前为只读演示模式"), "must not contain hardcoded demo safety sub text");
    assert.ok(text.includes("buildSafetySubText"), "must include buildSafetySubText helper");
    assert.ok(text.includes("当前展示本地运行快照"), "must include deterministic snapshot safety text");
    assert.ok(text.includes("当前展示模型运行快照"), "must include provider snapshot safety text");
    assert.ok(text.includes("当前展示演示样本"), "must include demo fixture safety text");
  });

  it("app.js shows generated_at in footer for runtime snapshot", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(text.includes("generated_at"), "app.js must reference generated_at field");
    assert.ok(text.includes("formatDateTime"), "app.js must use formatDateTime for generated_at display");
    assert.ok(text.includes("生成 "), "app.js must include 生成 prefix for generated_at");
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

  it("runtime snapshot is preferred when configured", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-runtime-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T12:00:00.000Z",
      source: "deterministic",
      pipeline: {
        finalStatus: "parsed",
        completed: false,
        commandCount: 3,
        commands: [],
        agentRuns: [],
        failedAgent: "screening",
      },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: {
          final_status: "parsed",
          completed: false,
          command_count: 3,
          stage_counts: [{ label: "已解析", count: 1 }],
        },
        recent_events: [],
        safety: {
          read_only: true,
          real_writes: false,
          external_model_calls: false,
          demo_mode: false,
        },
        data_source: {
          mode: "runtime_snapshot",
          snapshot_source: "deterministic",
          label: "本地运行快照",
          generated_at: "2026-04-27T12:00:00.000Z",
          external_model_calls: false,
          real_writes: false,
        },
      },
    }));

    const snapshotServer = createServer({ runtimeSnapshotPath: snapshotPath });
    await new Promise<void>((resolve) => {
      snapshotServer.listen(0, () => resolve());
    });

    try {
      const address = snapshotServer.address();
      assert.ok(address && typeof address === "object");

      const pipelineRes = await fetch(`http://localhost:${address.port}/api/demo/pipeline`);
      const overviewRes = await fetch(`http://localhost:${address.port}/api/org/overview`);
      const pipeline = await pipelineRes.json() as { finalStatus: string; failedAgent: string };
      const overview = await overviewRes.json() as {
        safety: { demo_mode: boolean };
        data_source: { mode: string; snapshot_source: string | null; label: string };
      };

      assert.equal(pipeline.finalStatus, "parsed");
      assert.equal(pipeline.failedAgent, "screening");
      assert.equal(overview.safety.demo_mode, false);
      assert.equal(overview.data_source.mode, "runtime_snapshot");
      assert.equal(overview.data_source.snapshot_source, "deterministic");
      assert.equal(overview.data_source.label, "本地运行快照");
    } finally {
      await new Promise<void>((resolve) => {
        snapshotServer.close(() => resolve());
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("legacy snapshot without data_source is normalized by loader", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-legacy-"));
    const snapshotPath = join(tempDir, "legacy.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T14:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
      },
    }));

    const legacyServer = createServer({ runtimeSnapshotPath: snapshotPath });
    await new Promise<void>((resolve) => { legacyServer.listen(0, () => resolve()); });
    try {
      const address = legacyServer.address();
      assert.ok(address && typeof address === "object");
      const res = await fetch(`http://localhost:${address.port}/api/org/overview`);
      assert.ok(res.ok);
      const overview = await res.json() as {
        data_source: { mode: string; snapshot_source: string | null; label: string; generated_at: string | null };
      };
      assert.equal(overview.data_source.mode, "runtime_snapshot");
      assert.equal(overview.data_source.snapshot_source, "deterministic");
      assert.equal(overview.data_source.label, "本地运行快照");
      assert.equal(overview.data_source.generated_at, "2026-04-27T14:00:00.000Z");
    } finally {
      await new Promise<void>((resolve) => { legacyServer.close(() => resolve()); });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("unsafe snapshot with forbidden key falls back to demo fixture", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "hireloop-unsafe-"));
    const snapshotPath = join(tempDir, "unsafe.json");
    writeFileSync(snapshotPath, JSON.stringify({
      kind: "runtime_dashboard_snapshot",
      version: 1,
      generated_at: "2026-04-27T12:00:00.000Z",
      source: "deterministic",
      pipeline: { finalStatus: "parsed", completed: false, commandCount: 1, commands: [], agentRuns: [], failedAgent: null },
      work_events: [],
      org_overview: {
        agents: [],
        pipeline: { final_status: "parsed", completed: false, command_count: 1, stage_counts: [] },
        recent_events: [],
        safety: { read_only: true, real_writes: false, external_model_calls: false, demo_mode: false },
        record_id: "rec_leaked_001",
      },
    }));

    const unsafeServer = createServer({ runtimeSnapshotPath: snapshotPath });
    await new Promise<void>((resolve) => { unsafeServer.listen(0, () => resolve()); });
    try {
      const address = unsafeServer.address();
      assert.ok(address && typeof address === "object");
      const res = await fetch(`http://localhost:${address.port}/api/org/overview`);
      assert.ok(res.ok);
      const overview = await res.json() as {
        data_source: { mode: string };
      };
      assert.equal(overview.data_source.mode, "demo_fixture", "should fall back to demo when snapshot is unsafe");
      const text = JSON.stringify(overview);
      assert.ok(!text.includes("rec_leaked"), "response must not contain leaked record ID");
      assert.ok(!text.includes("record_id"), "response must not contain forbidden key name");
    } finally {
      await new Promise<void>((resolve) => { unsafeServer.close(() => resolve()); });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("500 error returns fixed safe message without stack traces", async () => {
    const failingServer = createServer({
      beforeApiRoute(pathname) {
        if (pathname === "/api/demo/pipeline") {
          throw new Error("internal path /tmp/secret.ts:12 at stack frame");
        }
      },
    });
    await new Promise<void>((resolve) => {
      failingServer.listen(0, () => resolve());
    });
    try {
      const address = failingServer.address();
      assert.ok(address && typeof address === "object");
      const res = await fetch(`http://localhost:${address.port}/api/demo/pipeline`);
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.equal(text, JSON.stringify({ error: "服务内部错误" }));
      assert.ok(!text.includes("Error:"), "error response must not contain Error:");
      assert.ok(!text.includes(".ts:"), "error response must not contain .ts: stack traces");
      assert.ok(!text.includes(".js:"), "error response must not contain .js: stack traces");
      assert.ok(!text.includes(" at "), "error response must not contain stack trace lines");
      assert.ok(!text.includes("/tmp/secret"), "error response must not contain internal paths");
    } finally {
      await new Promise<void>((resolve) => {
        failingServer.close(() => resolve());
      });
    }
  });
});
