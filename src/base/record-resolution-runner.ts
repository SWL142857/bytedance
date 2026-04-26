import type { HireLoopConfig } from "../config.js";
import {
  buildRecordResolutionPlan,
  recordIdentityKey,
  resolveRecordsFromOutputs,
  type RecordIdentity,
  type ResolvedRecord,
  RecordResolutionError,
} from "./record-resolution.js";
import {
  runReadOnlyCommands,
  type ReadOnlyRunResult,
  type CommandExecutor,
} from "./read-only-runner.js";
import type { RunMode } from "./lark-cli-runner.js";

export interface RecordResolutionRunOptions {
  identities: RecordIdentity[];
  config: HireLoopConfig;
  execute: boolean;
  executor?: CommandExecutor;
}

export interface RecordResolutionRunResult {
  mode: RunMode;
  runResult: ReadOnlyRunResult;
  resolvedRecords: ResolvedRecord[];
}

export function runRecordResolutionPlan(
  options: RecordResolutionRunOptions,
): RecordResolutionRunResult {
  const { identities, config, execute, executor } = options;

  const plan = buildRecordResolutionPlan(identities);

  const runResult = runReadOnlyCommands({
    commands: plan.commands,
    config,
    execute,
    executor,
  });

  if (!execute) {
    return { mode: runResult.mode, runResult, resolvedRecords: [] };
  }

  if (runResult.blocked) {
    return { mode: runResult.mode, runResult, resolvedRecords: [] };
  }

  const allSuccess = runResult.results.every(
    (r) => r.status === "success" && r.stdout !== null,
  );

  if (!allSuccess) {
    return { mode: runResult.mode, runResult, resolvedRecords: [] };
  }

  const stdoutByKey: Record<string, string | null> = {};
  for (let i = 0; i < plan.identities.length; i++) {
    const identity = plan.identities[i]!;
    const key = recordIdentityKey(identity);
    stdoutByKey[key] = runResult.results[i]!.stdout;
  }

  try {
    const resolvedRecords = resolveRecordsFromOutputs(identities, stdoutByKey);
    return { mode: runResult.mode, runResult, resolvedRecords };
  } catch (err) {
    if (err instanceof RecordResolutionError) {
      console.error(`Resolution failed: ${err.message}`);
      return { mode: runResult.mode, runResult, resolvedRecords: [] };
    }
    throw err;
  }
}
