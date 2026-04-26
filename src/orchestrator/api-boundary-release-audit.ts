export type ApiBoundaryAuditCheckStatus = "pass" | "warn" | "block";

export interface ApiBoundaryAuditCheck {
  name: string;
  status: ApiBoundaryAuditCheckStatus;
  summary: string;
}

export interface ApiBoundaryAuditReport {
  title: string;
  status: "ready" | "needs_review" | "blocked";
  defaultExternalModelCallsPermittedByReport: boolean;
  realBaseWritesPermittedByReport: boolean;
  providerSmokeGuarded: boolean;
  providerAgentDemoGuarded: boolean;
  baseWriteGuardIndependent: boolean;
  deterministicDemoSafe: boolean;
  outputRedactionSafe: boolean;
  forbiddenTraceScanPassed: boolean;
  secretScanPassed: boolean;
  releaseGateConsistent: boolean;
  checks: ApiBoundaryAuditCheck[];
  recommendedCommands: string[];
  finalNote: string;
}

export interface ApiBoundaryAuditInput {
  typecheckPassed: boolean;
  testsPassed: boolean;
  buildPassed: boolean;
  deterministicDemoPassed: boolean;
  providerSmokeGuarded: boolean;
  providerAgentDemoGuarded: boolean;
  baseWriteGuardIndependent: boolean;
  outputRedactionSafe: boolean;
  forbiddenTraceScanPassed: boolean;
  secretScanPassed: boolean;
  releaseGateConsistent: boolean;
}

const RECOMMENDED_COMMANDS = [
  "pnpm typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm mvp:demo",
  "pnpm mvp:provider-smoke",
  "pnpm mvp:provider-agent-demo",
  "pnpm mvp:provider-readiness",
  "pnpm mvp:pre-api-freeze",
  "pnpm mvp:release-gate",
  "pnpm mvp:api-boundary-audit",
];

export function buildApiBoundaryReleaseAuditReport(
  input: ApiBoundaryAuditInput,
): ApiBoundaryAuditReport {
  const corePassed =
    input.typecheckPassed &&
    input.testsPassed &&
    input.buildPassed &&
    input.deterministicDemoPassed;

  const guardIntegrity =
    input.providerSmokeGuarded &&
    input.providerAgentDemoGuarded &&
    input.baseWriteGuardIndependent;

  const safetyPassed =
    input.outputRedactionSafe &&
    input.forbiddenTraceScanPassed &&
    input.secretScanPassed;

  const consistencyPassed = input.releaseGateConsistent;

  const checks: ApiBoundaryAuditCheck[] = [
    {
      name: "Typecheck",
      status: input.typecheckPassed ? "pass" : "block",
      summary: input.typecheckPassed
        ? "Typecheck passed."
        : "Typecheck failed.",
    },
    {
      name: "Tests",
      status: input.testsPassed ? "pass" : "block",
      summary: input.testsPassed
        ? "All tests passed."
        : "Tests failed.",
    },
    {
      name: "Build",
      status: input.buildPassed ? "pass" : "block",
      summary: input.buildPassed
        ? "Build passed."
        : "Build failed.",
    },
    {
      name: "Deterministic Demo",
      status: input.deterministicDemoPassed ? "pass" : "block",
      summary: input.deterministicDemoPassed
        ? "Deterministic MVP demo produces expected output."
        : "Deterministic MVP demo failed.",
    },
    {
      name: "Provider Smoke Guard",
      status: input.providerSmokeGuarded ? "pass" : "block",
      summary: input.providerSmokeGuarded
        ? "Provider smoke runner is guarded (blocks without full env + confirm)."
        : "Provider smoke runner is not properly guarded.",
    },
    {
      name: "Provider Agent Demo Guard",
      status: input.providerAgentDemoGuarded ? "pass" : "block",
      summary: input.providerAgentDemoGuarded
        ? "Provider agent demo runner is guarded (blocks without --use-provider + execute + confirm)."
        : "Provider agent demo runner is not properly guarded.",
    },
    {
      name: "Base Write Guard Independence",
      status: input.baseWriteGuardIndependent ? "pass" : "block",
      summary: input.baseWriteGuardIndependent
        ? "Base write guard is independent and not relaxed."
        : "Base write guard has been modified or relaxed.",
    },
    {
      name: "Output Redaction",
      status: input.outputRedactionSafe ? "pass" : "block",
      summary: input.outputRedactionSafe
        ? "All demo outputs pass safety redaction checks."
        : "Demo outputs contain sensitive data.",
    },
    {
      name: "Forbidden Trace Scan",
      status: input.forbiddenTraceScanPassed ? "pass" : "block",
      summary: input.forbiddenTraceScanPassed
        ? "No forbidden traces found."
        : "Forbidden traces detected.",
    },
    {
      name: "Secret Scan",
      status: input.secretScanPassed ? "pass" : "block",
      summary: input.secretScanPassed
        ? "No configured provider values found in tracked artifacts."
        : "Configured provider values detected in tracked artifacts.",
    },
    {
      name: "Release Gate Consistency",
      status: input.releaseGateConsistent ? "pass" : "warn",
      summary: input.releaseGateConsistent
        ? "Release gate report is consistent with API boundary audit."
        : "Release gate report has inconsistencies with API boundary state.",
    },
  ];

  const status = deriveStatus(corePassed, guardIntegrity, safetyPassed, consistencyPassed);

  return {
    title: "API Boundary Release Audit",
    status,
    defaultExternalModelCallsPermittedByReport: false,
    realBaseWritesPermittedByReport: false,
    providerSmokeGuarded: input.providerSmokeGuarded,
    providerAgentDemoGuarded: input.providerAgentDemoGuarded,
    baseWriteGuardIndependent: input.baseWriteGuardIndependent,
    deterministicDemoSafe: input.deterministicDemoPassed,
    outputRedactionSafe: input.outputRedactionSafe,
    forbiddenTraceScanPassed: input.forbiddenTraceScanPassed,
    secretScanPassed: input.secretScanPassed,
    releaseGateConsistent: input.releaseGateConsistent,
    checks,
    recommendedCommands: RECOMMENDED_COMMANDS,
    finalNote:
      "API boundary is audited. Default behavior: no external model calls, no real Base writes. " +
      "Provider integration is guarded and opt-in only. Do not relax guards or bypass schema validation.",
  };
}

function deriveStatus(
  corePassed: boolean,
  guardIntegrity: boolean,
  safetyPassed: boolean,
  consistencyPassed: boolean,
): "ready" | "needs_review" | "blocked" {
  if (!corePassed || !guardIntegrity) return "blocked";
  if (!safetyPassed) return "blocked";
  if (!consistencyPassed) return "needs_review";
  return "ready";
}
