export type LiveOperatorRunbookStepStatus =
  | "ready"
  | "blocked"
  | "manual"
  | "not_run";

export interface LiveOperatorRunbookStep {
  order: number;
  name: string;
  status: LiveOperatorRunbookStepStatus;
  summary: string;
  commandHint: string;
}

export interface LiveOperatorRunbook {
  title: string;
  readyForHumanExecution: boolean;
  liveWriteAllowedByReport: boolean;
  manualApprovalRequired: boolean;
  steps: LiveOperatorRunbookStep[];
  finalSafetyNote: string;
}

export interface LiveOperatorRunbookInput {
  readinessReady: boolean;
  safeToExecuteLiveWrites: boolean;
  dryRunCommandCount: number;
  verificationStatus: "not_run" | "passed" | "failed" | "needs_review";
  recoveryStatus:
    | "dry_run_only"
    | "blocked_before_write"
    | "completed_successfully"
    | "failed_during_write"
    | "skipped_or_incomplete";
}

export function buildLiveOperatorRunbook(
  input: LiveOperatorRunbookInput,
): LiveOperatorRunbook {
  const readyForHumanExecution =
    input.readinessReady &&
    input.safeToExecuteLiveWrites &&
    input.dryRunCommandCount > 0;

  const steps: LiveOperatorRunbookStep[] = [
    buildReadinessStep(input),
    buildDryRunStep(input),
    buildApprovalStep(),
    buildExecuteStep(input),
    buildRecoveryStep(input),
    buildVerificationStep(input),
  ];

  return {
    title: "Live Operator Runbook",
    readyForHumanExecution,
    liveWriteAllowedByReport: input.safeToExecuteLiveWrites,
    manualApprovalRequired: true,
    steps,
    finalSafetyNote:
      "Do NOT blindly re-run the full pipeline on failure. Review the execution audit, recovery plan, and verification report first. Check Base for already-written records before deciding on targeted compensation or retry.",
  };
}

function buildReadinessStep(
  input: LiveOperatorRunbookInput,
): LiveOperatorRunbookStep {
  if (input.readinessReady) {
    return {
      order: 1,
      name: "Readiness Review",
      status: "ready",
      summary: "Readiness check passed. Config, resolution, and plan are valid.",
      commandHint: "pnpm mvp:live-readiness",
    };
  }
  return {
    order: 1,
    name: "Readiness Review",
    status: "blocked",
    summary: "Readiness check failed. Fix config, resolution, or plan before proceeding.",
    commandHint: "pnpm mvp:live-readiness",
  };
}

function buildDryRunStep(
  input: LiveOperatorRunbookInput,
): LiveOperatorRunbookStep {
  if (input.dryRunCommandCount === 0) {
    return {
      order: 2,
      name: "Dry-run Write Plan Review",
      status: "blocked",
      summary: "Dry-run produced 0 commands. Resolve plan generation issues first.",
      commandHint: "pnpm mvp:live-write:dry-run",
    };
  }
  return {
    order: 2,
    name: "Dry-run Write Plan Review",
    status: "ready",
    summary: `Dry-run produced ${input.dryRunCommandCount} planned commands. Review before proceeding.`,
    commandHint: "pnpm mvp:live-write:dry-run",
  };
}

function buildApprovalStep(): LiveOperatorRunbookStep {
  return {
    order: 3,
    name: "Human Approval Gate",
    status: "manual",
    summary: "Manual human review required before live execution. Confirm readiness and dry-run results.",
    commandHint: "Review checks above, then proceed to guarded execute.",
  };
}

function buildExecuteStep(
  input: LiveOperatorRunbookInput,
): LiveOperatorRunbookStep {
  if (!input.readinessReady || !input.safeToExecuteLiveWrites || input.dryRunCommandCount === 0) {
    return {
      order: 4,
      name: "Guarded Live Execute",
      status: "blocked",
      summary: "Cannot execute. Preceding checks must pass first.",
      commandHint: "pnpm mvp:live-write:execute (requires all checks ready)",
    };
  }
  return {
    order: 4,
    name: "Guarded Live Execute",
    status: "ready",
    summary: "Preconditions met. Execute with guarded runner after human approval.",
    commandHint: "pnpm mvp:live-write:execute",
  };
}

function buildRecoveryStep(
  input: LiveOperatorRunbookInput,
): LiveOperatorRunbookStep {
  const status: LiveOperatorRunbookStepStatus =
    input.recoveryStatus === "completed_successfully"
      ? "ready"
      : input.recoveryStatus === "failed_during_write"
        ? "blocked"
        : input.recoveryStatus === "dry_run_only" || input.recoveryStatus === "blocked_before_write"
          ? "not_run"
          : "blocked";

  const summary = buildRecoverySummary(input.recoveryStatus);

  return {
    order: 5,
    name: "Recovery Review",
    status,
    summary,
    commandHint: "pnpm mvp:live-recovery",
  };
}

function buildRecoverySummary(
  recoveryStatus: LiveOperatorRunbookInput["recoveryStatus"],
): string {
  if (recoveryStatus === "completed_successfully") {
    return "Writes completed successfully. Review verification results.";
  }
  if (recoveryStatus === "failed_during_write") {
    return "Recovery status failed_during_write. Do NOT re-run the full pipeline. Review recovery plan and check Base for partial writes first.";
  }
  if (recoveryStatus === "blocked_before_write") {
    return "Execution was blocked before any writes. No recovery action needed.";
  }
  if (recoveryStatus === "skipped_or_incomplete") {
    return "Some commands were skipped or incomplete. Review recovery plan before retrying.";
  }
  return "No live execution has occurred yet. Run dry-run first.";
}

function buildVerificationStep(
  input: LiveOperatorRunbookInput,
): LiveOperatorRunbookStep {
  if (input.verificationStatus === "passed") {
    return {
      order: 6,
      name: "Post-write Verification",
      status: "ready",
      summary: "Verification checks passed. Spot-check Base records for data correctness.",
      commandHint: "pnpm mvp:live-verification",
    };
  }
  if (input.verificationStatus === "failed") {
    return {
      order: 6,
      name: "Post-write Verification",
      status: "blocked",
      summary: "Verification found missing or incomplete records. Investigate before proceeding.",
      commandHint: "pnpm mvp:live-verification",
    };
  }
  if (input.verificationStatus === "needs_review") {
    return {
      order: 6,
      name: "Post-write Verification",
      status: "manual",
      summary: "Some verification checks need manual review.",
      commandHint: "pnpm mvp:live-verification",
    };
  }
  return {
    order: 6,
    name: "Post-write Verification",
    status: "not_run",
    summary: "Verification has not been run. Execute after live writes complete.",
    commandHint: "pnpm mvp:live-verification",
  };
}
