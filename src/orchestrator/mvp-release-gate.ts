export type MvpReleaseGateCheckStatus = "pass" | "warn" | "block";

export interface MvpReleaseGateCheck {
  name: string;
  status: MvpReleaseGateCheckStatus;
  summary: string;
  commandHint: string;
}

export interface MvpReleaseGateReport {
  title: string;
  status: "ready_for_demo" | "needs_review" | "blocked";
  localDemoReady: boolean;
  liveSafetyReady: boolean;
  realWritePermittedByReport: boolean;
  externalModelCallPermittedByReport: boolean;
  checks: MvpReleaseGateCheck[];
  recommendedDemoCommands: string[];
  finalHandoffNote: string;
}

export interface MvpReleaseGateInput {
  typecheckPassed: boolean;
  testsPassed: boolean;
  localMvpDemoPassed: boolean;
  liveReadyDemoPassed: boolean;
  liveRunbookAvailable: boolean;
  guardedExecuteBlocksWithoutConfig: boolean;
  apiBoundaryAuditPassed: boolean;
  forbiddenTraceScanPassed: boolean;
}

const RECOMMENDED_DEMO_COMMANDS = [
  "pnpm typecheck",
  "pnpm test",
  "pnpm mvp:demo",
  "pnpm mvp:live-ready",
  "pnpm mvp:live-runbook",
  "pnpm mvp:live-write:dry-run",
  "pnpm mvp:api-boundary-audit",
];

export function buildMvpReleaseGateReport(
  input: MvpReleaseGateInput,
): MvpReleaseGateReport {
  const localDemoReady =
    input.typecheckPassed && input.testsPassed && input.localMvpDemoPassed;

  const liveSafetyReady =
    input.liveReadyDemoPassed &&
    input.liveRunbookAvailable &&
    input.guardedExecuteBlocksWithoutConfig &&
    input.apiBoundaryAuditPassed &&
    input.forbiddenTraceScanPassed;

  const checks: MvpReleaseGateCheck[] = [
    {
      name: "Typecheck",
      status: input.typecheckPassed ? "pass" : "block",
      summary: input.typecheckPassed
        ? "Typecheck passed."
        : "Typecheck failed. Fix type errors before proceeding.",
      commandHint: "pnpm typecheck",
    },
    {
      name: "Test Suite",
      status: input.testsPassed ? "pass" : "block",
      summary: input.testsPassed
        ? "All tests passed."
        : "Tests failed. Fix failing tests before proceeding.",
      commandHint: "pnpm test",
    },
    {
      name: "Local MVP Demo",
      status: input.localMvpDemoPassed ? "pass" : "block",
      summary: input.localMvpDemoPassed
        ? "Local MVP demo produces expected output."
        : "Local MVP demo failed. Verify pipeline + decision + analytics end-to-end.",
      commandHint: "pnpm mvp:demo",
    },
    {
      name: "Live Ready Demo",
      status: input.liveReadyDemoPassed ? "pass" : "warn",
      summary: input.liveReadyDemoPassed
        ? "Live readiness demo produces valid report."
        : "Live readiness demo not verified. Run and confirm output.",
      commandHint: "pnpm mvp:live-readiness",
    },
    {
      name: "Live Operator Runbook",
      status: input.liveRunbookAvailable ? "pass" : "warn",
      summary: input.liveRunbookAvailable
        ? "Live operator runbook available and produces valid output."
        : "Live operator runbook not verified. Run and confirm output.",
      commandHint: "pnpm mvp:live-runbook",
    },
    {
      name: "Guarded Execute Block",
      status: input.guardedExecuteBlocksWithoutConfig ? "pass" : "block",
      summary: input.guardedExecuteBlocksWithoutConfig
        ? "Guarded execute correctly blocks without valid config."
        : "Guarded execute does not block without config. This is a safety issue.",
      commandHint: "Verify guarded runner blocks without valid config",
    },
    {
      name: "Forbidden Trace Scan",
      status: input.forbiddenTraceScanPassed ? "pass" : "block",
      summary: input.forbiddenTraceScanPassed
        ? "No forbidden traces found in repository content."
        : "Forbidden traces detected. Clean repository before release.",
      commandHint: "Run forbidden trace scan (see project config for pattern)",
    },
    {
      name: "API Boundary Audit",
      status: input.apiBoundaryAuditPassed ? "pass" : "block",
      summary: input.apiBoundaryAuditPassed
        ? "API boundary audit passed."
        : "API boundary audit not passing. Run the audit and resolve boundary findings before release.",
      commandHint: "pnpm mvp:api-boundary-audit",
    },
  ];

  const status = deriveStatus(input, localDemoReady, liveSafetyReady);

  return {
    title: "MVP Release Gate",
    status,
    localDemoReady,
    liveSafetyReady,
    realWritePermittedByReport: false,
    externalModelCallPermittedByReport: false,
    checks,
    recommendedDemoCommands: RECOMMENDED_DEMO_COMMANDS,
    finalHandoffNote:
      "Real writes require explicit human authorization via the guarded runner. On failure, review the execution audit, recovery plan, and verification report before deciding on targeted compensation or retry. Do NOT blindly re-run the full pipeline.",
  };
}

function deriveStatus(
  input: MvpReleaseGateInput,
  localDemoReady: boolean,
  liveSafetyReady: boolean,
): "ready_for_demo" | "needs_review" | "blocked" {
  if (!localDemoReady) {
    return "blocked";
  }

  if (!input.guardedExecuteBlocksWithoutConfig) {
    return "blocked";
  }

  if (!liveSafetyReady) {
    return "needs_review";
  }

  return "ready_for_demo";
}
