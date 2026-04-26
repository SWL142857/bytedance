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

export interface RecordResolutionRunOptions {
  identities: RecordIdentity[];
  config: HireLoopConfig;
  execute: boolean;
  executor?: CommandExecutor;
}

export interface RecordResolutionRunResult {
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
    return { runResult, resolvedRecords: [] };
  }

  if (runResult.blocked) {
    return { runResult, resolvedRecords: [] };
  }

  const allSuccess = runResult.results.every(
    (r) => r.status === "success" && r.stdout !== null,
  );

  if (!allSuccess) {
    return { runResult, resolvedRecords: [] };
  }

  const stdoutByKey: Record<string, string | null> = {};
  for (let i = 0; i < plan.identities.length; i++) {
    const identity = plan.identities[i]!;
    const key = recordIdentityKey(identity);
    stdoutByKey[key] = runResult.results[i]!.stdout;
  }

  try {
    const resolvedRecords = resolveRecordsFromOutputs(identities, stdoutByKey);
    return { runResult, resolvedRecords };
  } catch (err) {
    if (err instanceof RecordResolutionError) {
      console.error(`Resolution failed: ${err.message}`);
      return { runResult, resolvedRecords: [] };
    }
    throw err;
  }
}
