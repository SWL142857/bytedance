import type { BaseCommandSpec } from "../base/commands.js";
import type { ResolvedRecord } from "../base/record-resolution.js";
import { isLarkRecordId } from "../base/record-values.js";

export interface LiveReadinessCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  summary: string;
}

export interface LiveReadinessReport {
  mode: "readonly";
  ready: boolean;
  checkedAt: string;
  checks: LiveReadinessCheck[];
  resolutionMode: "sample" | "readonly";
  resolvedRecordCount: number;
  requiredRecordCount: number;
  plannedWriteCount: number;
  safeToExecuteLiveWrites: boolean;
  nextStep: string;
}

export interface LiveReadinessReportInput {
  resolutionMode: "sample" | "readonly";
  configErrors: Array<{ field: string; message: string }>;
  resolutionBlocked: boolean;
  resolvedRecords: ResolvedRecord[];
  requiredRecordCount: number;
  planCommands: BaseCommandSpec[] | null;
  planError: string | null;
  invalidWriteCommands: string[];
}

const EXPECTED_LIVE_MVP_WRITE_COMMAND_COUNT = 20;

export function buildLiveReadinessReport(
  input: LiveReadinessReportInput,
): LiveReadinessReport {
  const checks: LiveReadinessCheck[] = [];

  // Check 1: Config
  checks.push(buildConfigCheck(input.resolutionMode, input.configErrors));

  // Check 2: Resolution
  checks.push(buildResolutionCheck(input.resolutionBlocked));

  // Check 3: Required Records
  checks.push(
    buildRecordsCheck(input.resolvedRecords, input.requiredRecordCount),
  );

  // Check 4: Write Plan
  const planCommandCount = input.planCommands?.length ?? 0;
  checks.push(buildPlanCheck(planCommandCount, input.planError));

  // Check 5: Write Commands
  checks.push(
    buildWriteCommandsCheck(planCommandCount, input.invalidWriteCommands),
  );

  const ready = checks.every((c) => c.status !== "fail");
  const safeToExecuteLiveWrites =
    ready && input.resolutionMode === "readonly";
  const nextStep = buildNextStep(
    ready,
    safeToExecuteLiveWrites,
    input.resolutionMode,
    checks,
  );

  return {
    mode: "readonly",
    ready,
    checkedAt: new Date().toISOString(),
    checks,
    resolutionMode: input.resolutionMode,
    resolvedRecordCount: input.resolvedRecords.length,
    requiredRecordCount: input.requiredRecordCount,
    plannedWriteCount: planCommandCount,
    safeToExecuteLiveWrites,
    nextStep,
  };
}

function buildConfigCheck(
  resolutionMode: "sample" | "readonly",
  configErrors: Array<{ field: string; message: string }>,
): LiveReadinessCheck {
  if (resolutionMode === "sample") {
    if (configErrors.length > 0) {
      return {
        name: "Config",
        status: "warn",
        summary: `Sample mode does not require live config, but ${configErrors.length} field(s) missing for live execution.`,
      };
    }
    return {
      name: "Config",
      status: "pass",
      summary: "Config is complete for live execution.",
    };
  }

  if (configErrors.length > 0) {
    return {
      name: "Config",
      status: "fail",
      summary: `Config missing ${configErrors.length} required field(s) for live readiness.`,
    };
  }
  return {
    name: "Config",
    status: "pass",
    summary: "Config is complete for live readiness.",
  };
}

function buildResolutionCheck(resolutionBlocked: boolean): LiveReadinessCheck {
  if (resolutionBlocked) {
    return {
      name: "Resolution",
      status: "fail",
      summary: "Read-only resolution is blocked. Fix config or Base access.",
    };
  }
  return {
    name: "Resolution",
    status: "pass",
    summary: "Resolution not blocked.",
  };
}

function buildRecordsCheck(
  resolvedRecords: ResolvedRecord[],
  requiredRecordCount: number,
): LiveReadinessCheck {
  const count = resolvedRecords.length;
  const allValidIds = resolvedRecords.every((r) => isLarkRecordId(r.recordId));

  if (count < requiredRecordCount) {
    return {
      name: "Records",
      status: "fail",
      summary: `Resolved ${count} of ${requiredRecordCount} required records.`,
    };
  }
  if (!allValidIds) {
    return {
      name: "Records",
      status: "fail",
      summary: `${count} records resolved, but some have invalid record IDs (not rec_xxx format).`,
    };
  }
  return {
    name: "Records",
    status: "pass",
    summary: `All ${count} required records resolved with valid IDs.`,
  };
}

function buildPlanCheck(
  planCommandCount: number,
  planError: string | null,
): LiveReadinessCheck {
  if (planError) {
    return {
      name: "Write Plan",
      status: "fail",
      summary: "Plan generation failed. Check pipeline and resolution inputs.",
    };
  }
  if (planCommandCount === 0) {
    return {
      name: "Write Plan",
      status: "fail",
      summary: "Write plan generated 0 commands.",
    };
  }
  if (planCommandCount !== EXPECTED_LIVE_MVP_WRITE_COMMAND_COUNT) {
    return {
      name: "Write Plan",
      status: "fail",
      summary: `Write plan generated ${planCommandCount} commands; expected ${EXPECTED_LIVE_MVP_WRITE_COMMAND_COUNT} for live MVP.`,
    };
  }
  return {
    name: "Write Plan",
    status: "pass",
    summary: `Write plan generated ${planCommandCount} commands.`,
  };
}

function buildWriteCommandsCheck(
  planCommandCount: number,
  invalidWriteCommands: string[],
): LiveReadinessCheck {
  if (planCommandCount === 0) {
    return {
      name: "Write Commands",
      status: "fail",
      summary: "No commands to validate.",
    };
  }
  if (invalidWriteCommands.length > 0) {
    return {
      name: "Write Commands",
      status: "fail",
      summary: `${invalidWriteCommands.length} command(s) failed validation. Review command specs.`,
    };
  }
  return {
    name: "Write Commands",
    status: "pass",
    summary: `All ${planCommandCount} write commands are allowed guarded upsert/status update types.`,
  };
}

function buildNextStep(
  ready: boolean,
  safeToExecute: boolean,
  mode: "sample" | "readonly",
  checks: LiveReadinessCheck[],
): string {
  if (!ready) {
    const failures = checks.filter((c) => c.status === "fail");
    const failedNames = failures.map((c) => c.name).join(", ");
    return `Not ready. Fix: ${failedNames}. Then re-run readiness check.`;
  }

  if (mode === "sample") {
    return "Ready in sample mode. For live execution, re-run with --use-readonly-resolution after configuring Lark credentials.";
  }

  if (safeToExecute) {
    return "Ready for live writes. Review the checks above, then use the guarded live write runner (pnpm mvp:live-write:dry-run) for final confirmation.";
  }

  return "Readiness confirmed but safe execution flag is not set. Review and retry.";
}
