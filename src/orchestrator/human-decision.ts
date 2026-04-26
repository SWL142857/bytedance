import type { BaseCommandSpec } from "../base/commands.js";
import { upsertRecord, updateCandidateStatus } from "../base/runtime.js";
import { assertLarkRecordId } from "../base/record-values.js";

export interface HumanDecisionInput {
  candidateRecordId: string;
  candidateId: string;
  decision: "offer" | "rejected";
  decidedBy: string;
  decisionNote: string;
  fromStatus: "decision_pending";
}

export interface HumanDecisionPlan {
  commands: BaseCommandSpec[];
  finalStatus: "offer" | "rejected";
}

const MAX_NOTE_LENGTH = 500;

export class HumanDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanDecisionError";
  }
}

export function buildHumanDecisionPlan(input: HumanDecisionInput): HumanDecisionPlan {
  try {
    assertLarkRecordId("candidateRecordId", input.candidateRecordId);
  } catch (err) {
    throw new HumanDecisionError(err instanceof Error ? err.message : "candidateRecordId must be a Lark record ID");
  }

  if (!input.decidedBy || input.decidedBy.trim().length === 0) {
    throw new HumanDecisionError("decidedBy must not be empty");
  }

  if (!input.decisionNote || input.decisionNote.trim().length === 0) {
    throw new HumanDecisionError("decisionNote must not be empty");
  }

  if (input.decisionNote.length > MAX_NOTE_LENGTH) {
    throw new HumanDecisionError(
      `decisionNote exceeds maximum length of ${MAX_NOTE_LENGTH} characters (got ${input.decisionNote.length})`,
    );
  }

  if (input.fromStatus !== "decision_pending") {
    throw new HumanDecisionError(
      `fromStatus must be "decision_pending", got "${input.fromStatus}"`,
    );
  }

  if (input.decision !== "offer" && input.decision !== "rejected") {
    throw new HumanDecisionError(
      `decision must be "offer" or "rejected", got "${input.decision}"`,
    );
  }

  const commands: BaseCommandSpec[] = [];

  // 1. Update candidate decision fields
  commands.push(
    upsertRecord("candidates", {
      human_decision: input.decision,
      human_decision_by: input.decidedBy,
      human_decision_note: input.decisionNote,
    }, { recordId: input.candidateRecordId }),
  );

  // 2. Status transition — human_confirm only
  commands.push(
    updateCandidateStatus({
      candidateRecordId: input.candidateRecordId,
      fromStatus: input.fromStatus,
      toStatus: input.decision,
      actor: "human_confirm",
    }),
  );

  return { commands, finalStatus: input.decision };
}
