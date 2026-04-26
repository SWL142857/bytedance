import type { LiveMvpExecutionAudit } from "./live-mvp-audit.js";

export type LiveRecoveryStatus =
  | "dry_run_only"
  | "blocked_before_write"
  | "completed_successfully"
  | "failed_during_write"
  | "skipped_or_incomplete";

export type LiveRecoveryRiskLevel = "none" | "low" | "medium" | "high";

export interface LiveRecoveryPlan {
  status: LiveRecoveryStatus;
  riskLevel: LiveRecoveryRiskLevel;
  completedCommandCount: number;
  failedCommandIndex: number | null;
  failedCommandDescription: string | null;
  likelyWrittenCommandCount: number;
  manualChecks: string[];
  recommendedAction: string;
  rerunPolicy: string;
}

export function buildLiveRecoveryPlan(
  audit: LiveMvpExecutionAudit,
): LiveRecoveryPlan {
  if (audit.blocked) {
    return buildBlockedRecovery(audit);
  }

  if (audit.mode === "dry_run") {
    return buildDryRunRecovery();
  }

  if (audit.failedCount > 0) {
    return buildFailedRecovery(audit);
  }

  if (audit.skippedCount > 0 || audit.successCount < audit.totalCommands) {
    return buildSkippedRecovery(audit);
  }

  return buildSuccessRecovery(audit);
}

function buildDryRunRecovery(): LiveRecoveryPlan {
  return {
    status: "dry_run_only",
    riskLevel: "none",
    completedCommandCount: 0,
    failedCommandIndex: null,
    failedCommandDescription: null,
    likelyWrittenCommandCount: 0,
    manualChecks: [],
    recommendedAction:
      "No writes were executed. Run read-only resolution and readiness check before executing.",
    rerunPolicy:
      "Safe to re-run. Resolve readiness and config issues first, then execute.",
  };
}

function buildBlockedRecovery(
  _audit: LiveMvpExecutionAudit,
): LiveRecoveryPlan {
  return {
    status: "blocked_before_write",
    riskLevel: "low",
    completedCommandCount: 0,
    failedCommandIndex: null,
    failedCommandDescription: null,
    likelyWrittenCommandCount: 0,
    manualChecks: [],
    recommendedAction:
      "Execution was blocked before any writes. Fix blocked conditions and re-run readiness check.",
    rerunPolicy:
      "Safe to re-run. No writes occurred. Fix config and re-check readiness.",
  };
}

function buildSuccessRecovery(
  audit: LiveMvpExecutionAudit,
): LiveRecoveryPlan {
  return {
    status: "completed_successfully",
    riskLevel: "low",
    completedCommandCount: audit.successCount,
    failedCommandIndex: null,
    failedCommandDescription: null,
    likelyWrittenCommandCount: audit.successCount,
    manualChecks: [
      "Verify Agent Runs records are complete",
      "Verify Candidates status transitioned correctly",
      "Verify Reports table has analytics entry",
    ],
    recommendedAction:
      "All writes completed. Run manual verification of Base records.",
    rerunPolicy:
      "No re-run needed. Verify results in Base.",
  };
}

function buildFailedRecovery(
  audit: LiveMvpExecutionAudit,
): LiveRecoveryPlan {
  return {
    status: "failed_during_write",
    riskLevel: "high",
    completedCommandCount: audit.successCount + audit.failedCount,
    failedCommandIndex: audit.stoppedAtCommandIndex,
    failedCommandDescription: audit.stoppedAtCommandIndex != null
      ? `Command ${audit.stoppedAtCommandIndex} failed`
      : null,
    likelyWrittenCommandCount: audit.successCount,
    manualChecks: [
      "Check Base for records written by preceding successful commands",
      "Compare written records against expected pipeline order",
      "Identify which pipeline stage the failure occurred in",
    ],
    recommendedAction:
      "Write execution failed mid-pipeline. Do NOT re-run the full chain. Manually verify Base for already-written records first, then decide on targeted compensation or retry.",
    rerunPolicy:
      "Do NOT re-run the full pipeline. Check Base for records written by earlier commands, then decide on manual compensation or targeted retry of failed command only.",
  };
}

function buildSkippedRecovery(
  audit: LiveMvpExecutionAudit,
): LiveRecoveryPlan {
  return {
    status: "skipped_or_incomplete",
    riskLevel: "medium",
    completedCommandCount: audit.successCount + audit.failedCount + audit.skippedCount,
    failedCommandIndex: null,
    failedCommandDescription: null,
    likelyWrittenCommandCount: audit.successCount,
    manualChecks: [
      "Review skipped command reasons",
      "Check Base for partially written records",
    ],
    recommendedAction:
      "Some commands were skipped or incomplete. Investigate skipped reasons and resolve before retrying.",
    rerunPolicy:
      "Review skipped reasons before re-running. Partial writes may exist in Base.",
  };
}
