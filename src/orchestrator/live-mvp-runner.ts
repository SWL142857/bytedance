import { spawnSync } from "node:child_process";
import { injectBaseToken, type BaseCommandSpec } from "../base/commands.js";
import type { CommandResult } from "../base/lark-cli-runner.js";
import type { ResolvedRecord } from "../base/record-resolution.js";
import type { HireLoopConfig } from "../config.js";
import { redactConfig, validateExecutionConfig } from "../config.js";
import type { LlmClient } from "../llm/client.js";
import {
  buildLiveMvpPlan,
  type LiveMvpPlanResult,
} from "./live-mvp-plan.js";

export const LIVE_MVP_WRITE_CONFIRMATION = "EXECUTE_LIVE_MVP_WRITES";

export type LiveMvpWriteExecutor = (
  command: string,
  args: string[],
) => CommandResult;

export type LiveMvpResolutionSource = "sample" | "readonly";

export interface LiveMvpWriteRunOptions {
  resolvedRecords: ResolvedRecord[];
  resolutionSource?: LiveMvpResolutionSource;
  config: HireLoopConfig;
  execute: boolean;
  confirmation?: string;
  decision: "offer" | "rejected";
  decidedBy: string;
  decisionNote: string;
  client?: LlmClient;
  executor?: LiveMvpWriteExecutor;
}

export interface LiveMvpWriteRunResult {
  plan: LiveMvpPlanResult;
  results: CommandResult[];
  blocked: boolean;
  executed: boolean;
  blockedReasons: string[];
}

export class LiveMvpWriteBlockedError extends Error {
  public readonly blockedCommands: string[];

  constructor(blockedCommands: string[]) {
    super(
      `Live MVP write execution blocked: ${blockedCommands.length} invalid command(s) found`,
    );
    this.name = "LiveMvpWriteBlockedError";
    this.blockedCommands = blockedCommands;
  }
}

const BASE_TOKEN_PLACEHOLDER = "<BASE_APP_TOKEN>";
const ALLOWED_WRITE_SHORTCUT = "+record-upsert";

export function assertLiveMvpWriteCommands(commands: BaseCommandSpec[]): void {
  const blocked: string[] = [];

  for (const cmd of commands) {
    const isAllowedUpsert =
      cmd.command === "lark-cli" &&
      cmd.args[0] === "base" &&
      cmd.args[1] === ALLOWED_WRITE_SHORTCUT;
    const baseTokenIndex = cmd.args.indexOf("--base-token");
    const usesInjectedBaseToken =
      cmd.needsBaseToken &&
      baseTokenIndex >= 0 &&
      cmd.args[baseTokenIndex + 1] === BASE_TOKEN_PLACEHOLDER;

    if (!cmd.writesRemote || !isAllowedUpsert || !usesInjectedBaseToken) {
      blocked.push(cmd.description);
    }
  }

  if (blocked.length > 0) {
    throw new LiveMvpWriteBlockedError(blocked);
  }
}

function plannedResults(commands: BaseCommandSpec[], status: CommandResult["status"]): CommandResult[] {
  return commands.map((cmd) => ({
    description: cmd.description,
    status,
    stdout: null,
    stderr: null,
    exitCode: null,
    durationMs: 0,
  }));
}

function defaultExecutor(command: string, args: string[]): CommandResult {
  const start = Date.now();
  const result = spawnSync(command, args, {
    timeout: 30000,
    encoding: "utf-8",
  });

  const exitCode = result.status ?? null;
  return {
    description: "",
    status: exitCode === 0 ? "success" : "failed",
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? result.error?.message ?? null,
    exitCode,
    durationMs: Date.now() - start,
  };
}

function redactSensitiveText(text: string | null, config: HireLoopConfig): string | null {
  if (text === null) return null;
  const sensitiveValues = [
    config.larkAppId,
    config.larkAppSecret,
    config.baseAppToken,
    config.modelApiKey,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  let redacted = text;
  for (const value of sensitiveValues) {
    redacted = redacted.split(value).join("<REDACTED>");
  }
  return redacted.slice(0, 500);
}

function normalizeResult(
  command: BaseCommandSpec,
  result: CommandResult,
  config: HireLoopConfig,
): CommandResult {
  return {
    description: command.description,
    status: result.status,
    stdout: null,
    stderr: redactSensitiveText(result.stderr, config),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
}

function buildBlockedResult(
  plan: LiveMvpPlanResult,
  blockedReasons: string[],
): LiveMvpWriteRunResult {
  return {
    plan,
    results: plannedResults(plan.commands, "skipped"),
    blocked: true,
    executed: false,
    blockedReasons,
  };
}

export async function runLiveMvpWrites(
  options: LiveMvpWriteRunOptions,
): Promise<LiveMvpWriteRunResult> {
  const plan = await buildLiveMvpPlan(
    {
      resolvedRecords: options.resolvedRecords,
      decision: options.decision,
      decidedBy: options.decidedBy,
      decisionNote: options.decisionNote,
    },
    options.client,
  );

  try {
    assertLiveMvpWriteCommands(plan.commands);
  } catch (err) {
    if (err instanceof LiveMvpWriteBlockedError) {
      return buildBlockedResult(
        plan,
        err.blockedCommands.map((cmd) => `Invalid write command: ${cmd}`),
      );
    }
    throw err;
  }

  if (!options.execute) {
    return {
      plan,
      results: plannedResults(plan.commands, "planned"),
      blocked: false,
      executed: false,
      blockedReasons: [],
    };
  }

  if (options.resolutionSource !== "readonly") {
    return buildBlockedResult(plan, [
      "Live write execution requires read-only resolution source",
    ]);
  }

  if (options.confirmation !== LIVE_MVP_WRITE_CONFIRMATION) {
    return buildBlockedResult(plan, [
      `Missing confirmation phrase: ${LIVE_MVP_WRITE_CONFIRMATION}`,
    ]);
  }

  const configErrors = validateExecutionConfig(options.config);
  if (configErrors.length > 0) {
    console.error("Live MVP write execution blocked due to invalid config:");
    for (const err of configErrors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("Redacted config:", JSON.stringify(redactConfig(options.config), null, 2));
    return buildBlockedResult(
      plan,
      configErrors.map((err) => `${err.field}: ${err.message}`),
    );
  }

  const executor = options.executor ?? defaultExecutor;
  const results: CommandResult[] = [];

  for (const cmd of plan.commands) {
    const baseToken = options.config.baseAppToken;
    if (!baseToken) {
      results.push({
        description: cmd.description,
        status: "skipped",
        stdout: null,
        stderr: "Missing BASE_APP_TOKEN",
        exitCode: null,
        durationMs: 0,
      });
      break;
    }

    const { command, args } = injectBaseToken(cmd, baseToken);
    let result: CommandResult;
    try {
      result = normalizeResult(cmd, executor(command, args), options.config);
    } catch (err) {
      result = {
        description: cmd.description,
        status: "failed",
        stdout: null,
        stderr: redactSensitiveText(
          err instanceof Error ? err.message : String(err),
          options.config,
        ),
        exitCode: null,
        durationMs: 0,
      };
    }

    results.push(result);
    if (result.status !== "success") {
      break;
    }
  }

  return {
    plan,
    results,
    blocked: false,
    executed: true,
    blockedReasons: [],
  };
}
