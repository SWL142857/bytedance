import {
  buildProviderAdapterReadiness,
  mapProviderAdapterError,
  type ProviderAdapterConfig,
} from "./provider-adapter.js";
import { OpenAICompatibleClient } from "./openai-compatible-client.js";
import { runResumeParser, type ResumeParserInput } from "../agents/resume-parser.js";
import type { LlmClient } from "./client.js";

export type ProviderAgentDemoMode = "dry_run" | "execute";
export type ProviderAgentDemoStatus =
  | "planned"
  | "blocked"
  | "success"
  | "failed";

export interface ProviderAgentDemoResult {
  mode: ProviderAgentDemoMode;
  status: ProviderAgentDemoStatus;
  providerName: string;
  canCallExternalModel: boolean;
  commandCount: number | null;
  agentRunStatus: string | null;
  retryCount: number | null;
  durationMs: number;
  blockedReasons: string[];
  safeSummary: string;
}

export interface ProviderAgentDemoOptions {
  useProvider: boolean;
  execute: boolean;
  confirm?: string;
}

const REQUIRED_CONFIRM = "EXECUTE_PROVIDER_AGENT_DEMO";

export function buildProviderAgentDemoPlan(
  config: ProviderAdapterConfig,
  options: ProviderAgentDemoOptions,
  input?: ResumeParserInput | null,
): ProviderAgentDemoResult {
  if (!options.useProvider && !options.execute) {
    return {
      mode: "dry_run",
      status: "planned",
      providerName: config.providerName,
      canCallExternalModel: false,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: [],
      safeSummary: "Dry-run only. Provider agent demo is not using provider mode.",
    };
  }

  if (!options.useProvider && options.execute) {
    return {
      mode: "execute",
      status: "blocked",
      providerName: config.providerName,
      canCallExternalModel: false,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: ["--use-provider is required for provider agent demo."],
      safeSummary: "Provider agent demo is blocked. --use-provider is required.",
    };
  }

  const readiness = buildProviderAdapterReadiness(config);

  if (!options.execute) {
    return {
      mode: "dry_run",
      status: "planned",
      providerName: config.providerName,
      canCallExternalModel: readiness.canCallExternalModel,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: [],
      safeSummary: `Provider agent demo is planned for "${config.providerName}". Use --execute and --confirm to run.`,
    };
  }

  const blocked = buildExecuteBlockedReasons(config, readiness, options);
  if (!input) {
    blocked.push("Resume parser input is required.");
  }

  if (blocked.length > 0) {
    return {
      mode: "execute",
      status: "blocked",
      providerName: config.providerName,
      canCallExternalModel: readiness.canCallExternalModel,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs: 0,
      blockedReasons: blocked,
      safeSummary: `Provider agent demo is blocked. Fix ${blocked.length} issue(s) before retrying.`,
    };
  }

  return {
    mode: "execute",
    status: "planned",
    providerName: config.providerName,
    canCallExternalModel: readiness.canCallExternalModel,
    commandCount: null,
    agentRunStatus: null,
    retryCount: null,
    durationMs: 0,
    blockedReasons: [],
    safeSummary: `Provider agent demo for "${config.providerName}" is ready to execute.`,
  };
}

export async function runProviderAgentDemo(
  config: ProviderAdapterConfig,
  options: ProviderAgentDemoOptions,
  clientOverride?: LlmClient,
  input?: ResumeParserInput | null,
): Promise<ProviderAgentDemoResult> {
  const plan = buildProviderAgentDemoPlan(config, options, input);

  if (plan.status !== "planned" || plan.mode !== "execute") {
    return plan;
  }

  const start = Date.now();

  try {
    const client = clientOverride ?? new OpenAICompatibleClient({ config });
    const result = await runResumeParser(client, input as ResumeParserInput);
    const durationMs = Date.now() - start;
    const completed = result.agentRun.run_status !== "failed";

    return {
      mode: "execute",
      status: completed ? "success" : "failed",
      providerName: config.providerName,
      canCallExternalModel: true,
      commandCount: result.commands.length,
      agentRunStatus: result.agentRun.run_status,
      retryCount: result.agentRun.retry_count,
      durationMs,
      blockedReasons: [],
      safeSummary: completed
        ? `Legacy provider parser demo succeeded with ${result.commands.length} command(s).`
        : "Legacy provider parser demo failed safely. Parser did not produce a successful output.",
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const mapped = mapProviderAdapterError(err);

    return {
      mode: "execute",
      status: "failed",
      providerName: config.providerName,
      canCallExternalModel: true,
      commandCount: null,
      agentRunStatus: null,
      retryCount: null,
      durationMs,
      blockedReasons: [],
      safeSummary: mapped.safeMessage,
    };
  }
}

function buildExecuteBlockedReasons(
  config: ProviderAdapterConfig,
  readiness: ReturnType<typeof buildProviderAdapterReadiness>,
  options: ProviderAgentDemoOptions,
): string[] {
  const reasons: string[] = [];

  if (!options.useProvider) {
    reasons.push("--use-provider is required for provider agent demo.");
  }

  if (!readiness.canCallExternalModel) {
    reasons.push("Provider adapter is not ready.");
  }

  if (options.confirm !== REQUIRED_CONFIRM) {
    reasons.push("Confirmation phrase is required.");
  }

  if (!config.endpoint) {
    reasons.push("Missing required config: endpoint.");
  }

  if (!config.modelId) {
    reasons.push("Missing required config: model ID.");
  }

  if (!config.apiKey) {
    reasons.push("Missing required config: API key.");
  }

  return reasons;
}
