import { spawnSync } from "node:child_process";
import type { BaseCommandSpec } from "./commands.js";
import { injectBaseToken } from "./commands.js";
import type { HireLoopConfig } from "../config.js";
import { validateReadOnlyConfig, redactConfig } from "../config.js";
import type { CommandResult, RunMode } from "./lark-cli-runner.js";

export type { CommandResult };

export interface ReadOnlyRunOptions {
  commands: BaseCommandSpec[];
  config: HireLoopConfig;
  execute: boolean;
  executor?: CommandExecutor;
}

export interface ReadOnlyRunResult {
  mode: RunMode;
  results: CommandResult[];
  blocked: boolean;
}

export type CommandExecutor = (
  command: string,
  args: string[],
) => CommandResult;

const WRITE_SHORTCUTS = [
  "+record-upsert",
  "+table-create",
  "+field-create",
  "+record-delete",
  "+field-delete",
  "+table-delete",
];
const ALLOWED_READ_ONLY_SHORTCUT = "+record-list";
const BASE_TOKEN_PLACEHOLDER = "<BASE_APP_TOKEN>";

export class ReadOnlyExecutionBlockedError extends Error {
  public readonly blockedCommands: string[];
  constructor(blockedCommands: string[]) {
    super(
      `Read-only execution blocked: ${blockedCommands.length} non-read-only command(s) found`,
    );
    this.name = "ReadOnlyExecutionBlockedError";
    this.blockedCommands = blockedCommands;
  }
}

export function assertReadOnlyCommands(
  commands: BaseCommandSpec[],
): void {
  const blocked: string[] = [];

  for (const cmd of commands) {
    if (cmd.writesRemote) {
      blocked.push(cmd.description);
      continue;
    }

    const isAllowedRecordList =
      cmd.command === "lark-cli" &&
      cmd.args[0] === "base" &&
      cmd.args[1] === ALLOWED_READ_ONLY_SHORTCUT;
    if (!isAllowedRecordList) {
      blocked.push(cmd.description);
      continue;
    }

    const baseTokenIndex = cmd.args.indexOf("--base-token");
    const usesInjectedBaseToken =
      cmd.needsBaseToken &&
      baseTokenIndex >= 0 &&
      cmd.args[baseTokenIndex + 1] === BASE_TOKEN_PLACEHOLDER;
    if (!usesInjectedBaseToken) {
      blocked.push(cmd.description);
      continue;
    }

    const hasWriteShortcut = cmd.args.some(
      (arg) => WRITE_SHORTCUTS.includes(arg),
    );
    if (hasWriteShortcut) {
      blocked.push(cmd.description);
    }
  }

  if (blocked.length > 0) {
    throw new ReadOnlyExecutionBlockedError(blocked);
  }
}

function defaultExecutor(
  command: string,
  args: string[],
): CommandResult {
  const start = Date.now();

  const result = spawnSync(command, args, {
    timeout: 30000,
    encoding: "utf-8",
  });

  const durationMs = Date.now() - start;
  const exitCode = result.status ?? null;
  const stdout = result.stdout ?? null;
  const stderr = result.stderr ?? result.error?.message ?? null;
  const status = exitCode === 0 ? "success" as const : "failed" as const;

  return { description: "", status, stdout, stderr, exitCode, durationMs };
}

function redactSensitiveText(
  text: string | null,
  config: HireLoopConfig,
): string | null {
  if (text === null) return null;

  const sensitiveValues = [
    config.larkAppId,
    config.larkAppSecret,
    config.baseAppToken,
    config.modelApiKey,
    config.modelId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  let redacted = text;
  for (const value of sensitiveValues) {
    redacted = redacted.split(value).join("<REDACTED>");
  }
  return redacted;
}

function normalizeCommandResult(
  spec: BaseCommandSpec,
  result: CommandResult,
  config: HireLoopConfig,
): CommandResult {
  return {
    ...result,
    description: spec.description,
    stderr: redactSensitiveText(result.stderr, config),
  };
}

export function runReadOnlyCommands(
  options: ReadOnlyRunOptions,
): ReadOnlyRunResult {
  const { commands, config, execute } = options;
  const mode: RunMode = execute ? "execute" : "dry_run";

  assertReadOnlyCommands(commands);

  if (commands.length === 0) {
    return { mode, results: [], blocked: false };
  }

  if (!execute) {
    const results: CommandResult[] = commands.map((cmd) => ({
      description: cmd.description,
      status: "planned" as const,
      stdout: null,
      stderr: null,
      exitCode: null,
      durationMs: 0,
    }));
    return { mode, results, blocked: false };
  }

  const configErrors = validateReadOnlyConfig(config);
  if (configErrors.length > 0) {
    console.error("Read-only execution blocked due to invalid config:");
    for (const err of configErrors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
    const results: CommandResult[] = commands.map((cmd) => ({
      description: cmd.description,
      status: "skipped" as const,
      stdout: null,
      stderr: null,
      exitCode: null,
      durationMs: 0,
    }));
    return { mode, results, blocked: true };
  }

  if (!config.allowLarkRead) {
    console.error("Read-only execution blocked: HIRELOOP_ALLOW_LARK_READ is not set to 1");
    console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
    const results: CommandResult[] = commands.map((cmd) => ({
      description: cmd.description,
      status: "skipped" as const,
      stdout: null,
      stderr: null,
      exitCode: null,
      durationMs: 0,
    }));
    return { mode, results, blocked: true };
  }

  const executor = options.executor ?? defaultExecutor;

  const results: CommandResult[] = [];

  for (const cmd of commands) {
    console.log(`[READ-ONLY EXECUTING] ${cmd.description}`);
    const baseToken = config.baseAppToken;
    if (!baseToken) {
      results.push({
        description: cmd.description,
        status: "skipped",
        stdout: null,
        stderr: "Missing BASE_APP_TOKEN",
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }

    const { command, args } = injectBaseToken(cmd, baseToken);
    let result: CommandResult;
    try {
      result = normalizeCommandResult(cmd, executor(command, args), config);
    } catch (err) {
      result = {
        description: cmd.description,
        status: "failed",
        stdout: null,
        stderr: redactSensitiveText(
          err instanceof Error ? err.message : String(err),
          config,
        ),
        exitCode: null,
        durationMs: 0,
      };
    }
    results.push(result);

    if (result.status === "failed") {
      console.error(`[FAILED] ${cmd.description}`);
      if (result.stderr) console.error(`  stderr: ${result.stderr}`);
      break;
    }
    console.log(`[SUCCESS] ${cmd.description}`);
  }

  return { mode, results, blocked: false };
}
