import {
  buildRecordResolutionPlan,
  type RecordIdentity,
  type ResolvedRecord,
  RecordResolutionError,
} from "./record-resolution.js";
import { assertLarkRecordId } from "./record-values.js";

const MVP_JOB_IDENTITY: RecordIdentity = {
  tableName: "jobs",
  businessField: "job_id",
  businessId: "job_demo_ai_pm_001",
};

const MVP_CANDIDATE_IDENTITY: RecordIdentity = {
  tableName: "candidates",
  businessField: "candidate_id",
  businessId: "cand_demo_001",
};

export function buildMvpDemoResolutionPlan() {
  return buildRecordResolutionPlan([MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY]);
}

export interface MvpRecordContext {
  jobRecordId: string;
  candidateRecordId: string;
}

export function buildMvpRecordContext(
  resolvedRecords: ResolvedRecord[],
): MvpRecordContext {
  const job = resolvedRecords.find(
    (r) => r.tableName === "jobs" && r.businessField === "job_id" && r.businessId === MVP_JOB_IDENTITY.businessId,
  );
  const candidate = resolvedRecords.find(
    (r) => r.tableName === "candidates" && r.businessField === "candidate_id" && r.businessId === MVP_CANDIDATE_IDENTITY.businessId,
  );

  if (!job) {
    throw new RecordResolutionError("Job record not resolved in MVP context");
  }
  if (!candidate) {
    throw new RecordResolutionError("Candidate record not resolved in MVP context");
  }

  try {
    assertLarkRecordId("jobRecordId", job.recordId);
    assertLarkRecordId("candidateRecordId", candidate.recordId);
  } catch (err) {
    throw new RecordResolutionError(err instanceof Error ? err.message : "MVP context contains invalid record ID");
  }

  return {
    jobRecordId: job.recordId,
    candidateRecordId: candidate.recordId,
  };
}

export { MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY };
