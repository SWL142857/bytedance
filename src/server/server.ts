import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { DeterministicLlmClient } from "../llm/deterministic-client.js";
import { runCandidatePipeline } from "../orchestrator/candidate-pipeline.js";
import { buildMvpReleaseGateReport } from "../orchestrator/mvp-release-gate.js";
import { buildApiBoundaryReleaseAuditReport } from "../orchestrator/api-boundary-release-audit.js";
import { buildProviderAdapterReadiness } from "../llm/provider-adapter.js";
import { buildProviderSmokePlan } from "../llm/provider-smoke-runner.js";
import { buildProviderAgentDemoPlan } from "../llm/provider-agent-demo-runner.js";
import { buildPreApiFreezeReport } from "../orchestrator/pre-api-freeze-report.js";
import { buildLiveReadinessReport } from "../orchestrator/live-readiness-report.js";
import { loadConfig } from "../config.js";
import { buildDemoWorkEvents } from "./work-events-demo.js";
import { buildOperatorTasksOverview } from "./operator-tasks-demo.js";
import {
  redactPipelineResult,
  redactReleaseGate,
  redactApiBoundaryAudit,
  redactProviderReadiness,
  redactProviderSmoke,
  redactProviderAgentDemo,
  redactPreApiFreeze,
  redactLiveReadiness,
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

const UI_DIR = join(import.meta.dirname, "..", "ui");
const PORT = 3000;

function jsonResponse(res: http.ServerResponse, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function errorResponse(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
  const filePath = join(UI_DIR, urlPath);

  if (!filePath.startsWith(UI_DIR)) {
    return false;
  }

  if (!existsSync(filePath)) {
    return false;
  }

  const ext = extname(filePath);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
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
        { label: "新增", count: 1 },
        { label: "已解析", count: 1 },
        { label: "已筛选", count: 1 },
        { label: "面试就绪", count: 1 },
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
  };
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

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/api/demo/pipeline" && req.method === "GET") {
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
      jsonResponse(res, redactWorkEvents(buildDemoWorkEvents()));
      return;
    }

    if (url.pathname === "/api/org/overview" && req.method === "GET") {
      jsonResponse(res, buildOrgOverview());
      return;
    }

    if (url.pathname === "/api/operator/tasks" && req.method === "GET") {
      jsonResponse(res, buildOperatorTasksOverview());
      return;
    }

    if (url.pathname === "/api/reports/release-gate" && req.method === "GET") {
      const report = buildMvpReleaseGateReport({
        typecheckPassed: true,
        testsPassed: true,
        localMvpDemoPassed: true,
        liveReadyDemoPassed: true,
        liveRunbookAvailable: true,
        guardedExecuteBlocksWithoutConfig: true,
        apiBoundaryAuditPassed: true,
        forbiddenTraceScanPassed: false,
      });
      jsonResponse(res, redactReleaseGate(report));
      return;
    }

    if (url.pathname === "/api/reports/api-boundary-audit" && req.method === "GET") {
      const report = buildApiBoundaryReleaseAuditReport({
        typecheckPassed: true,
        testsPassed: true,
        buildPassed: true,
        deterministicDemoPassed: true,
        providerSmokeGuarded: true,
        providerAgentDemoGuarded: true,
        baseWriteGuardIndependent: true,
        outputRedactionSafe: true,
        forbiddenTraceScanPassed: false,
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

  if (!/^lnk_demo_\d{3}$/.test(linkId)) {
    errorResponse(res, 404, "未找到可用的演示跳转");
    return;
  }

  jsonResponse(res, {
    mode: "demo",
    available: false,
    message: "当前为演示模式，Live 模式下将跳转到飞书对应页面。",
  });
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
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
  const server = createServer();
  server.listen(port, () => {
    console.log(`HireLoop UI: http://localhost:${port}`);
  });
  return server;
}
