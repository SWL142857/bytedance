export type LiveVerificationStatus =
  | "not_run"
  | "passed"
  | "failed"
  | "needs_review";

export type LiveVerificationCheckStatus =
  | "pass"
  | "fail"
  | "warn"
  | "not_checked";

export interface LiveVerificationCheck {
  name: string;
  status: LiveVerificationCheckStatus;
  summary: string;
}

export interface LiveVerificationReport {
  mode: "sample" | "readonly";
  status: LiveVerificationStatus;
  checkedAt: string;
  expectedWriteCount: number;
  verifiedCheckCount: number;
  checks: LiveVerificationCheck[];
  manualReviewRequired: boolean;
  nextStep: string;
}

export interface LiveVerificationReportInput {
  mode: "sample" | "readonly";
  expectedWriteCount: number;
  agentRunsVerified: boolean | null;
  candidateStatusVerified: boolean | null;
  reportsVerified: boolean | null;
  resumeFactsVerified?: boolean | null;
  evaluationsVerified?: boolean | null;
  interviewKitsVerified?: boolean | null;
  verificationBlocked?: boolean;
}

interface TableCheck {
  name: string;
  verified: boolean | null | undefined;
}

export function buildLiveVerificationReport(
  input: LiveVerificationReportInput,
): LiveVerificationReport {
  const allChecks: TableCheck[] = [
    { name: "Agent Runs", verified: input.agentRunsVerified },
    { name: "Resume Facts", verified: input.resumeFactsVerified },
    { name: "Evaluations", verified: input.evaluationsVerified },
    { name: "Interview Kits", verified: input.interviewKitsVerified },
    { name: "Candidates", verified: input.candidateStatusVerified },
    { name: "Reports", verified: input.reportsVerified },
  ];

  if (input.mode === "sample") {
    return buildSampleReport(input, allChecks);
  }

  if (input.verificationBlocked) {
    return buildBlockedReport(input, allChecks);
  }

  return buildReadonlyReport(input, allChecks);
}

function buildSampleReport(
  input: LiveVerificationReportInput,
  allChecks: TableCheck[],
): LiveVerificationReport {
  const checks: LiveVerificationCheck[] = allChecks.map((c) => ({
    name: c.name,
    status: "not_checked" as const,
    summary: `Sample mode. ${c.name} verification not performed.`,
  }));

  return {
    mode: "sample",
    status: "needs_review",
    checkedAt: new Date().toISOString(),
    expectedWriteCount: input.expectedWriteCount,
    verifiedCheckCount: 0,
    checks,
    manualReviewRequired: true,
    nextStep:
      "Sample verification report. No live checks were performed. Run with readonly mode after live writes, or manually verify Base records.",
  };
}

function buildBlockedReport(
  input: LiveVerificationReportInput,
  allChecks: TableCheck[],
): LiveVerificationReport {
  const checks: LiveVerificationCheck[] = allChecks.map((c) => ({
    name: c.name,
    status: "fail" as const,
    summary: `Verification blocked. Could not check ${c.name}.`,
  }));

  return {
    mode: "readonly",
    status: "failed",
    checkedAt: new Date().toISOString(),
    expectedWriteCount: input.expectedWriteCount,
    verifiedCheckCount: 0,
    checks,
    manualReviewRequired: true,
    nextStep:
      "Verification blocked. Fix readonly config or Base access, then re-run verification.",
  };
}

function buildReadonlyReport(
  input: LiveVerificationReportInput,
  allChecks: TableCheck[],
): LiveVerificationReport {
  const checks: LiveVerificationCheck[] = allChecks.map((c) => {
    const verified = c.verified;
    if (verified === true) {
      return {
        name: c.name,
        status: "pass" as const,
        summary: `${c.name} verified.`,
      };
    }
    if (verified === false) {
      return {
        name: c.name,
        status: "fail" as const,
        summary: `${c.name} check failed. Records may be missing or incomplete.`,
      };
    }
    return {
      name: c.name,
      status: "warn" as const,
      summary: `${c.name} not checked. Requires manual review.`,
    };
  });

  const hasFail = checks.some((c) => c.status === "fail");
  const hasNull = allChecks.some((c) => c.verified === null || c.verified === undefined);
  const verifiedCount = checks.filter((c) => c.status === "pass").length;

  if (hasFail) {
    return {
      mode: "readonly",
      status: "failed",
      checkedAt: new Date().toISOString(),
      expectedWriteCount: input.expectedWriteCount,
      verifiedCheckCount: verifiedCount,
      checks,
      manualReviewRequired: true,
      nextStep:
        "Verification found missing or incomplete records. Check Base tables listed as failed above.",
    };
  }

  if (hasNull) {
    return {
      mode: "readonly",
      status: "needs_review",
      checkedAt: new Date().toISOString(),
      expectedWriteCount: input.expectedWriteCount,
      verifiedCheckCount: verifiedCount,
      checks,
      manualReviewRequired: true,
      nextStep:
        "Some checks could not be completed. Review unchecked tables manually or re-run with full verification.",
    };
  }

  return {
    mode: "readonly",
    status: "passed",
    checkedAt: new Date().toISOString(),
    expectedWriteCount: input.expectedWriteCount,
    verifiedCheckCount: verifiedCount,
    checks,
    manualReviewRequired: true,
    nextStep:
      "All verification checks passed. Spot-check Base records for data correctness before closing.",
  };
}
