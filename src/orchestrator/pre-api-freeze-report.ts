export type PreApiFreezeCheckStatus = "locked" | "needs_review" | "blocked";

export interface PreApiFreezeCheck {
  name: string;
  status: PreApiFreezeCheckStatus;
  summary: string;
}

export interface PreApiFreezeReport {
  title: string;
  status: "frozen" | "needs_review" | "blocked";
  apiIntegrationAllowed: boolean;
  externalModelCallAllowedByReport: boolean;
  realBaseWriteAllowedByReport: boolean;
  checks: PreApiFreezeCheck[];
  allowedNextChanges: string[];
  blockedChanges: string[];
  finalNote: string;
}

export interface PreApiFreezeInput {
  schemasLocked: boolean;
  stateMachineLocked: boolean;
  baseWriteGuardsLocked: boolean;
  redactionPolicyLocked: boolean;
  deterministicDemoPassing: boolean;
  releaseGatePassing: boolean;
  llmAdapterBoundaryDefined: boolean;
}

const ALLOWED_NEXT_CHANGES = [
  "add disabled-by-default provider adapter",
  "add provider config validation",
  "add provider error mapping",
  "add schema retry wiring behind existing output contracts",
];

const BLOCKED_CHANGES = [
  "changing candidate status flow",
  "relaxing guarded live write conditions",
  "writing raw prompts, resumes, or credentials to output",
  "bypassing schema validation",
  "enabling external model calls by default",
];

export function buildPreApiFreezeReport(
  input: PreApiFreezeInput,
): PreApiFreezeReport {
  const coreLocked =
    input.schemasLocked &&
    input.stateMachineLocked &&
    input.baseWriteGuardsLocked &&
    input.redactionPolicyLocked;

  const operationalPassing =
    input.deterministicDemoPassing &&
    input.releaseGatePassing &&
    input.llmAdapterBoundaryDefined;

  const apiIntegrationAllowed = coreLocked && operationalPassing;

  const checks: PreApiFreezeCheck[] = [
    {
      name: "Agent Output Schemas",
      status: input.schemasLocked ? "locked" : "blocked",
      summary: input.schemasLocked
        ? "Agent output schemas are locked. No schema changes allowed without re-freeze."
        : "Agent output schemas are not locked. Lock schemas before API integration.",
    },
    {
      name: "State Machine",
      status: input.stateMachineLocked ? "locked" : "blocked",
      summary: input.stateMachineLocked
        ? "Candidate status flow is locked. No state transitions can be added or modified."
        : "State machine is not locked. Lock status flow before API integration.",
    },
    {
      name: "Base Write Guards",
      status: input.baseWriteGuardsLocked ? "locked" : "blocked",
      summary: input.baseWriteGuardsLocked
        ? "Base write guards are locked. Guarded runner conditions cannot be relaxed."
        : "Base write guards are not locked. Lock guard conditions before API integration.",
    },
    {
      name: "Redaction Policy",
      status: input.redactionPolicyLocked ? "locked" : "blocked",
      summary: input.redactionPolicyLocked
        ? "Redaction policy is locked. No raw output leaking allowed."
        : "Redaction policy is not locked. Lock redaction rules before API integration.",
    },
    {
      name: "Deterministic Demo",
      status: input.deterministicDemoPassing ? "locked" : "needs_review",
      summary: input.deterministicDemoPassing
        ? "Deterministic demo passes. Local verification baseline is established."
        : "Deterministic demo not passing. Verify local demo before API integration.",
    },
    {
      name: "Release Gate",
      status: input.releaseGatePassing ? "locked" : "needs_review",
      summary: input.releaseGatePassing
        ? "Release gate passes. All safety checks are confirmed."
        : "Release gate not passing. Clear all release gate blocks first.",
    },
    {
      name: "LLM Adapter Boundary",
      status: input.llmAdapterBoundaryDefined ? "locked" : "needs_review",
      summary: input.llmAdapterBoundaryDefined
        ? "LLM adapter boundary is defined. API integration scope is limited to adapter layer."
        : "LLM adapter boundary not defined. Define adapter interface before API integration.",
    },
  ];

  const status = deriveStatus(coreLocked, operationalPassing);

  return {
    title: "Pre-API Freeze Report",
    status,
    apiIntegrationAllowed,
    externalModelCallAllowedByReport: false,
    realBaseWriteAllowedByReport: false,
    checks,
    allowedNextChanges: ALLOWED_NEXT_CHANGES,
    blockedChanges: BLOCKED_CHANGES,
    finalNote:
      "Architecture is frozen before API integration. API work is restricted to provider adapter, config validation, error mapping, and schema retry wiring. Default behavior must remain: no external model calls, no real Base writes, no schema bypass. Any change to state machine, write guards, redaction, or output schemas requires re-freeze review.",
  };
}

function deriveStatus(
  coreLocked: boolean,
  operationalPassing: boolean,
): "frozen" | "needs_review" | "blocked" {
  if (!coreLocked) {
    return "blocked";
  }

  if (!operationalPassing) {
    return "needs_review";
  }

  return "frozen";
}
