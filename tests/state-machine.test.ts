import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  assertTransition,
  getNextStates,
  TransitionError,
} from "../src/orchestrator/state-machine.js";
import type { ActorType } from "../src/orchestrator/state-machine.js";
import type { CandidateStatus } from "../src/types/state.js";

describe("state machine — legal transitions", () => {
  const agentTransitions: Array<[CandidateStatus, CandidateStatus]> = [
    ["new", "parsed"],
    ["parsed", "screened"],
    ["screened", "interview_kit_ready"],
    ["interview_kit_ready", "decision_pending"],
  ];

  for (const [from, to] of agentTransitions) {
    it(`agent can transition ${from} -> ${to}`, () => {
      assert.equal(canTransition(from, to, "agent"), true);
    });

    it(`assertTransition does not throw for ${from} -> ${to} by agent`, () => {
      assert.doesNotThrow(() => assertTransition(from, to, "agent"));
    });
  }
});

describe("state machine — human_confirm on offer/rejected", () => {
  it("human_confirm can transition decision_pending -> offer", () => {
    assert.equal(canTransition("decision_pending", "offer", "human_confirm"), true);
    assert.doesNotThrow(() =>
      assertTransition("decision_pending", "offer", "human_confirm"),
    );
  });

  it("human_confirm can transition decision_pending -> rejected", () => {
    assert.equal(canTransition("decision_pending", "rejected", "human_confirm"), true);
    assert.doesNotThrow(() =>
      assertTransition("decision_pending", "rejected", "human_confirm"),
    );
  });
});

describe("state machine — agent cannot offer/reject", () => {
  it("agent cannot transition decision_pending -> offer", () => {
    assert.equal(canTransition("decision_pending", "offer", "agent"), false);
  });

  it("agent cannot transition decision_pending -> rejected", () => {
    assert.equal(canTransition("decision_pending", "rejected", "agent"), false);
  });

  it("assertTransition throws for agent decision_pending -> offer", () => {
    assert.throws(
      () => assertTransition("decision_pending", "offer", "agent"),
      (err: unknown) => {
        assert.ok(err instanceof TransitionError);
        assert.equal(err.from, "decision_pending");
        assert.equal(err.to, "offer");
        assert.equal(err.actor, "agent");
        return true;
      },
    );
  });

  it("assertTransition throws for agent decision_pending -> rejected", () => {
    assert.throws(
      () => assertTransition("decision_pending", "rejected", "agent"),
      (err: unknown) => {
        assert.ok(err instanceof TransitionError);
        assert.equal(err.from, "decision_pending");
        assert.equal(err.to, "rejected");
        assert.equal(err.actor, "agent");
        return true;
      },
    );
  });
});

describe("state machine — illegal jumps throw", () => {
  const illegalJumps: Array<[CandidateStatus, CandidateStatus, ActorType]> = [
    ["new", "screened", "agent"],
    ["new", "decision_pending", "agent"],
    ["parsed", "interview_kit_ready", "agent"],
    ["parsed", "offer", "agent"],
    ["screened", "decision_pending", "agent"],
    ["offer", "new", "agent"],
    ["rejected", "new", "agent"],
    ["offer", "rejected", "human_confirm"],
    ["rejected", "offer", "human_confirm"],
    ["new", "offer", "human_confirm"],
    ["new", "rejected", "human_confirm"],
  ];

  for (const [from, to, actor] of illegalJumps) {
    it(`${actor} cannot transition ${from} -> ${to}`, () => {
      assert.equal(canTransition(from, to, actor), false);
    });

    it(`assertTransition throws for ${from} -> ${to} by ${actor}`, () => {
      assert.throws(
        () => assertTransition(from, to, actor),
        TransitionError,
      );
    });
  }
});

describe("state machine — terminal states have no outgoing transitions", () => {
  it("offer has no next states", () => {
    assert.deepEqual(getNextStates("offer"), []);
  });

  it("rejected has no next states", () => {
    assert.deepEqual(getNextStates("rejected"), []);
  });
});

describe("state machine — getNextStates", () => {
  it("new -> [parsed]", () => {
    assert.deepEqual(getNextStates("new"), ["parsed"]);
  });

  it("decision_pending -> [offer, rejected]", () => {
    const next = getNextStates("decision_pending");
    assert.deepEqual(next.sort(), ["offer", "rejected"]);
  });
});
