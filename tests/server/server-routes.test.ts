import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, isLoopbackAddress } from "../../src/server/server.js";
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
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
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
    // Forbidden Trace Scan check uses real scanner now, not hardcoded
    const checks = data.checks as Array<{ name: string; status: string }>;
    const ftCheck = checks.find((c) => c.name.includes("Forbidden") || c.name.includes("forbidden"));
    assert.ok(ftCheck, "Should have Forbidden Trace Scan check");
    assert.match(ftCheck!.status, /^(pass|block)$/);
  });

  it("GET /api/reports/api-boundary-audit returns audit report", async () => {
    const data = await fetchJson("/api/reports/api-boundary-audit");
    assert.equal(data.title, "API Boundary Release Audit");
    assert.equal(data.defaultExternalModelCallsPermittedByReport, false);
    assert.equal(data.realBaseWritesPermittedByReport, false);
    // Forbidden Trace Scan check uses real scanner now, not hardcoded
    const checks = data.checks as Array<{ name: string; status: string }>;
    const ftCheck = checks.find((c) => c.name.includes("Forbidden") || c.name.includes("forbidden"));
    assert.ok(ftCheck, "Should have Forbidden Trace Scan check");
    assert.match(ftCheck!.status, /^(pass|block)$/);
  });

  it("release gate and api boundary audit responses do not leak forbidden trace findings", async () => {
    const paths = ["/api/reports/release-gate", "/api/reports/api-boundary-audit"];
    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`);
      const text = await res.text();
      assert.ok(!text.includes("findingCount"), `${path} must not leak findingCount`);
      assert.ok(!text.includes("findings"), `${path} must not leak findings array`);
      assert.ok(!text.includes("categories"), `${path} must not leak scan categories`);
      assert.ok(!text.includes("secret_marker"), `${path} must not leak scan category names`);
      assert.ok(!text.includes("unsafe_raw_field"), `${path} must not leak scan category names`);
      assert.ok(!text.includes("unsafe_output_token"), `${path} must not leak scan category names`);
      assert.ok(!text.includes("Forbidden trace pattern detected"), `${path} must not leak scan safeSummary text`);
    }
  });

  // ── Phase 6.7: Live routes ──

  it("GET /api/live/base-status returns safe status (not 500)", async () => {
    const res = await fetch(`${BASE_URL}/api/live/base-status`);
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(typeof data.readEnabled, "boolean");
    assert.equal(typeof data.writeDisabled, "boolean");
    assert.ok(Array.isArray(data.blockedReasons));
    // Without env, should show blocked but not crash
    assert.equal(data.readEnabled, false);
  });

  it("GET /api/live/records without table returns empty", async () => {
    const res = await fetch(`${BASE_URL}/api/live/records`);
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(data.records));
    assert.equal(data.total, 0);
  });

  it("GET /api/live/records?table=candidates returns empty without env", async () => {
    const res = await fetch(`${BASE_URL}/api/live/records?table=candidates`);
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(data.records));
  });

  it("live API responses do not leak rec_ or sensitive fields", async () => {
    const paths = ["/api/live/base-status", "/api/live/records?table=candidates", "/api/live/records?table=jobs"];
    for (const path of paths) {
      const res = await fetch(`${BASE_URL}${path}`);
      const text = await res.text();
      assert.ok(!text.includes("rec_"), `${path} must not contain rec_`);
      assert.ok(!text.includes("table_id"), `${path} must not contain table_id`);
      assert.ok(!text.includes("payload"), `${path} must not contain payload`);
      assert.ok(!text.includes("stdout"), `${path} must not contain stdout`);
      assert.ok(!text.includes("stderr"), `${path} must not contain stderr`);
      assert.ok(!text.includes("resumeText"), `${path} must not contain resumeText`);
      assert.ok(!text.includes("apiKey"), `${path} must not contain apiKey`);
      assert.ok(!text.includes("endpoint"), `${path} must not contain endpoint`);
      assert.ok(!text.includes("modelId"), `${path} must not contain modelId`);
    }
  });

  it("GET /api/live/base-status via non-GET returns 404", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await fetch(`${BASE_URL}/api/live/base-status`, { method });
      assert.equal(res.status, 404);
    }
  });

  // ── Phase 6.8: Dry-run routes ──

  it("POST /api/live/candidates/:linkId/run-dry-run with unknown link returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/run-dry-run`, { method: "POST" });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
  });

  it("GET /api/live/candidates/:linkId/run-dry-run returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-dry-run`);
    assert.equal(res.status, 404);
  });

  it("dry-run response does not leak rec_/resume/payload/stdout/stderr", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/run-dry-run`, { method: "POST" });
    const text = await res.text();
    assert.ok(!text.includes("rec_"), "must not contain rec_");
    assert.ok(!text.includes("resume"), "must not contain resume");
    assert.ok(!text.includes("payload"), "must not contain payload");
    assert.ok(!text.includes("stdout"), "must not contain stdout");
    assert.ok(!text.includes("stderr"), "must not contain stderr");
    assert.ok(!text.includes("record_id"), "must not contain record_id");
    assert.ok(!text.includes("prompt"), "must not contain prompt");
    assert.ok(!text.includes("apiKey"), "must not contain apiKey");
  });

  // ── Phase 6.9: Provider Agent Preview routes ──

  it("loopback guard only accepts local socket addresses", () => {
    assert.equal(isLoopbackAddress("127.0.0.1"), true);
    assert.equal(isLoopbackAddress("::1"), true);
    assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
    assert.equal(isLoopbackAddress("192.168.1.20"), false);
    assert.equal(isLoopbackAddress("10.0.0.3"), false);
    assert.equal(isLoopbackAddress(undefined), false);
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo with wrong confirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "wrong" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "确认短语错误，拒绝执行。");
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo with missing confirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo rejects non-JSON content type", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "text/plain; note=application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_PROVIDER_AGENT_DEMO" }),
    });
    assert.equal(res.status, 415);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "不支持的媒体类型");
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo accepts JSON content type case-insensitively", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "Application/JSON; charset=utf-8" },
      body: JSON.stringify({ confirm: "wrong" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "确认短语错误，拒绝执行。");
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo rejects oversized JSON body with 413", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: "EXECUTE_PROVIDER_AGENT_DEMO",
        padding: "x".repeat(5000),
      }),
    });
    assert.equal(res.status, 413);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "请求体过大");
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo rejects non-object JSON body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "请求格式错误");
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo with invalid link returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_PROVIDER_AGENT_DEMO" }),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.ok(Array.isArray(data.blockedReasons));
    const reasons = data.blockedReasons as string[];
    assert.ok(reasons.some((r) => r.includes("未找到")), "should mention link not found");
  });

  it("POST /api/live/candidates/:linkId/run-provider-agent-demo with valid link returns blocked when Base unavailable", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_provider_demo_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_PROVIDER_AGENT_DEMO" }),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    // Without lark-cli and env, Base status will be blocked
    assert.equal(data.status, "blocked");
    assert.equal(typeof data.providerName, "string");
    assert.equal(typeof data.safeSummary, "string");
  });

  it("GET /api/live/candidates/:linkId/run-provider-agent-demo returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/run-provider-agent-demo`);
    assert.equal(res.status, 404);
  });

  it("provider agent demo response does not leak sensitive fields", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_sensitive_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_PROVIDER_AGENT_DEMO" }),
    });
    const text = await res.text();
    assert.ok(!text.includes("rec_"), "must not contain rec_");
    assert.ok(!text.includes("resume"), "must not contain resume text");
    assert.ok(!text.includes("payload"), "must not contain payload");
    assert.ok(!text.includes("stdout"), "must not contain stdout");
    assert.ok(!text.includes("stderr"), "must not contain stderr");
    assert.ok(!text.includes("apiKey"), "must not contain apiKey");
    assert.ok(!text.includes("endpoint"), "must not contain endpoint");
    assert.ok(!text.includes("modelId"), "must not contain modelId");
    assert.ok(!text.includes("prompt"), "must not contain prompt");
  });

  it("provider agent demo with correct confirm uses safe Chinese error messages", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/run-provider-agent-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_PROVIDER_AGENT_DEMO" }),
    });
    const text = await res.text();
    assert.ok(!text.includes("Error:"), "must not leak Error:");
    assert.ok(!text.includes("stack"), "must not leak stack");
    assert.ok(!text.includes(".ts:"), "must not leak .ts: paths");
  });

  // ── Phase 7.0: Live Candidate Write-Back ──

  it("POST /api/live/candidates/:linkId/generate-write-plan with unknown link returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/generate-write-plan`, { method: "POST" });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.ok(Array.isArray(data.blockedReasons));
  });

  it("POST /api/live/candidates/:linkId/generate-write-plan with registered link returns planned or blocked", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_write_plan_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/generate-write-plan`, { method: "POST" });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    // Without lark-cli, Base status will be blocked; but the route itself works
    assert.ok(data.status === "planned" || data.status === "blocked");
    assert.equal(typeof data.planNonce, "string");
  });

  const WRITE_BODY = {
    confirm: "EXECUTE_LIVE_CANDIDATE_WRITES",
    reviewConfirm: "REVIEWED_DECISION_PENDING_WRITE_PLAN",
    planNonce: "deadbeef12345678",
  };

  it("POST /api/live/candidates/:linkId/execute-writes with wrong confirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "wrong", reviewConfirm: "REVIEWED_DECISION_PENDING_WRITE_PLAN", planNonce: "abc123" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "确认短语错误，拒绝执行。");
  });

  it("POST /api/live/candidates/:linkId/execute-writes with wrong reviewConfirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_LIVE_CANDIDATE_WRITES", reviewConfirm: "wrong", planNonce: "abc123" }),
    });
    assert.equal(res.status, 403);
  });

  it("POST /api/live/candidates/:linkId/execute-writes rejects non-JSON content type", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(WRITE_BODY),
    });
    assert.equal(res.status, 415);
  });

  it("POST /api/live/candidates/:linkId/execute-writes rejects oversized JSON body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...WRITE_BODY, filler: "x".repeat(5000) }),
    });
    assert.equal(res.status, 413);
  });

  it("POST /api/live/candidates/:linkId/execute-writes rejects non-object JSON body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "请求格式错误");
  });

  it("POST /api/live/candidates/:linkId/execute-writes with double confirm but invalid link returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(WRITE_BODY),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.equal(data.executed, false);
  });

  it("POST /api/live/candidates/:linkId/execute-writes with registered link and double confirm returns blocked when Base unavailable", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_write_exec_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...WRITE_BODY, planNonce: "deadbeef" }),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.equal(data.executed, false);
  });

  it("GET /api/live/candidates/:linkId/generate-write-plan returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-write-plan`);
    assert.equal(res.status, 404);
  });

  it("GET /api/live/candidates/:linkId/execute-writes returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-writes`);
    assert.equal(res.status, 404);
  });

  // ── Phase 7.7: Live Human Decision ──

  const DECISION_PLAN_BODY = {
    decision: "offer",
    decidedBy: "hiring_manager",
    decisionNote: "Strong technical skills and culture fit.",
  };

  const DECISION_EXEC_BODY = {
    confirm: "EXECUTE_LIVE_HUMAN_DECISION",
    reviewConfirm: "REVIEWED_HUMAN_DECISION_PLAN",
    planNonce: "deadbeef12345678",
    decision: "offer",
    decidedBy: "hiring_manager",
    decisionNote: "Strong technical skills and culture fit.",
  };

  it("POST generate-human-decision-plan with invalid decision returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "invalid", decidedBy: "mgr", decisionNote: "test" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { error: string };
    assert.ok(data.error.includes("decision"));
  });

  it("POST generate-human-decision-plan with missing decision returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decidedBy: "mgr", decisionNote: "test" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { error: string };
    assert.ok(data.error.includes("decision"));
  });

  it("POST generate-human-decision-plan with empty decidedBy returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "offer", decidedBy: "", decisionNote: "test" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { error: string };
    assert.ok(data.error.includes("decidedBy"));
  });

  it("POST generate-human-decision-plan with empty decisionNote returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "offer", decidedBy: "mgr", decisionNote: "" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json() as { error: string };
    assert.ok(data.error.includes("decisionNote"));
  });

  it("POST generate-human-decision-plan rejects non-JSON content type", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(DECISION_PLAN_BODY),
    });
    assert.equal(res.status, 415);
  });

  it("POST generate-human-decision-plan rejects oversized body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DECISION_PLAN_BODY, filler: "x".repeat(5000) }),
    });
    assert.equal(res.status, 413);
  });

  it("POST generate-human-decision-plan rejects non-object JSON", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(res.status, 400);
  });

  it("POST generate-human-decision-plan with unknown link returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DECISION_PLAN_BODY),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.ok(Array.isArray(data.blockedReasons));
  });

  it("POST generate-human-decision-plan with registered link returns planned or blocked", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_decision_plan_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/generate-human-decision-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DECISION_PLAN_BODY),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.ok(data.status === "planned" || data.status === "blocked");
    assert.equal(typeof data.planNonce, "string");
  });

  it("POST execute-human-decision with wrong confirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DECISION_EXEC_BODY, confirm: "wrong" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "确认短语错误，拒绝执行。");
  });

  it("POST execute-human-decision with wrong reviewConfirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DECISION_EXEC_BODY, reviewConfirm: "wrong" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "审阅确认短语错误，请先审阅决策计划。");
  });

  it("POST execute-human-decision with missing decision returns 400", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "EXECUTE_LIVE_HUMAN_DECISION", reviewConfirm: "REVIEWED_HUMAN_DECISION_PLAN", planNonce: "abc", decidedBy: "mgr", decisionNote: "test" }),
    });
    assert.equal(res.status, 400);
  });

  it("POST execute-human-decision rejects non-JSON content type", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(DECISION_EXEC_BODY),
    });
    assert.equal(res.status, 415);
  });

  it("POST execute-human-decision rejects oversized body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DECISION_EXEC_BODY, filler: "x".repeat(5000) }),
    });
    assert.equal(res.status, 413);
  });

  it("POST execute-human-decision rejects non-object JSON", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    assert.equal(res.status, 400);
  });

  it("POST execute-human-decision with double confirm but unknown link returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_nonexistent/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DECISION_EXEC_BODY),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.equal(data.executed, false);
  });

  it("GET generate-human-decision-plan returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/generate-human-decision-plan`);
    assert.equal(res.status, 404);
  });

  it("GET execute-human-decision returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/candidates/lnk_live_test123/execute-human-decision`);
    assert.equal(res.status, 404);
  });

  // ── Phase 7.8: Live Analytics Report ──

  const ANALYTICS_PLAN_BODY = {};

  const ANALYTICS_EXEC_BODY = {
    confirm: "EXECUTE_LIVE_ANALYTICS_REPORT_WRITE",
    reviewConfirm: "REVIEWED_LIVE_ANALYTICS_REPORT_PLAN",
    planNonce: "deadbeef12345678",
  };

  it("POST generate-report-plan rejects non-JSON content type", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/generate-report-plan`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(ANALYTICS_PLAN_BODY),
    });
    assert.equal(res.status, 415);
  });

  it("POST generate-report-plan rejects oversized body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/generate-report-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filler: "x".repeat(5000) }),
    });
    assert.equal(res.status, 413);
  });

  it("POST generate-report-plan rejects non-object JSON", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/generate-report-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(res.status, 400);
  });

  it("POST generate-report-plan returns blocked or needs_review without env", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/generate-report-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ANALYTICS_PLAN_BODY),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.ok(data.status === "blocked" || data.status === "needs_review");
    assert.equal(typeof data.planNonce, "string");
    assert.equal(typeof data.safeSummary, "string");
  });

  it("POST execute-report with wrong confirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ANALYTICS_EXEC_BODY, confirm: "wrong" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "确认短语错误，拒绝执行。");
  });

  it("POST execute-report with wrong reviewConfirm returns 403", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ANALYTICS_EXEC_BODY, reviewConfirm: "wrong" }),
    });
    assert.equal(res.status, 403);
    const data = await res.json() as { error: string };
    assert.equal(data.error, "审阅确认短语错误，请先审阅报告计划。");
  });

  it("POST execute-report rejects non-JSON content type", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(ANALYTICS_EXEC_BODY),
    });
    assert.equal(res.status, 415);
  });

  it("POST execute-report rejects oversized body", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ANALYTICS_EXEC_BODY, filler: "x".repeat(5000) }),
    });
    assert.equal(res.status, 413);
  });

  it("POST execute-report rejects non-object JSON", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    assert.equal(res.status, 400);
  });

  it("POST execute-report with double confirm but bad nonce returns blocked", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ANALYTICS_EXEC_BODY),
    });
    assert.ok(res.ok);
    const data = await res.json() as Record<string, unknown>;
    assert.equal(data.status, "blocked");
    assert.equal(data.executed, false);
  });

  it("GET generate-report-plan returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/generate-report-plan`);
    assert.equal(res.status, 404);
  });

  it("GET execute-report returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`);
    assert.equal(res.status, 404);
  });

  it("analytics responses do not leak sensitive fields", async () => {
    const paths = [
      { path: "/api/live/analytics/generate-report-plan", body: JSON.stringify(ANALYTICS_PLAN_BODY) },
      { path: "/api/live/analytics/execute-report", body: JSON.stringify(ANALYTICS_EXEC_BODY) },
    ];
    for (const { path, body } of paths) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      assert.ok(!text.includes("rec_"), `${path} must not contain rec_`);
      assert.ok(!text.includes("payload"), `${path} must not contain payload`);
      assert.ok(!text.includes("stdout"), `${path} must not contain stdout`);
      assert.ok(!text.includes("stderr"), `${path} must not contain stderr`);
      assert.ok(!text.includes("apiKey"), `${path} must not contain apiKey`);
      assert.ok(!text.includes("endpoint"), `${path} must not contain endpoint`);
      assert.ok(!text.includes("modelId"), `${path} must not contain modelId`);
      assert.ok(!text.includes("baseAppToken"), `${path} must not contain baseAppToken`);
    }
  });

  it("analytics responses use safe Chinese error messages", async () => {
    const res = await fetch(`${BASE_URL}/api/live/analytics/execute-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ANALYTICS_EXEC_BODY),
    });
    const text = await res.text();
    assert.ok(!text.includes("Error:"), "must not leak Error:");
    assert.ok(!text.includes("stack"), "must not leak stack");
    assert.ok(!text.includes(".ts:"), "must not leak .ts: paths");
    assert.ok(!text.includes(".js:"), "must not leak .js: paths");
  });

  it("human decision responses do not leak sensitive fields", async () => {
    const paths = [
      { path: "/api/live/candidates/lnk_live_nonexistent/generate-human-decision-plan", body: JSON.stringify(DECISION_PLAN_BODY) },
      { path: "/api/live/candidates/lnk_live_nonexistent/execute-human-decision", body: JSON.stringify(DECISION_EXEC_BODY) },
    ];
    for (const { path, body } of paths) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const text = await res.text();
      assert.ok(!text.includes("rec_"), `${path} must not contain rec_`);
      assert.ok(!text.includes("payload"), `${path} must not contain payload`);
      assert.ok(!text.includes("stdout"), `${path} must not contain stdout`);
      assert.ok(!text.includes("stderr"), `${path} must not contain stderr`);
      assert.ok(!text.includes("apiKey"), `${path} must not contain apiKey`);
      assert.ok(!text.includes("endpoint"), `${path} must not contain endpoint`);
      assert.ok(!text.includes("modelId"), `${path} must not contain modelId`);
      assert.ok(!text.includes("baseAppToken"), `${path} must not contain baseAppToken`);
    }
  });

  it("human decision responses use safe Chinese error messages", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_decision_safe_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/execute-human-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...DECISION_EXEC_BODY, planNonce: "deadbeef" }),
    });
    const text = await res.text();
    assert.ok(!text.includes("Error:"), "must not leak Error:");
    assert.ok(!text.includes("stack"), "must not leak stack");
    assert.ok(!text.includes(".ts:"), "must not leak .ts: paths");
    assert.ok(!text.includes(".js:"), "must not leak .js: paths");
  });

  it("write plan and execute responses do not leak sensitive fields", async () => {
    const paths = [
      { path: "/api/live/candidates/lnk_live_nonexistent/generate-write-plan", method: "POST", body: null },
      { path: "/api/live/candidates/lnk_live_nonexistent/execute-writes", method: "POST",
        body: JSON.stringify(WRITE_BODY) },
    ];
    for (const { path, method, body } of paths) {
      const opts: RequestInit = {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      };
      const res = await fetch(`${BASE_URL}${path}`, opts);
      const text = await res.text();
      assert.ok(!text.includes("rec_"), `${path} must not contain rec_`);
      assert.ok(!text.includes("payload"), `${path} must not contain payload`);
      assert.ok(!text.includes("stdout"), `${path} must not contain stdout`);
      assert.ok(!text.includes("stderr"), `${path} must not contain stderr`);
      assert.ok(!text.includes("apiKey"), `${path} must not contain apiKey`);
      assert.ok(!text.includes("endpoint"), `${path} must not contain endpoint`);
      assert.ok(!text.includes("modelId"), `${path} must not contain modelId`);
      assert.ok(!text.includes("prompt"), `${path} must not contain prompt`);
      assert.ok(!text.includes("baseAppToken"), `${path} must not contain baseAppToken`);
    }
  });

  it("write plan and execute responses use safe Chinese error messages", async () => {
    const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
    const linkId = getLiveLinkRegistry().register("candidates", "rec_test_safe_msg_001");
    const res = await fetch(`${BASE_URL}/api/live/candidates/${linkId}/execute-writes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...WRITE_BODY, planNonce: "deadbeef" }),
    });
    const text = await res.text();
    assert.ok(!text.includes("Error:"), "must not leak Error:");
    assert.ok(!text.includes("stack"), "must not leak stack");
    assert.ok(!text.includes(".ts:"), "must not leak .ts: paths");
    assert.ok(!text.includes(".js:"), "must not leak .js: paths");
  });

  it("GET /go/lnk_live_* returns 302 with FEISHU_BASE_WEB_URL configured", async () => {
    const prev = process.env.FEISHU_BASE_WEB_URL;
    const prevCandidates = process.env.FEISHU_CANDIDATES_WEB_URL;
    const prevJobs = process.env.FEISHU_JOBS_WEB_URL;
    const prevEvents = process.env.FEISHU_WORK_EVENTS_WEB_URL;
    process.env.FEISHU_BASE_WEB_URL = "https://example.feishu.cn/base/xxx";
    delete process.env.FEISHU_CANDIDATES_WEB_URL;
    delete process.env.FEISHU_JOBS_WEB_URL;
    delete process.env.FEISHU_WORK_EVENTS_WEB_URL;
    try {
      // Create a new server so it picks up the env
      const { createServer } = await import("../../src/server/server.js");
      const srv = createServer();
      await new Promise<void>((resolve) => { srv.listen(0, () => resolve()); });
      try {
        const addr = srv.address();
        assert.ok(addr && typeof addr === "object");
        // First register a link via the API
        const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
        const linkId = getLiveLinkRegistry().register("candidates", "rec_test_001");
        const res = await fetch(`http://localhost:${addr.port}/go/${linkId}`, { redirect: "manual" });
        assert.equal(res.status, 302);
        assert.ok(res.headers.get("location")?.includes("example.feishu.cn"));
      } finally {
        await new Promise<void>((resolve) => { srv.close(() => resolve()); });
      }
    } finally {
      if (prev === undefined) delete process.env.FEISHU_BASE_WEB_URL;
      else process.env.FEISHU_BASE_WEB_URL = prev;
      if (prevCandidates === undefined) delete process.env.FEISHU_CANDIDATES_WEB_URL;
      else process.env.FEISHU_CANDIDATES_WEB_URL = prevCandidates;
      if (prevJobs === undefined) delete process.env.FEISHU_JOBS_WEB_URL;
      else process.env.FEISHU_JOBS_WEB_URL = prevJobs;
      if (prevEvents === undefined) delete process.env.FEISHU_WORK_EVENTS_WEB_URL;
      else process.env.FEISHU_WORK_EVENTS_WEB_URL = prevEvents;
    }
  });

  it("GET /go/lnk_live_* prefers the matching Feishu table URL when configured", async () => {
    const prevBase = process.env.FEISHU_BASE_WEB_URL;
    const prevCandidates = process.env.FEISHU_CANDIDATES_WEB_URL;
    const prevJobs = process.env.FEISHU_JOBS_WEB_URL;
    try {
      process.env.FEISHU_BASE_WEB_URL = "https://example.feishu.cn/base/main";
      process.env.FEISHU_CANDIDATES_WEB_URL = "https://example.feishu.cn/base/candidates";
      process.env.FEISHU_JOBS_WEB_URL = "https://example.feishu.cn/base/jobs";
      const { createServer } = await import("../../src/server/server.js");
      const srv = createServer();
      await new Promise<void>((resolve) => { srv.listen(0, () => resolve()); });
      try {
        const addr = srv.address();
        assert.ok(addr && typeof addr === "object");
        const { getLiveLinkRegistry } = await import("../../src/server/live-link-registry.js");
        const candidateLinkId = getLiveLinkRegistry().register("candidates", "rec_test_candidate");
        const jobLinkId = getLiveLinkRegistry().register("jobs", "rec_test_job");
        const candidateRes = await fetch(`http://localhost:${addr.port}/go/${candidateLinkId}`, { redirect: "manual" });
        const jobRes = await fetch(`http://localhost:${addr.port}/go/${jobLinkId}`, { redirect: "manual" });
        assert.equal(candidateRes.status, 302);
        assert.equal(jobRes.status, 302);
        assert.equal(candidateRes.headers.get("location"), "https://example.feishu.cn/base/candidates");
        assert.equal(jobRes.headers.get("location"), "https://example.feishu.cn/base/jobs");
      } finally {
        await new Promise<void>((resolve) => { srv.close(() => resolve()); });
      }
    } finally {
      if (prevBase === undefined) delete process.env.FEISHU_BASE_WEB_URL;
      else process.env.FEISHU_BASE_WEB_URL = prevBase;
      if (prevCandidates === undefined) delete process.env.FEISHU_CANDIDATES_WEB_URL;
      else process.env.FEISHU_CANDIDATES_WEB_URL = prevCandidates;
      if (prevJobs === undefined) delete process.env.FEISHU_JOBS_WEB_URL;
      else process.env.FEISHU_JOBS_WEB_URL = prevJobs;
    }
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

  it("GET UI ES modules serves JS", async () => {
    const modules = [
      "app.js",
      "constants.js",
      "helpers.js",
      "safety-badge.js",
      "drawer.js",
      "work-events.js",
      "pipeline.js",
      "operator-tasks.js",
      "reports.js",
      "live-records.js",
      "candidate-detail.js",
    ];
    for (const mod of modules) {
      const res = await fetch(`${BASE_URL}/${mod}`);
      assert.ok(res.ok, `${mod} must be served`);
      assert.ok(res.headers.get("content-type")?.includes("javascript"), `${mod} must be served as JS`);
    }
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

  it("UI modules render link.available-gated event links without real Feishu URLs", async () => {
    const workRes = await fetch(`${BASE_URL}/work-events.js`);
    const workText = await workRes.text();
    assert.ok(workText.includes("event-link-unavailable"), "work-events.js must include unavailable link class");
    assert.ok(workText.includes("飞书记录未接入"), "work-events.js must include unavailable link text");
    for (const mod of ["app.js", "work-events.js", "live-records.js", "candidate-detail.js"]) {
      const res = await fetch(`${BASE_URL}/${mod}`);
      const text = await res.text();
      assert.ok(!text.includes("feishu.cn"), `${mod} must not reference real feishu.cn URLs`);
      assert.ok(!text.includes("larksuite.com"), `${mod} must not reference real larksuite URLs`);
      assert.ok(!text.includes("base_app_token"), `${mod} must not contain base_app_token`);
    }
  });

  it("UI modules expose live Feishu buttons via browser redirects", async () => {
    const liveRes = await fetch(`${BASE_URL}/live-records.js`);
    const liveText = await liveRes.text();
    const indexRes = await fetch(`${BASE_URL}/`);
    const indexText = await indexRes.text();
    assert.ok(liveText.includes("window._hireloopOpenFeishu"), "live-records.js must expose live open helper");
    assert.ok(liveText.includes('window.open("/go/" + encodeURIComponent(linkId)'), "live links must use browser navigation, not fetch redirects");
    assert.ok(indexText.includes("飞书实时数据"), "index.html must render live Feishu data section");
  });

  it("live records opens candidate detail only from candidate rows", async () => {
    const liveRes = await fetch(`${BASE_URL}/live-records.js`);
    const liveText = await liveRes.text();
    const jobCallStart = liveText.indexOf('renderLiveRecords(\n            "live-jobs"');
    const jobCallEnd = liveText.indexOf(");", jobCallStart);
    const jobCall = jobCallStart >= 0 && jobCallEnd >= 0 ? liveText.slice(jobCallStart, jobCallEnd) : "";
    assert.ok(liveText.includes("onRowClick"), "candidate rows should use explicit row click wiring");
    assert.ok(liveText.includes("window._hireloopOpenCandidateDetail(linkId, candidateData)"), "candidate rows should open detail panel");
    assert.ok(jobCallStart >= 0, "jobs list render call should exist");
    assert.ok(!jobCall.includes("onRowClick"), "jobs rows must not open candidate detail panel");
  });

  it("app.js does not encourage live execute write actions", async () => {
    const res = await fetch(`${BASE_URL}/app.js`);
    const text = await res.text();
    assert.ok(!text.includes("EXECUTE_LIVE"), "app.js must not contain live execute confirmation tokens");
    assert.ok(!text.includes("HIRELOOP_ALLOW_LARK_WRITE"), "app.js must not embed write permission env names");
    assert.ok(!text.includes("--execute"), "app.js must not embed execute CLI args");
  });

  it("all UI modules do not contain EXECUTE_LIVE_CANDIDATE_WRITES or /execute-writes", async () => {
    const modules = [
      "app.js",
      "constants.js",
      "helpers.js",
      "safety-badge.js",
      "drawer.js",
      "work-events.js",
      "pipeline.js",
      "operator-tasks.js",
      "reports.js",
      "live-records.js",
      "candidate-detail.js",
    ];
    for (const mod of modules) {
      const res = await fetch(`${BASE_URL}/${mod}`);
      const text = await res.text();
      assert.ok(!text.includes("EXECUTE_LIVE_CANDIDATE_WRITES"), `${mod} must not contain EXECUTE_LIVE_CANDIDATE_WRITES`);
      assert.ok(!text.includes("/execute-writes"), `${mod} must not contain /execute-writes`);
    }
  });

  it("candidate-detail.js contains allowed routes only", async () => {
    const res = await fetch(`${BASE_URL}/candidate-detail.js`);
    const text = await res.text();
    assert.ok(text.includes("generate-write-plan"), "candidate-detail.js should reference generate-write-plan");
    assert.ok(text.includes("run-dry-run"), "candidate-detail.js should reference run-dry-run");
    assert.ok(text.includes("run-provider-agent-demo"), "candidate-detail.js should reference run-provider-agent-demo");
    assert.ok(!text.includes("execute-writes"), "candidate-detail.js must not reference execute-writes");
  });

  it("UI modules and index.html include source hints for static-only sections", async () => {
    const tasksRes = await fetch(`${BASE_URL}/operator-tasks.js`);
    const tasksText = await tasksRes.text();
    const indexRes = await fetch(`${BASE_URL}/`);
    const indexText = await indexRes.text();
    assert.ok(tasksText.includes("静态只读清单"), "operator-tasks.js must include source hint");
    assert.ok(tasksText.includes("不来自运行快照"), "operator-tasks.js must include snapshot exclusion hint");
    assert.ok(indexText.includes("本地安全报告，不来自运行快照"), "index.html must include console source hint");
  });

  it("safety-badge.js has data_source display logic and does not hardcode 演示模式", async () => {
    const res = await fetch(`${BASE_URL}/safety-badge.js`);
    const text = await res.text();
    assert.ok(text.includes("updateModePill"), "safety-badge.js must include updateModePill function");
    assert.ok(text.includes("updateFooterMeta"), "safety-badge.js must include updateFooterMeta function");
    assert.ok(text.includes("data_source"), "safety-badge.js must reference data_source field");
    assert.ok(text.includes("runtime_snapshot"), "safety-badge.js must reference runtime_snapshot mode");
    assert.ok(text.includes("运行快照已脱敏"), "safety-badge.js must include runtime snapshot redaction label");
    assert.ok(text.includes("演示样本已脱敏"), "safety-badge.js must include demo fixture redaction label");
  });

  it("safety-badge.js safety sub text is data-source aware, not hardcoded", async () => {
    const res = await fetch(`${BASE_URL}/safety-badge.js`);
    const text = await res.text();
    assert.ok(!text.includes("当前为只读演示模式"), "must not contain hardcoded demo safety sub text");
    assert.ok(text.includes("buildSafetySubText"), "must include buildSafetySubText helper");
    assert.ok(text.includes("当前展示本地运行快照"), "must include deterministic snapshot safety text");
    assert.ok(text.includes("当前展示模型运行快照"), "must include provider snapshot safety text");
    assert.ok(text.includes("当前展示演示样本"), "must include demo fixture safety text");
  });

  it("safety-badge.js shows generated_at in footer for runtime snapshot", async () => {
    const sbRes = await fetch(`${BASE_URL}/safety-badge.js`);
    const sbText = await sbRes.text();
    const helperRes = await fetch(`${BASE_URL}/helpers.js`);
    const helperText = await helperRes.text();
    assert.ok(sbText.includes("generated_at"), "safety-badge.js must reference generated_at field");
    assert.ok(helperText.includes("formatDateTime"), "helpers.js must include formatDateTime function");
    assert.ok(sbText.includes("生成 "), "safety-badge.js must include 生成 prefix for generated_at");
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

  it("UI modules do not expose raw fetch error messages", async () => {
    const modules = ["app.js", "helpers.js", "live-records.js", "candidate-detail.js"];
    for (const mod of modules) {
      const res = await fetch(`${BASE_URL}/${mod}`);
      const text = await res.text();
      assert.ok(!text.includes("returned "), `${mod} must not contain raw fetch status text`);
      assert.ok(!text.includes("GET /api"), `${mod} must not contain raw fetch path in error messages`);
    }
  });

  it("UI translates report status codes and provider summaries", async () => {
    const constRes = await fetch(`${BASE_URL}/constants.js`);
    const constText = await constRes.text();
    const cssRes = await fetch(`${BASE_URL}/style.css`);
    const cssText = await cssRes.text();
    assert.ok(constText.includes('needs_review: "待复核"'), "needs_review should render as Chinese copy");
    assert.ok(constText.includes('dry_run: "干跑"'), "dry_run should render as Chinese copy");
    assert.ok(constText.includes('"Provider adapter is not enabled.": "模型供应商适配器未启用。"'));
    assert.ok(constText.includes('"No commands to validate.": "暂无可验证命令。"'));
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
