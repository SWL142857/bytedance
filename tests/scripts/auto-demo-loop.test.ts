import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  formatStatusLine,
  runAutoDemoLoopOnce,
} from "../../scripts/auto-demo-loop.js";

const SCRIPT = resolve(dirname(import.meta.dirname), "..", "scripts", "auto-demo-loop.ts");

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("auto-demo-loop", () => {
  it("calls only read/plan endpoints and builds a safe snapshot", async () => {
    const calls: string[] = [];
    const fakeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${input}`);
      const url = new URL(input);
      if (url.pathname === "/api/live/base-status") {
        return jsonResponse({ readiness: "ready", readEnabled: true, writeDisabled: true });
      }
      if (url.pathname === "/api/live/records" && url.searchParams.get("table") === "candidates") {
        return jsonResponse({ records: [{ display_name: "候选人 A" }, { display_name: "候选人 B" }] });
      }
      if (url.pathname === "/api/live/records" && url.searchParams.get("table") === "jobs") {
        return jsonResponse({ records: [{ title: "AI Engineer" }] });
      }
      if (url.pathname === "/api/work-events") {
        return jsonResponse([{ safe_summary: "Graph RAG Reviewer 完成只读复核" }]);
      }
      if (url.pathname === "/api/competition/overview") {
        return jsonResponse({ status: "ready", candidateCount: 5991, evidenceCount: 23961, roleCount: 38 });
      }
      if (url.pathname === "/api/live/analytics/generate-report-plan") {
        return jsonResponse({ status: "needs_review", candidateCount: 2, commands: [{ table: "Reports" }] });
      }
      return jsonResponse({ error: "not found" }, 404);
    };

    const snapshot = await runAutoDemoLoopOnce("http://localhost:3999/", fakeFetch);

    assert.equal(snapshot.liveBase.ready, true);
    assert.equal(snapshot.liveBase.candidateCount, 2);
    assert.equal(snapshot.liveBase.jobCount, 1);
    assert.equal(snapshot.competition.candidateCount, 5991);
    assert.equal(snapshot.analytics.status, "needs_review");
    assert.equal(snapshot.analytics.commandCount, 1);
    assert.equal(snapshot.safety.frontendNoExecute, true);
    assert.equal(snapshot.safety.planOnly, true);
    assert.equal(snapshot.safety.writeExecution, false);
    assert.equal(snapshot.safety.writesToBase, false);
    assert.ok(calls.includes("GET http://localhost:3999/api/live/base-status"));
    assert.ok(calls.includes("POST http://localhost:3999/api/live/analytics/generate-report-plan"));
    assert.ok(calls.every((call) => !call.includes("/execute-")), "must not call execute endpoints");
  });

  it("formats a compact line for demo monitoring", async () => {
    const fakeFetch = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname === "/api/live/base-status") {
        return jsonResponse({ readiness: "ready", readEnabled: true, writeDisabled: true });
      }
      if (url.pathname === "/api/live/records") {
        return jsonResponse({ records: [] });
      }
      if (url.pathname === "/api/work-events") {
        return jsonResponse([]);
      }
      if (url.pathname === "/api/competition/overview") {
        return jsonResponse({ status: "ready", candidateCount: 5991, evidenceCount: 23961, roleCount: 38 });
      }
      if (init?.method === "POST") {
        return jsonResponse({ status: "blocked", commands: [] });
      }
      return jsonResponse({});
    };
    const snapshot = await runAutoDemoLoopOnce("http://localhost:3999", fakeFetch);
    const line = formatStatusLine(snapshot);

    assert.ok(line.includes("live=ready"));
    assert.ok(line.includes("graph=5991c/23961e/38r"));
    assert.ok(line.includes("analytics=blocked"));
    assert.ok(line.includes("plan-only"));
  });

  it("source does not expose write execution routes or confirm phrases", () => {
    const text = readFileSync(SCRIPT, "utf-8");
    const forbidden = [
      "/execute-report",
      "/execute-writes",
      "/execute-human-decision",
      "EXECUTE_LIVE",
      "REVIEWED_",
      "HIRELOOP_ALLOW_LARK_WRITE",
    ];
    for (const token of forbidden) {
      assert.ok(!text.includes(token), `auto-demo-loop.ts must not contain ${token}`);
    }
  });

  it("accepts pnpm-style -- argument separator", () => {
    const stdout = execFileSync("node", [
      "--import",
      "tsx",
      SCRIPT,
      "--",
      "--once",
      "--json",
      "--base-url=http://127.0.0.1:1",
    ], {
      encoding: "utf-8",
      cwd: process.cwd(),
      timeout: 15_000,
    });
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.safety.frontendNoExecute, true);
    assert.equal(parsed.safety.writeExecution, false);
    assert.equal(parsed.liveBase.readiness, "unavailable");
  });

  it("snapshot output shape avoids sensitive implementation fields", async () => {
    const fakeFetch = async (input: string): Promise<Response> => {
      const url = new URL(input);
      if (url.pathname === "/api/live/base-status") {
        return jsonResponse({ readiness: "partial", readEnabled: true, writeDisabled: true });
      }
      if (url.pathname === "/api/competition/overview") {
        return jsonResponse({ status: "ready", candidateCount: 1, evidenceCount: 2, roleCount: 3 });
      }
      return jsonResponse({ records: [{ record_id: "rec_should_not_be_copied" }] });
    };
    const snapshot = await runAutoDemoLoopOnce("http://localhost:3999", fakeFetch);
    const output = JSON.stringify(snapshot);
    const forbidden = ["record_id", "table_id", "payload", "stdout", "stderr", "secret", "token"];

    for (const token of forbidden) {
      assert.ok(!output.includes(token), `snapshot must not contain ${token}`);
    }
  });
});
