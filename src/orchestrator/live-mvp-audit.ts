import type { CommandResult } from "../base/lark-cli-runner.js";
import type { LiveMvpWriteRunResult } from "./live-mvp-runner.js";

export interface LiveMvpExecutionAudit {
  mode: "dry_run" | "execute";
  blocked: boolean;
  executed: boolean;
  totalCommands: number;
  plannedCount: number;
  skippedCount: number;
  successCount: number;
  failedCount: number;
  stoppedAtCommandIndex: number | null;
  stoppedAtDescription: string | null;
  recoveryNote: string;
}

function countByStatus(
  results: CommandResult[],
  status: CommandResult["status"],
): number {
  return results.filter((r) => r.status === status).length;
}

export function buildLiveMvpExecutionAudit(
  result: LiveMvpWriteRunResult,
): LiveMvpExecutionAudit {
  const mode = result.mode;
  const totalCommands = result.plan.commands.length;

  const plannedCount = countByStatus(result.results, "planned");
  const skippedCount = countByStatus(result.results, "skipped");
  const successCount = countByStatus(result.results, "success");
  const failedCount = countByStatus(result.results, "failed");

  let stoppedAtCommandIndex: number | null = null;
  let stoppedAtDescription: string | null = null;

  const failedIdx = result.results.findIndex((r) => r.status === "failed");
  if (failedIdx >= 0) {
    stoppedAtCommandIndex = failedIdx + 1;
    stoppedAtDescription = result.results[failedIdx]!.description;
  }

  const recoveryNote = buildRecoveryNote(
    result.blocked,
    mode,
    totalCommands,
    plannedCount,
    skippedCount,
    successCount,
    failedCount,
    stoppedAtCommandIndex,
    result.blockedReasons,
  );

  return {
    mode,
    blocked: result.blocked,
    executed: result.executed,
    totalCommands,
    plannedCount,
    skippedCount,
    successCount,
    failedCount,
    stoppedAtCommandIndex,
    stoppedAtDescription,
    recoveryNote,
  };
}

function buildRecoveryNote(
  blocked: boolean,
  mode: "dry_run" | "execute",
  totalCommands: number,
  plannedCount: number,
  skippedCount: number,
  successCount: number,
  failedCount: number,
  stoppedAtCommandIndex: number | null,
  blockedReasons: string[],
): string {
  if (blocked) {
    const reasonCount = blockedReasons.length;
    return `Execution blocked. No writes were executed. Fix blockedReasons (${reasonCount}) before retrying.`;
  }

  if (mode === "dry_run") {
    return "Dry-run only. No writes were executed. Confirm read-only resolution succeeds, then re-run with execute mode.";
  }

  if (failedCount > 0 && stoppedAtCommandIndex !== null) {
    return `Write failed at command ${stoppedAtCommandIndex}. Do NOT re-run the full pipeline. Check Base for records written by earlier commands, then decide on manual compensation or targeted retry.`;
  }

  if (skippedCount > 0) {
    return `${skippedCount} command(s) were skipped. Check skipped reasons above before retrying.`;
  }

  if (
    successCount === totalCommands &&
    totalCommands > 0 &&
    plannedCount === 0 &&
    failedCount === 0 &&
    skippedCount === 0
  ) {
    return "All writes completed successfully. Verify results in Base: check Agent Runs, Candidates, and Reports tables.";
  }

  if (
    successCount > 0 &&
    successCount < totalCommands &&
    failedCount === 0 &&
    skippedCount === 0
  ) {
    return `Incomplete execution: ${successCount} of ${totalCommands} commands succeeded with no failure recorded. Check Base for partial writes before retrying.`;
  }

  return "No commands were processed.";
}
