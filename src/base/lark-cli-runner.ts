import { spawnSync } from "node:child_process";
import type { BaseCommandSpec } from "./commands.js";
import { injectBaseToken } from "./commands.js";
import type { HireLoopConfig } from "../config.js";
import { validateExecutionConfig, redactConfig } from "../config.js";

export type CommandResultStatus = "planned" | "skipped" | "success" | "failed";

export interface CommandResult {
  description: string;
  status: CommandResultStatus;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number;
}

export interface RunResult {
  results: CommandResult[];
  totalDurationMs: number;
  blocked: boolean;
}

export class ExecutionBlockedError extends Error {
  constructor(
    public readonly validationErrors: Array<{ field: string; message: string }>,
  ) {
    super(
      `Execution blocked: ${validationErrors.map((e) => e.field).join(", ")}`,
    );
    this.name = "ExecutionBlockedError";
  }
}

export function runCommands(
  specs: BaseCommandSpec[],
  config: HireLoopConfig,
  execute: boolean = false,
): RunResult {
  const results: CommandResult[] = [];
  const startTime = Date.now();

  if (execute) {
    if (!config.allowLarkWrite) {
      validateExecutionConfig(config);
      console.error("Execution blocked: HIRELOOP_ALLOW_LARK_WRITE is not set to 1");
      console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
      for (const spec of specs) {
        results.push({
          description: spec.description,
          status: "skipped",
          stdout: null,
          stderr: null,
          exitCode: null,
          durationMs: 0,
        });
      }
      return { results, totalDurationMs: Date.now() - startTime, blocked: true };
    }

    const errors = validateExecutionConfig(config);
    if (errors.length > 0) {
      console.error("Execution blocked due to invalid config:");
      for (const err of errors) {
        console.error(`  - ${err.field}: ${err.message}`);
      }
      console.error("Redacted config:", JSON.stringify(redactConfig(config), null, 2));
      for (const spec of specs) {
        results.push({
          description: spec.description,
          status: "skipped",
          stdout: null,
          stderr: null,
          exitCode: null,
          durationMs: 0,
        });
      }
      return { results, totalDurationMs: Date.now() - startTime, blocked: true };
    }
  }

  for (const spec of specs) {
    if (!execute) {
      results.push({
        description: spec.description,
        status: "planned",
        stdout: null,
        stderr: null,
        exitCode: null,
        durationMs: 0,
      });
      console.log(`[PLANNED] ${spec.description}`);
      console.log(`  Command: ${spec.redactedArgs.join(" ")}`);
      continue;
    }

    const baseToken = config.baseAppToken;
    if (!baseToken) {
      results.push({
        description: spec.description,
        status: "skipped",
        stdout: null,
        stderr: "Missing BASE_APP_TOKEN",
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }

    const { command, args } = injectBaseToken(spec, baseToken);
    const cmdStart = Date.now();
    console.log(`[EXECUTING] ${spec.description}`);

    const result = spawnSync(command, args, {
      timeout: 30000,
      encoding: "utf-8",
    });

    const durationMs = Date.now() - cmdStart;
    const exitCode = result.status ?? null;
    const stdout = result.stdout ?? null;
    const stderr = result.stderr ?? null;

    const status: CommandResultStatus = exitCode === 0 ? "success" : "failed";

    if (status === "failed") {
      console.error(`[FAILED] ${spec.description}`);
      if (stderr) console.error(`  stderr: ${stderr}`);
    } else {
      console.log(`[SUCCESS] ${spec.description}`);
    }

    results.push({
      description: spec.description,
      status,
      stdout,
      stderr,
      exitCode,
      durationMs,
    });

    if (status === "failed") {
      console.error(`Aborting: command "${spec.description}" failed with exit code ${exitCode}`);
      break;
    }
  }

  return {
    results,
    totalDurationMs: Date.now() - startTime,
    blocked: false,
  };
}
