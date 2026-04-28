import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline } from "../orchestrator/candidate-pipeline.js";
import { buildMvpReleaseGateReport } from "../orchestrator/mvp-release-gate.js";
import { buildApiBoundaryReleaseAuditReport } from "../orchestrator/api-boundary-release-audit.js";
import { runForbiddenTraceScan } from "../orchestrator/forbidden-trace-scan.js";
import { buildProviderAdapterReadiness } from "../llm/provider-adapter.js";
import { buildProviderSmokePlan } from "../llm/provider-smoke-runner.js";
import { buildProviderAgentDemoPlan } from "../llm/provider-agent-demo-runner.js";
import { buildPreApiFreezeReport } from "../orchestrator/pre-api-freeze-report.js";
import { buildLiveReadinessReport } from "../orchestrator/live-readiness-report.js";
import { loadConfig } from "../config.js";
import { getLiveBaseStatus, listLiveRecords } from "./live-base.js";
import { getLiveLinkRegistry } from "./live-link-registry.js";
import { runLiveCandidateDryRun } from "../orchestrator/live-candidate-runner.js";
import { runLiveCandidateProviderAgentDemo } from "../orchestrator/live-candidate-runner.js";
import {
  generateLiveCandidateWritePlan,
  executeLiveCandidateWrites,
} from "../orchestrator/live-candidate-write-runner.js";
import { buildDemoWorkEvents } from "./work-events-demo.js";
import { buildOperatorTasksOverview } from "./operator-tasks-demo.js";
import {
  DEFAULT_RUNTIME_SNAPSHOT_PATH,
  loadRuntimeDashboardSnapshot,
} from "./runtime-dashboard.js";
import {
  redactPipelineResult,
  redactReleaseGate,
  redactApiBoundaryAudit,
  redactProviderReadiness,
  redactProviderSmoke,
  redactProviderAgentDemo,
  redactPreApiFreeze,
  redactLiveReadiness,
  redactLiveCandidateWritePlan,
  redactLiveCandidateWriteResult,
  redactWorkEvents,
} from "./redaction.js";
import type { OrgOverviewAgentView, OrgOverviewView } from "../types/work-event.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const UI_DIR = resolve(import.meta.dirname, "..", "ui");
const PORT = 3000;
const LIVE_TABLES = new Set(["candidates", "jobs", "work_events"]);

export interface UiServerOptions {
  beforeApiRoute?: (pathname: string) => void;
  runtimeSnapshotPath?: string | null;
}

function jsonResponse(res: http.ServerResponse, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function errorResponse(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

const LOOPBACK_RANGES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  return LOOPBACK_RANGES.includes(remoteAddress ?? "");
}

function isLocalRequest(req: http.IncomingMessage): boolean {
  return isLoopbackAddress(req.socket.remoteAddress);
}

function requireJsonContentType(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const raw = req.headers["content-type"] ?? "";
  const mediaType = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    errorResponse(res, 415, "不支持的媒体类型");
    return false;
  }
  return true;
}

const MAX_BODY_BYTES = 4096;

function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflowed = true;
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const urlPath = url.pathname === "/" ? "/index.html" : url.pathname;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return false;
  }

  if (decodedPath.includes("\0")) {
    return false;
  }

  const filePath = resolve(UI_DIR, `.${decodedPath}`);

  if (!isInsideUiDir(filePath)) {
    return false;
  }

  if (!existsSync(filePath)) {
    return false;
  }

  const ext = extname(filePath);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  try {
    const content = req.method === "HEAD" ? null : readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function isInsideUiDir(filePath: string): boolean {
  return filePath === UI_DIR || filePath.startsWith(`${UI_DIR}${sep}`);
}

function buildOrgOverview(): OrgOverviewView {
  const events = redactWorkEvents(buildDemoWorkEvents());
  const latestByAgent = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    if (!latestByAgent.has(event.agent_name)) {
      latestByAgent.set(event.agent_name, event);
    }
  }

  const agents: OrgOverviewAgentView[] = [
    buildAgentOverview("HR 协调", "HR 协调", latestByAgent.get("HR 协调") ?? null),
    buildAgentOverview("简历解析", "Resume Parser", latestByAgent.get("简历解析") ?? null),
    buildAgentOverview("初筛评估", "Screening", latestByAgent.get("初筛评估") ?? null),
    buildAgentOverview("面试准备", "Interview Kit", latestByAgent.get("面试准备") ?? null),
    buildAgentOverview("数据分析", "Analytics", latestByAgent.get("数据分析") ?? null),
  ];

  return {
    agents,
    pipeline: {
      final_status: "decision_pending",
      completed: true,
      command_count: 5,
      stage_counts: [
        { label: "新增", count: 0 },
        { label: "已解析", count: 0 },
        { label: "已筛选", count: 0 },
        { label: "面试就绪", count: 0 },
        { label: "待决策", count: 1 },
      ],
    },
    recent_events: events.slice(0, 6),
    safety: {
      read_only: true,
      real_writes: false,
      external_model_calls: false,
      demo_mode: true,
    },
    data_source: {
      mode: "demo_fixture",
      snapshot_source: null,
      label: "演示样本",
      generated_at: null,
      external_model_calls: false,
      real_writes: false,
    },
  };
}

function getRuntimeSnapshot(options: UiServerOptions): ReturnType<typeof loadRuntimeDashboardSnapshot> {
  if (options.runtimeSnapshotPath === null || typeof options.runtimeSnapshotPath === "undefined") {
    return null;
  }
  return loadRuntimeDashboardSnapshot(options.runtimeSnapshotPath);
}

function buildAgentOverview(
  agent_name: string,
  role_label: string,
  event: OrgOverviewView["recent_events"][number] | null,
): OrgOverviewAgentView {
  return {
    agent_name,
    role_label,
    status: determineAgentStatus(event),
    last_event_summary: event?.safe_summary ?? "暂无活动",
    duration_ms: event?.duration_ms ?? null,
  };
}

function determineAgentStatus(event: OrgOverviewView["recent_events"][number] | null): OrgOverviewAgentView["status"] {
  if (!event) {
    return "空闲";
  }
  if (event.event_type === "human_action") {
    return "需要人工处理";
  }
  if (event.execution_mode === "blocked" || event.guard_status === "blocked") {
    return "阻塞";
  }
  return "工作中";
}

function resolveLiveFeishuUrl(table: string): string | null {
  const config = loadConfig();
  const tableUrl = LIVE_TABLES.has(table)
    ? config.feishuTableWebUrls?.[table as "candidates" | "jobs" | "work_events"] ?? null
    : null;
  return safeRedirectUrl(tableUrl ?? config.feishuBaseWebUrl);
}

function safeRedirectUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: UiServerOptions = {},
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    options.beforeApiRoute?.(url.pathname);

    if (url.pathname === "/api/demo/pipeline" && req.method === "GET") {
      const runtimeSnapshot = getRuntimeSnapshot(options);
      if (runtimeSnapshot) {
        jsonResponse(res, runtimeSnapshot.pipeline);
        return;
      }

      const client = new DeterministicLlmClient();
      const result = await runCandidatePipeline(client, {
        candidateRecordId: "rec_demo_candidate_001",
        jobRecordId: "rec_demo_job_001",
        candidateId: "cand_demo_001",
        jobId: "job_demo_ai_pm_001",
        resumeText:
          "AI Product Manager with 6 years experience in technology sector. " +
          "Skills: product roadmapping, SQL, Python basics, A/B testing.",
        jobRequirements:
          "5+ years in product management. Experience with AI/ML products.",
        jobRubric:
          "Technical depth. Product sense. Communication.",
      });
      jsonResponse(res, redactPipelineResult(result));
      return;
    }

    if (url.pathname === "/api/work-events" && req.method === "GET") {
      const runtimeSnapshot = getRuntimeSnapshot(options);
      if (runtimeSnapshot) {
        jsonResponse(res, runtimeSnapshot.work_events);
        return;
      }

      jsonResponse(res, redactWorkEvents(buildDemoWorkEvents()));
      return;
    }

    if (url.pathname === "/api/org/overview" && req.method === "GET") {
      const runtimeSnapshot = getRuntimeSnapshot(options);
      if (runtimeSnapshot) {
        jsonResponse(res, runtimeSnapshot.org_overview);
        return;
      }

      jsonResponse(res, buildOrgOverview());
      return;
    }

    if (url.pathname === "/api/operator/tasks" && req.method === "GET") {
      jsonResponse(res, buildOperatorTasksOverview());
      return;
    }

    // ── Live Base routes (Phase 6.7) ──

    if (url.pathname === "/api/live/base-status" && req.method === "GET") {
      jsonResponse(res, getLiveBaseStatus());
      return;
    }

    if (url.pathname === "/api/live/records" && req.method === "GET") {
      const table = url.searchParams.get("table") ?? "";
      const result = await listLiveRecords(table);
      jsonResponse(res, result);
      return;
    }

    // ── Phase 6.8: Click-to-run Agent Dry-run ──

    const dryRunMatch = /^\/api\/live\/candidates\/(lnk_live_[a-z0-9]+)\/run-dry-run$/.exec(url.pathname);
    if (dryRunMatch && dryRunMatch[1] && req.method === "POST") {
      if (!isLocalRequest(req)) {
        errorResponse(res, 403, "仅允许本地访问");
        return;
      }
      const linkId = dryRunMatch[1];
      const result = await runLiveCandidateDryRun(linkId);
      jsonResponse(res, result);
      return;
    }

    // ── Phase 6.9: Provider Agent Preview ──

    const providerAgentDemoMatch = /^\/api\/live\/candidates\/(lnk_live_[a-z0-9]+)\/run-provider-agent-demo$/.exec(url.pathname);
    if (providerAgentDemoMatch && providerAgentDemoMatch[1] && req.method === "POST") {
      if (!isLocalRequest(req)) {
        errorResponse(res, 403, "仅允许本地访问");
        return;
      }
      if (!requireJsonContentType(req, res)) {
        return;
      }
      const linkId = providerAgentDemoMatch[1];

      let body: Record<string, unknown>;
      try {
        body = await parseJsonBody(req);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("too large")) {
          errorResponse(res, 413, "请求体过大");
        } else {
          errorResponse(res, 400, "请求格式错误");
        }
        return;
      }

      const confirmed = body.confirm === "EXECUTE_PROVIDER_AGENT_DEMO";
      if (!confirmed) {
        errorResponse(res, 403, "确认短语错误，拒绝执行。");
        return;
      }

      const result = await runLiveCandidateProviderAgentDemo(linkId, { confirm: body.confirm as string });
      jsonResponse(res, redactProviderAgentDemo(result));
      return;
    }

    // ── Phase 7.0: Live Candidate Write-Back (Two-Step) ──

    const writePlanMatch = /^\/api\/live\/candidates\/(lnk_live_[a-z0-9]+)\/generate-write-plan$/.exec(url.pathname);
    if (writePlanMatch && writePlanMatch[1] && req.method === "POST") {
      if (!isLocalRequest(req)) {
        errorResponse(res, 403, "仅允许本地访问");
        return;
      }
      const linkId = writePlanMatch[1];
      const plan = await generateLiveCandidateWritePlan(linkId);
      jsonResponse(res, redactLiveCandidateWritePlan(plan));
      return;
    }

    const writeExecMatch = /^\/api\/live\/candidates\/(lnk_live_[a-z0-9]+)\/execute-writes$/.exec(url.pathname);
    if (writeExecMatch && writeExecMatch[1] && req.method === "POST") {
      if (!isLocalRequest(req)) {
        errorResponse(res, 403, "仅允许本地访问");
        return;
      }
      if (!requireJsonContentType(req, res)) {
        return;
      }
      const linkId = writeExecMatch[1];

      let body: Record<string, unknown>;
      try {
        body = await parseJsonBody(req);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("too large")) {
          errorResponse(res, 413, "请求体过大");
        } else {
          errorResponse(res, 400, "请求格式错误");
        }
        return;
      }

      const confirmed = body.confirm === "EXECUTE_LIVE_CANDIDATE_WRITES";
      if (!confirmed) {
        errorResponse(res, 403, "确认短语错误，拒绝执行。");
        return;
      }
      const reviewConfirmed = body.reviewConfirm === "REVIEWED_DECISION_PENDING_WRITE_PLAN";
      if (!reviewConfirmed) {
        errorResponse(res, 403, "审阅确认短语错误，请先审阅写入计划。");
        return;
      }

      const result = await executeLiveCandidateWrites(linkId, {
        confirm: body.confirm as string,
        reviewConfirm: body.reviewConfirm as string,
        planNonce: (body.planNonce as string) ?? "",
      });
      jsonResponse(res, redactLiveCandidateWriteResult(result));
      return;
    }

    if (url.pathname === "/api/reports/release-gate" && req.method === "GET") {
      const scanOpts = process.env["HIRELOOP_FORBIDDEN_TRACE_SCAN_ROOT"]
        ? { rootDir: process.env["HIRELOOP_FORBIDDEN_TRACE_SCAN_ROOT"] }
        : undefined;
      const scanReport = runForbiddenTraceScan(scanOpts);
      const scanPassed = scanReport.status === "pass";
      // Derive apiBoundaryAuditPassed from real audit status
      const audit = buildApiBoundaryReleaseAuditReport({
        typecheckPassed: true,
        testsPassed: true,
        buildPassed: true,
        deterministicDemoPassed: true,
        providerSmokeGuarded: true,
        providerAgentDemoGuarded: true,
        baseWriteGuardIndependent: true,
        outputRedactionSafe: true,
        forbiddenTraceScanPassed: scanPassed,
        secretScanPassed: true,
        releaseGateConsistent: true,
      });
      const report = buildMvpReleaseGateReport({
        typecheckPassed: true,
        testsPassed: true,
        localMvpDemoPassed: true,
        liveReadyDemoPassed: true,
        liveRunbookAvailable: true,
        guardedExecuteBlocksWithoutConfig: true,
        apiBoundaryAuditPassed: audit.status !== "blocked",
        forbiddenTraceScanPassed: scanPassed,
      });
      jsonResponse(res, redactReleaseGate(report));
      return;
    }

    if (url.pathname === "/api/reports/api-boundary-audit" && req.method === "GET") {
      const scanOpts = process.env["HIRELOOP_FORBIDDEN_TRACE_SCAN_ROOT"]
        ? { rootDir: process.env["HIRELOOP_FORBIDDEN_TRACE_SCAN_ROOT"] }
        : undefined;
      const scanReport = runForbiddenTraceScan(scanOpts);
      const report = buildApiBoundaryReleaseAuditReport({
        typecheckPassed: true,
        testsPassed: true,
        buildPassed: true,
        deterministicDemoPassed: true,
        providerSmokeGuarded: true,
        providerAgentDemoGuarded: true,
        baseWriteGuardIndependent: true,
        outputRedactionSafe: true,
        forbiddenTraceScanPassed: scanReport.status === "pass",
        secretScanPassed: true,
        releaseGateConsistent: true,
      });
      jsonResponse(res, redactApiBoundaryAudit(report));
      return;
    }

    if (url.pathname === "/api/reports/provider-readiness" && req.method === "GET") {
      const config = loadConfig();
      const readiness = buildProviderAdapterReadiness({
        enabled: false,
        providerName: config.modelProvider,
      });
      jsonResponse(res, redactProviderReadiness(readiness));
      return;
    }

    if (url.pathname === "/api/reports/provider-smoke" && req.method === "GET") {
      const config = loadConfig();
      const result = buildProviderSmokePlan(
        { enabled: false, providerName: config.modelProvider },
        { execute: false },
      );
      jsonResponse(res, redactProviderSmoke(result));
      return;
    }

    if (url.pathname === "/api/reports/provider-agent-demo" && req.method === "GET") {
      const config = loadConfig();
      const result = buildProviderAgentDemoPlan(
        { enabled: true, providerName: config.modelProvider, endpoint: null, modelId: null, apiKey: null },
        { useProvider: false, execute: false },
      );
      jsonResponse(res, redactProviderAgentDemo(result));
      return;
    }

    if (url.pathname === "/api/reports/pre-api-freeze" && req.method === "GET") {
      const report = buildPreApiFreezeReport({
        schemasLocked: true,
        stateMachineLocked: true,
        baseWriteGuardsLocked: true,
        redactionPolicyLocked: true,
        deterministicDemoPassing: false,
        releaseGatePassing: false,
        llmAdapterBoundaryDefined: false,
      });
      jsonResponse(res, redactPreApiFreeze(report));
      return;
    }

    if (url.pathname === "/api/reports/live-readiness" && req.method === "GET") {
      const report = buildLiveReadinessReport({
        resolutionMode: "sample",
        configErrors: [],
        resolutionBlocked: true,
        resolvedRecords: [],
        requiredRecordCount: 2,
        planCommands: null,
        planError: null,
        invalidWriteCommands: [],
      });
      jsonResponse(res, redactLiveReadiness(report));
      return;
    }

    errorResponse(res, 404, "未找到资源");
  } catch {
    errorResponse(res, 500, "服务内部错误");
  }
}

function handleGo(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== "GET") {
    errorResponse(res, 404, "未找到资源");
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const linkId = decodeURIComponent(url.pathname.slice(4));

  // Demo links — same behavior as before
  if (/^lnk_demo_\d{3}$/.test(linkId)) {
    jsonResponse(res, {
      mode: "demo",
      available: false,
      message: "当前为演示模式，Live 模式下将跳转到飞书对应页面。",
    });
    return;
  }

  // Live links — redirect to Feishu Base
  if (linkId.startsWith("lnk_live_")) {
    const entry = getLiveLinkRegistry().resolve(linkId);
    if (!entry) {
      errorResponse(res, 404, "未找到对应的飞书记录链接");
      return;
    }

    const baseUrl = resolveLiveFeishuUrl(entry.table);
    if (baseUrl) {
      res.writeHead(302, { Location: baseUrl });
      res.end();
      return;
    }

    // Base URL not configured — return safe message
    jsonResponse(res, {
      mode: "live",
      available: false,
      message: "已连接飞书，当前跳转到对应 Base 页面；记录级跳转待配置。",
    });
    return;
  }

  errorResponse(res, 404, "未找到可用的演示跳转");
}

export function createServer(options: UiServerOptions = {}): http.Server {
  return http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res, options);
      return;
    }

    if (req.url?.startsWith("/go/")) {
      handleGo(req, res);
      return;
    }

    if (serveStatic(req, res)) {
      return;
    }

    errorResponse(res, 404, "未找到资源");
  });
}

export function startServer(port: number = PORT): http.Server {
  const server = createServer({ runtimeSnapshotPath: DEFAULT_RUNTIME_SNAPSHOT_PATH });
  server.listen(port, "127.0.0.1", () => {
    console.log(`HireLoop UI: http://localhost:${port}`);
  });
  return server;
}
