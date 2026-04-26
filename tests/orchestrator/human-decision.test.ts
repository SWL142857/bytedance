import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHumanDecisionPlan, HumanDecisionError, type HumanDecisionInput } from "../../src/orchestrator/human-decision.js";

const VALID_OFFER_INPUT: HumanDecisionInput = {
  candidateRecordId: "recCand001",
  candidateId: "cand_001",
  decision: "offer",
  decidedBy: "hiring_manager",
  decisionNote: "Strong candidate, approved for offer.",
  fromStatus: "decision_pending",
};

describe("human decision — successful offer", () => {
  it("generates 2 commands", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    assert.equal(result.commands.length, 2);
  });

  it("returns finalStatus as offer", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    assert.equal(result.finalStatus, "offer");
  });

  it("first command is Candidates upsert", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    assert.ok(result.commands[0]!.description.includes("\"Candidates\""), "First command should update Candidates");
    assert.ok(result.commands[0]!.args.includes("--record-id"), "First command should use --record-id");
  });

  it("second command is decision_pending -> offer status update", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    assert.ok(result.commands[1]!.description.includes("decision_pending -> offer"));
  });

  it("status update uses human_confirm actor", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    assert.ok(result.commands[1]!.description.includes("human_confirm"));
    assert.ok(!result.commands[1]!.description.includes("agent"), "Should not use agent actor");
  });

  it("Candidates upsert contains decision fields", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    const jsonIdx = result.commands[0]!.args.indexOf("--json");
    const jsonArg = result.commands[0]!.args[jsonIdx + 1];
    assert.ok(jsonArg);
    const parsed = JSON.parse(jsonArg!);
    assert.equal(parsed.human_decision, "offer");
    assert.equal(parsed.human_decision_by, "hiring_manager");
    assert.equal(parsed.human_decision_note, "Strong candidate, approved for offer.");
  });
});

describe("human decision — successful rejected", () => {
  it("generates 2 commands", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decision: "rejected",
    };
    const result = buildHumanDecisionPlan(input);
    assert.equal(result.commands.length, 2);
  });

  it("returns finalStatus as rejected", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decision: "rejected",
    };
    const result = buildHumanDecisionPlan(input);
    assert.equal(result.finalStatus, "rejected");
  });

  it("second command is decision_pending -> rejected status update", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decision: "rejected",
    };
    const result = buildHumanDecisionPlan(input);
    assert.ok(result.commands[1]!.description.includes("decision_pending -> rejected"));
  });
});

describe("human decision — validation errors", () => {
  it("throws on invalid candidateRecordId", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      candidateRecordId: "cand_demo_001",
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => err instanceof HumanDecisionError && err.message.includes("rec_xxx"),
    );
  });

  it("throws on empty decidedBy", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decidedBy: "",
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => err instanceof HumanDecisionError && err.message.includes("decidedBy"),
    );
  });

  it("throws on whitespace-only decidedBy", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decidedBy: "   ",
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => err instanceof HumanDecisionError,
    );
  });

  it("throws on empty decisionNote", () => {
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decisionNote: "",
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => err instanceof HumanDecisionError && err.message.includes("decisionNote"),
    );
  });

  it("throws on decisionNote exceeding 500 characters", () => {
    const longNote = "x".repeat(501);
    const input: HumanDecisionInput = {
      ...VALID_OFFER_INPUT,
      decisionNote: longNote,
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => {
        assert.ok(err instanceof HumanDecisionError);
        assert.ok(err.message.includes("500"));
        assert.ok(!err.message.includes(longNote), "Error message must not contain full note");
        return true;
      },
    );
  });

  it("throws on non-decision_pending fromStatus", () => {
    const input = {
      ...VALID_OFFER_INPUT,
      fromStatus: "screened" as "decision_pending",
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => err instanceof HumanDecisionError && err.message.includes("decision_pending"),
    );
  });

  it("throws on invalid decision", () => {
    const input = {
      ...VALID_OFFER_INPUT,
      decision: "pending" as "offer",
    };
    assert.throws(
      () => buildHumanDecisionPlan(input),
      (err: unknown) => err instanceof HumanDecisionError && err.message.includes("offer"),
    );
  });
});

describe("human decision — no Agent Runs generated", () => {
  it("does not generate Agent Run commands", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    const agentRunCmd = result.commands.find((c) => c.description.includes("\"Agent Runs\""));
    assert.ok(!agentRunCmd, "Human decision should not generate Agent Run commands");
  });
});

describe("human decision — command structure", () => {
  it("commands use lark-cli, not direct execution", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    for (const cmd of result.commands) {
      assert.equal(cmd.command, "lark-cli");
      assert.ok(Array.isArray(cmd.args));
    }
  });

  it("command args do not contain raw token", () => {
    const result = buildHumanDecisionPlan(VALID_OFFER_INPUT);
    const allArgs = result.commands.map((c) => c.args.join(" ")).join(" ");
    assert.ok(!allArgs.includes("Bearer"), "Args should not contain tokens");
    assert.ok(!allArgs.includes("token_"), "Args should not contain tokens");
  });
});
