import type { AgentInputBundle, BundleLoadResult } from "./bundle-loader.js";
import { agentInputBundleToPipelineInput } from "./bundle-loader.js";

// ── Types ──

export interface RagDatasetVerificationReport {
  status: "passed" | "needs_review" | "failed";
  totalCandidates: number;
  completed: number;
  failed: number;
  evidenceCoverage: {
    withEvidence: number;
    withoutEvidence: number;
  };
  redactionBlockedCount: number;
  schemaErrors: { field: string; count: number }[];
  providerBlockedCount: number;
  evidenceUsage: { agent: string; evidenceCount: number }[];
  guardrailSummary: {
    evidenceMayEnterPrompt: false;
    writesAllowed: false;
    providerAllowed: boolean;
  };
  safeSummary: string;
}

// ── Constants ──

const USED_FOR_TO_AGENT: Record<string, string> = {
  screening: "screening",
  interview_kit: "interview_kit",
  hr_review: "hr_coordinator",
  verification: "verification",
  display: "verification",
};

// ── Verification ──

export function verifyBundles(result: BundleLoadResult, allowProvider?: boolean): RagDatasetVerificationReport {
  const bundles = result.bundles;
  const totalCandidates = result.totalCount;

  if (totalCandidates === 0) {
    return {
      status: "failed",
      totalCandidates: 0,
      completed: 0,
      failed: 0,
      evidenceCoverage: { withEvidence: 0, withoutEvidence: 0 },
      redactionBlockedCount: 0,
      schemaErrors: [],
      providerBlockedCount: 0,
      evidenceUsage: [],
      guardrailSummary: {
        evidenceMayEnterPrompt: false,
        writesAllowed: false,
        providerAllowed: allowProvider ?? false,
      },
      safeSummary: "没有有效的候选人数据。",
    };
  }

  // Count evidence coverage
  let withEvidence = 0;
  let withoutEvidence = 0;
  let redactionBlockedCount = 0;
  let providerBlockedCount = 0;
  const validBundles: AgentInputBundle[] = [];
  const schemaFieldCounts = new Map<string, number>();

  for (const bundle of bundles) {
    const usableEvidence = bundle.evidence.filter((ev) => ev.redactionStatus !== "blocked");
    if (usableEvidence.length > 0) {
      withEvidence++;
    } else {
      withoutEvidence++;
    }

    for (const ev of bundle.evidence) {
      if (ev.redactionStatus === "blocked") {
        redactionBlockedCount++;
      }
    }

    if (bundle.runMode === "provider" && bundle.guardFlags.allowProvider === false) {
      providerBlockedCount++;
    }

    // Check adapter succeeds
    try {
      agentInputBundleToPipelineInput(bundle);
      validBundles.push(bundle);
    } catch {
      // bundle failed adapter — counted in schema errors below
    }
  }

  // Schema errors
  for (const err of result.errors) {
    const field = extractErrorField(err);
    schemaFieldCounts.set(field, (schemaFieldCounts.get(field) || 0) + 1);
  }

  const schemaErrors = [...schemaFieldCounts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count);

  const completed = validBundles.length;
  const failed = totalCandidates - completed;

  // Evidence usage by agent
  const agentEvidenceCount = new Map<string, number>();
  for (const bundle of validBundles) {
    for (const ev of bundle.evidence) {
      if (ev.redactionStatus === "blocked") continue;
      const agent = USED_FOR_TO_AGENT[ev.usedFor] ?? "verification";
      agentEvidenceCount.set(agent, (agentEvidenceCount.get(agent) || 0) + 1);
    }
  }

  const evidenceUsage = [...agentEvidenceCount.entries()]
    .map(([agent, evidenceCount]) => ({ agent, evidenceCount }))
    .sort((a, b) => a.agent.localeCompare(b.agent));

  // Status determination
  let status: RagDatasetVerificationReport["status"];
  if (completed === 0) {
    status = "failed";
  } else if (
    withoutEvidence > 0 ||
    redactionBlockedCount > 0 ||
    schemaErrors.length > 0 ||
    providerBlockedCount > 0
  ) {
    status = "needs_review";
  } else {
    status = "passed";
  }

  // Safe summary
  const safeSummary = buildSafeSummary(status, totalCandidates, completed, failed, withEvidence, withoutEvidence,
    redactionBlockedCount, schemaErrors.length, providerBlockedCount);

  return {
    status,
    totalCandidates,
    completed,
    failed,
    evidenceCoverage: { withEvidence, withoutEvidence },
    redactionBlockedCount,
    schemaErrors,
    providerBlockedCount,
    evidenceUsage,
    guardrailSummary: {
      evidenceMayEnterPrompt: false,
      writesAllowed: false,
      providerAllowed: allowProvider ?? false,
    },
    safeSummary,
  };
}

// ── Helpers ──

const SAFE_SCHEMA_FIELDS = new Set([
  "candidate",
  "candidateRecordId",
  "candidateId",
  "resumeText",
  "job",
  "jobRecordId",
  "jobId",
  "requirements",
  "rubric",
  "evidence",
  "sourceRef",
  "kind",
  "usedFor",
  "snippet",
  "score",
]);

function extractErrorField(err: string): string {
  const match = err.match(/"([^"]+)"/);
  if (match && match[1]) {
    return SAFE_SCHEMA_FIELDS.has(match[1]) ? match[1] : "unknown";
  }
  return "unknown";
}

function buildSafeSummary(
  status: string,
  total: number,
  completed: number,
  failed: number,
  withEvidence: number,
  withoutEvidence: number,
  redactionBlocked: number,
  schemaErrorKinds: number,
  providerBlocked: number,
): string {
  if (status === "failed") {
    return `验证未通过：${total} 位候选人中无可验证的有效数据。`;
  }

  const parts: string[] = [];
  parts.push(`共 ${total} 位候选人，${completed} 位有效，${failed} 位无效。`);

  if (withEvidence > 0 || withoutEvidence > 0) {
    parts.push(`${withEvidence} 位有证据，${withoutEvidence} 位无证据。`);
  }

  const warnings: string[] = [];
  if (redactionBlocked > 0) warnings.push(`${redactionBlocked} 条证据因安全脱敏被阻止`);
  if (schemaErrorKinds > 0) warnings.push(`${schemaErrorKinds} 类 schema 错误`);
  if (providerBlocked > 0) warnings.push(`${providerBlocked} 位候选人 provider 被阻止`);

  if (warnings.length > 0) {
    parts.push("需复核：" + warnings.join("、") + "。");
  }

  if (status === "passed") {
    parts.push("全部证据覆盖正常，安全检查通过。");
  }

  return parts.join("");
}
