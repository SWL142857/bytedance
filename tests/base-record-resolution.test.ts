import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecordResolutionPlan,
  resolveRecordFromListOutput,
  resolveRecordsFromOutputs,
  recordIdentityKey,
  RecordResolutionError,
  type RecordIdentity,
  type ResolvedRecord,
} from "../src/base/record-resolution.js";
import {
  buildMvpDemoResolutionPlan,
  buildMvpRecordContext,
  MVP_CANDIDATE_IDENTITY,
  MVP_JOB_IDENTITY,
} from "../src/base/mvp-resolution.js";

const JOB_IDENTITY: RecordIdentity = {
  tableName: "jobs",
  businessField: "job_id",
  businessId: "job_demo_ai_pm_001",
};

const CANDIDATE_IDENTITY: RecordIdentity = {
  tableName: "candidates",
  businessField: "candidate_id",
  businessId: "cand_demo_001",
};

function listOutput(records: Array<{ id: string; fields: Record<string, unknown> }>): string {
  return JSON.stringify({
    items: records.map((r) => ({ record_id: r.id, fields: r.fields })),
    total: records.length,
    has_more: false,
  });
}

const SAMPLE_JOB_STDOUT = listOutput([
  {
    id: "recJob001",
    fields: {
      job_id: "job_demo_ai_pm_001",
      title: "AI Product Manager",
      status: "open",
    },
  },
]);

const SAMPLE_CANDIDATE_STDOUT = listOutput([
  {
    id: "recCand001",
    fields: {
      candidate_id: "cand_demo_001",
      display_name: "Demo Candidate",
      status: "new",
    },
  },
]);

describe("buildRecordResolutionPlan — validation", () => {
  it("throws on empty identities", () => {
    assert.throws(
      () => buildRecordResolutionPlan([]),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("empty"),
    );
  });

  it("throws on unknown table name", () => {
    assert.throws(
      () => buildRecordResolutionPlan([{ tableName: "nonexistent", businessField: "id", businessId: "x" }]),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("nonexistent"),
    );
  });

  it("throws on unknown business field", () => {
    assert.throws(
      () => buildRecordResolutionPlan([{ tableName: "jobs", businessField: "nonexistent_field", businessId: "x" }]),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("nonexistent_field"),
    );
  });

  it("throws on empty businessId", () => {
    assert.throws(
      () => buildRecordResolutionPlan([{ tableName: "jobs", businessField: "job_id", businessId: "" }]),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("empty"),
    );
  });

  it("throws on whitespace-only businessId", () => {
    assert.throws(
      () => buildRecordResolutionPlan([{ tableName: "jobs", businessField: "job_id", businessId: "   " }]),
      (err: unknown) => err instanceof RecordResolutionError,
    );
  });
});

describe("buildRecordResolutionPlan — command generation", () => {
  it("generates one list command for each distinct identity", () => {
    const plan = buildRecordResolutionPlan([JOB_IDENTITY, CANDIDATE_IDENTITY]);
    assert.equal(plan.commands.length, 2);
  });

  it("deduplicates identical identities", () => {
    const plan = buildRecordResolutionPlan([JOB_IDENTITY, JOB_IDENTITY]);
    assert.equal(plan.commands.length, 1);
    assert.equal(plan.identities.length, 1);
  });

  it("uses lark-cli +record-list commands", () => {
    const plan = buildRecordResolutionPlan([JOB_IDENTITY]);
    assert.equal(plan.commands[0]!.command, "lark-cli");
    assert.ok(plan.commands[0]!.args.includes("+record-list"));
  });

  it("uses limit 200 for client-side matching", () => {
    const plan = buildRecordResolutionPlan([JOB_IDENTITY]);
    const limitIdx = plan.commands[0]!.args.indexOf("--limit");
    assert.equal(plan.commands[0]!.args[limitIdx + 1], "200");
  });

  it("preserves identity order after dedupe", () => {
    const plan = buildRecordResolutionPlan([JOB_IDENTITY, CANDIDATE_IDENTITY, JOB_IDENTITY]);
    assert.equal(plan.identities[0]!.businessId, "job_demo_ai_pm_001");
    assert.equal(plan.identities[1]!.businessId, "cand_demo_001");
  });

  it("command args do not contain raw tokens", () => {
    const plan = buildRecordResolutionPlan([JOB_IDENTITY, CANDIDATE_IDENTITY]);
    const args = plan.commands.flatMap((c) => c.args).join(" ");
    assert.ok(!args.includes("Bearer"));
    assert.ok(!args.includes("token_"));
  });
});

describe("resolveRecordFromListOutput — matching", () => {
  it("resolves a single matching record from stdout", () => {
    const resolved = resolveRecordFromListOutput(JOB_IDENTITY, SAMPLE_JOB_STDOUT);
    assert.equal(resolved.recordId, "recJob001");
    assert.equal(resolved.tableName, "jobs");
    assert.equal(resolved.businessField, "job_id");
    assert.equal(resolved.businessId, "job_demo_ai_pm_001");
  });

  it("resolves candidate record from stdout", () => {
    const resolved = resolveRecordFromListOutput(CANDIDATE_IDENTITY, SAMPLE_CANDIDATE_STDOUT);
    assert.equal(resolved.recordId, "recCand001");
    assert.equal(resolved.tableName, "candidates");
  });

  it("throws on zero matches", () => {
    assert.throws(
      () => resolveRecordFromListOutput(JOB_IDENTITY, listOutput([])),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("No record found"),
    );
  });

  it("throws on multiple matches", () => {
    const dupOutput = listOutput([
      { id: "recDup001", fields: { job_id: "job_demo_ai_pm_001" } },
      { id: "recDup002", fields: { job_id: "job_demo_ai_pm_001" } },
    ]);
    assert.throws(
      () => resolveRecordFromListOutput(JOB_IDENTITY, dupOutput),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("Multiple records"),
    );
  });

  it("ignores records with non-matching businessId", () => {
    assert.throws(
      () => resolveRecordFromListOutput(JOB_IDENTITY, listOutput([{ id: "recOther", fields: { job_id: "job_other_001" } }])),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("No record found"),
    );
  });

  it("ignores records where field value is not a string", () => {
    assert.throws(
      () => resolveRecordFromListOutput(JOB_IDENTITY, listOutput([{ id: "recJob001", fields: { job_id: 123 } }])),
      (err: unknown) => err instanceof RecordResolutionError,
    );
  });

  it("throws on invalid resolved record ID", () => {
    assert.throws(
      () => resolveRecordFromListOutput(JOB_IDENTITY, listOutput([{ id: "job_demo_ai_pm_001", fields: { job_id: "job_demo_ai_pm_001" } }])),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("record ID"),
    );
  });

  it("throws on malformed stdout", () => {
    assert.throws(
      () => resolveRecordFromListOutput(JOB_IDENTITY, "not json"),
      (err: unknown) => err instanceof Error,
    );
  });
});

describe("resolveRecordsFromOutputs — batch resolution", () => {
  it("resolves multiple identities from keyed stdout", () => {
    const resolved = resolveRecordsFromOutputs(
      [JOB_IDENTITY, CANDIDATE_IDENTITY],
      {
        [recordIdentityKey(JOB_IDENTITY)]: SAMPLE_JOB_STDOUT,
        [recordIdentityKey(CANDIDATE_IDENTITY)]: SAMPLE_CANDIDATE_STDOUT,
      },
    );
    assert.equal(resolved.length, 2);
    assert.equal(resolved[0]!.recordId, "recJob001");
    assert.equal(resolved[1]!.recordId, "recCand001");
  });

  it("deduplicates identities during resolution", () => {
    const resolved = resolveRecordsFromOutputs(
      [JOB_IDENTITY, JOB_IDENTITY],
      { [recordIdentityKey(JOB_IDENTITY)]: SAMPLE_JOB_STDOUT },
    );
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.recordId, "recJob001");
  });

  it("throws on empty identities", () => {
    assert.throws(
      () => resolveRecordsFromOutputs([], {}),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("empty"),
    );
  });

  it("throws when stdout is missing for an identity", () => {
    assert.throws(
      () => resolveRecordsFromOutputs([JOB_IDENTITY, CANDIDATE_IDENTITY], { [recordIdentityKey(JOB_IDENTITY)]: SAMPLE_JOB_STDOUT }),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("Missing stdout"),
    );
  });

  it("keeps input order after resolution", () => {
    const resolved = resolveRecordsFromOutputs(
      [CANDIDATE_IDENTITY, JOB_IDENTITY],
      {
        [recordIdentityKey(JOB_IDENTITY)]: SAMPLE_JOB_STDOUT,
        [recordIdentityKey(CANDIDATE_IDENTITY)]: SAMPLE_CANDIDATE_STDOUT,
      },
    );
    assert.equal(resolved[0]!.tableName, "candidates");
    assert.equal(resolved[1]!.tableName, "jobs");
  });
});

describe("MVP record resolution helpers", () => {
  it("buildMvpDemoResolutionPlan includes job and candidate identities", () => {
    const plan = buildMvpDemoResolutionPlan();
    assert.equal(plan.identities.length, 2);
    assert.deepEqual(plan.identities, [MVP_JOB_IDENTITY, MVP_CANDIDATE_IDENTITY]);
  });

  it("buildMvpRecordContext returns jobRecordId and candidateRecordId", () => {
    const ctx = buildMvpRecordContext([
      { tableName: "jobs", businessField: "job_id", businessId: "job_demo_ai_pm_001", recordId: "recJob001" },
      { tableName: "candidates", businessField: "candidate_id", businessId: "cand_demo_001", recordId: "recCand001" },
    ]);
    assert.equal(ctx.jobRecordId, "recJob001");
    assert.equal(ctx.candidateRecordId, "recCand001");
  });

  it("buildMvpRecordContext throws when job is missing", () => {
    assert.throws(
      () => buildMvpRecordContext([
        { tableName: "candidates", businessField: "candidate_id", businessId: "cand_demo_001", recordId: "recCand001" },
      ]),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("Job"),
    );
  });

  it("buildMvpRecordContext throws when candidate is missing", () => {
    assert.throws(
      () => buildMvpRecordContext([
        { tableName: "jobs", businessField: "job_id", businessId: "job_demo_ai_pm_001", recordId: "recJob001" },
      ]),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("Candidate"),
    );
  });

  it("buildMvpRecordContext rejects invalid record IDs", () => {
    const records: ResolvedRecord[] = [
      { tableName: "jobs", businessField: "job_id", businessId: "job_demo_ai_pm_001", recordId: "job_demo_ai_pm_001" },
      { tableName: "candidates", businessField: "candidate_id", businessId: "cand_demo_001", recordId: "recCand001" },
    ];
    assert.throws(
      () => buildMvpRecordContext(records),
      (err: unknown) => err instanceof RecordResolutionError && err.message.includes("record ID"),
    );
  });
});
