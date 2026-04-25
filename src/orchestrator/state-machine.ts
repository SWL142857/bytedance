import type { CandidateStatus } from "../types/state.ts";

export type ActorType = "agent" | "human_confirm";

interface TransitionRule {
  from: CandidateStatus;
  to: CandidateStatus;
  allowedActors: ActorType[];
}

const TRANSITIONS: TransitionRule[] = [
  { from: "new", to: "parsed", allowedActors: ["agent", "human_confirm"] },
  { from: "parsed", to: "screened", allowedActors: ["agent", "human_confirm"] },
  { from: "screened", to: "interview_kit_ready", allowedActors: ["agent", "human_confirm"] },
  { from: "interview_kit_ready", to: "decision_pending", allowedActors: ["agent", "human_confirm"] },
  { from: "decision_pending", to: "offer", allowedActors: ["human_confirm"] },
  { from: "decision_pending", to: "rejected", allowedActors: ["human_confirm"] },
];

const TRANSITION_MAP = new Map<string, TransitionRule>(
  TRANSITIONS.map((t) => [`${t.from}->${t.to}`, t]),
);

export function canTransition(
  from: CandidateStatus,
  to: CandidateStatus,
  actor: ActorType,
): boolean {
  const rule = TRANSITION_MAP.get(`${from}->${to}`);
  if (!rule) return false;
  return rule.allowedActors.includes(actor);
}

export class TransitionError extends Error {
  constructor(
    public readonly from: CandidateStatus,
    public readonly to: CandidateStatus,
    public readonly actor: ActorType,
    reason: string,
  ) {
    super(`Invalid transition ${from} -> ${to} by ${actor}: ${reason}`);
    this.name = "TransitionError";
  }
}

export function assertTransition(
  from: CandidateStatus,
  to: CandidateStatus,
  actor: ActorType,
): void {
  const key = `${from}->${to}`;
  const rule = TRANSITION_MAP.get(key);

  if (!rule) {
    throw new TransitionError(
      from,
      to,
      actor,
      `"${from} -> ${to}" is not a defined transition`,
    );
  }

  if (!rule.allowedActors.includes(actor)) {
    throw new TransitionError(
      from,
      to,
      actor,
      `"${to}" requires human confirmation, agent cannot perform this transition`,
    );
  }
}

export function getNextStates(from: CandidateStatus): CandidateStatus[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}
