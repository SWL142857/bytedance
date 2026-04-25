import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TABLE_MAP, ALL_TABLES } from "../src/base/schema.js";
import { buildRecordPayload, RecordValueError } from "../src/base/record-values.js";
import { listRecords, upsertRecord, updateCandidateStatus, appendAgentRun, planFromCommands } from "../src/base/runtime.js";
import { listCandidatesForStatusFilter, listJobsForOpenFilter, listAgentRunsForEntityFilter } from "../src/base/queries.js";
import { parseRecordList, safeParseJson, OutputParseError } from "../src/base/lark-cli-runner.js";
import { runPlan } from "../src/base/lark-cli-runner.js";
import { loadConfig } from "../src/config.js";
import type { AgentRunRecord } from "../src/base/runtime.js";

describe("record values — tableName resolution", () => {
  it("internal tableName maps to display name via TABLE_MAP", () => {
    const names = [
      ["jobs", "Jobs"],
      ["candidates", "Candidates"],
      ["resume_facts", "Resume Facts"],
      ["evaluations", "Evaluations"],
      ["interview_kits", "Interview Kits"],
      ["agent_runs", "Agent Runs"],
      ["reports", "Reports"],
    ] as const;
    for (const [internal, display] of names) {
      const table = TABLE_MAP.get(internal);
      assert.ok(table, `Missing table: ${internal}`);
      assert.equal(table!.name, display);
    }
  });

  it("all ALL_TABLES entries exist in TABLE_MAP", () => {
    for (const table of ALL_TABLES) {
      assert.ok(TABLE_MAP.has(table.tableName), `TABLE_MAP missing: ${table.tableName}`);
    }
  });
});

describe("record values — buildRecordPayload", () => {
  it("builds a valid payload for text/number/select fields", () => {
    const payload = buildRecordPayload("jobs", {
      job_id: "job_001",
      title: "Engineer",
      level: "P6",
      status: "open",
    });
    assert.equal(payload.job_id, "job_001");
    assert.equal(payload.title, "Engineer");
    assert.equal(payload.status, "open");
  });

  it("includes checkbox boolean values", () => {
    const payload = buildRecordPayload("candidates", {
      candidate_id: "cand_001",
      display_name: "Test",
      talent_pool_candidate: true,
      status: "new",
    });
    assert.equal(payload.talent_pool_candidate, true);
  });

  it("includes datetime string for date fields", () => {
    const payload = buildRecordPayload("jobs", {
      job_id: "job_001",
      created_at: "2026-04-25 00:00:00",
    });
    assert.equal(payload.created_at, "2026-04-25 00:00:00");
  });

  it("includes url string for url fields", () => {
    const payload = buildRecordPayload("candidates", {
      candidate_id: "cand_001",
      resume_source: "https://example.com/resume.pdf",
    });
    assert.equal(payload.resume_source, "https://example.com/resume.pdf");
  });

  it("accepts valid record ID in link field", () => {
    const payload = buildRecordPayload("candidates", {
      candidate_id: "cand_001",
      job: [{ id: "recAbc123" }],
    });
    assert.deepEqual(payload.job, [{ id: "recAbc123" }]);
  });

  it("accepts a valid record ID string in link field", () => {
    const payload = buildRecordPayload("candidates", {
      candidate_id: "cand_001",
      job: "recAbc123",
    });
    assert.deepEqual(payload.job, [{ id: "recAbc123" }]);
  });

  it("rejects application ID in link field", () => {
    assert.throws(
      () => buildRecordPayload("candidates", {
        candidate_id: "cand_001",
        job: "job_demo_ai_pm_001",
      }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("application ID"),
    );
  });

  it("rejects application ID in link field array", () => {
    assert.throws(
      () => buildRecordPayload("candidates", {
        candidate_id: "cand_001",
        job: [{ id: "job_demo_ai_pm_001" }],
      }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("application ID"),
    );
  });

  it("rejects link array items without id", () => {
    assert.throws(
      () => buildRecordPayload("candidates", {
        candidate_id: "cand_001",
        job: [{ value: "recAbc123" }],
      }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("{ id"),
    );
  });

  it("rejects link array items with non-string id", () => {
    assert.throws(
      () => buildRecordPayload("candidates", {
        candidate_id: "cand_001",
        job: [{ id: 123 }],
      }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("string record IDs"),
    );
  });

  it("rejects unknown select option", () => {
    assert.throws(
      () => buildRecordPayload("jobs", {
        job_id: "job_001",
        status: "archived",
      }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("unknown option"),
    );
  });

  it("skips null fields", () => {
    const payload = buildRecordPayload("candidates", {
      candidate_id: "cand_001",
      display_name: "Test",
      status: "new",
      resume_source: null,
      screening_recommendation: null,
    });
    assert.ok(!("resume_source" in payload));
    assert.ok(!("screening_recommendation" in payload));
  });

  it("skips undefined fields", () => {
    const payload = buildRecordPayload("candidates", {
      candidate_id: "cand_001",
      display_name: "Test",
      status: "new",
      human_decision_note: undefined,
    });
    assert.ok(!("human_decision_note" in payload));
  });

  it("rejects unknown table name", () => {
    assert.throws(
      () => buildRecordPayload("nonexistent", { id: "1" }),
      (err: unknown) => err instanceof RecordValueError,
    );
  });

  it("rejects unknown field name", () => {
    assert.throws(
      () => buildRecordPayload("jobs", { job_id: "1", totally_fake: "x" }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("totally_fake"),
    );
  });

  it("rejects wrong type for number field", () => {
    assert.throws(
      () => buildRecordPayload("agent_runs", {
        run_id: "run_001",
        retry_count: "three" as unknown as number,
      }),
      (err: unknown) => err instanceof RecordValueError,
    );
  });

  it("rejects wrong type for checkbox field", () => {
    assert.throws(
      () => buildRecordPayload("candidates", {
        candidate_id: "cand_001",
        talent_pool_candidate: "yes" as unknown as boolean,
      }),
      (err: unknown) => err instanceof RecordValueError,
    );
  });

  it("rejects NaN for number field", () => {
    assert.throws(
      () => buildRecordPayload("agent_runs", {
        run_id: "run_001",
        retry_count: NaN,
      }),
      (err: unknown) => err instanceof RecordValueError,
    );
  });

  it("rejects Infinity for number field", () => {
    assert.throws(
      () => buildRecordPayload("agent_runs", {
        run_id: "run_001",
        duration_ms: Infinity,
      }),
      (err: unknown) => err instanceof RecordValueError,
    );
  });

  it("rejects -Infinity for number field", () => {
    assert.throws(
      () => buildRecordPayload("agent_runs", {
        run_id: "run_001",
        duration_ms: -Infinity,
      }),
      (err: unknown) => err instanceof RecordValueError,
    );
  });
});

describe("runtime — upsertRecord", () => {
  it("generates +record-upsert command with display table name", () => {
    const cmd = upsertRecord("jobs", {
      job_id: "job_001",
      title: "Engineer",
      status: "open",
    });
    assert.equal(cmd.command, "lark-cli");
    assert.ok(cmd.args.includes("+record-upsert"));
    assert.ok(cmd.args.includes("Jobs"));
    assert.ok(cmd.writesRemote);
    assert.ok(cmd.needsBaseToken);
  });

  it("command args are an argv array, no shell joining", () => {
    const cmd = upsertRecord("candidates", {
      candidate_id: "cand_001",
      display_name: "Test",
      status: "new",
    });
    assert.ok(Array.isArray(cmd.args));
    assert.ok(Array.isArray(cmd.redactedArgs));
    const jsonIdx = cmd.args.indexOf("--json");
    assert.ok(jsonIdx >= 0, "Missing --json");
    const jsonArg = cmd.args[jsonIdx + 1];
    assert.ok(jsonArg, "Missing JSON value");
    const parsed = JSON.parse(jsonArg!);
    assert.equal(parsed.candidate_id, "cand_001");
  });

  it("redactedArgs use placeholder token", () => {
    const cmd = upsertRecord("jobs", { job_id: "j1", status: "open" });
    const tokenIdx = cmd.redactedArgs.indexOf("--base-token");
    assert.ok(tokenIdx >= 0);
    assert.equal(cmd.redactedArgs[tokenIdx + 1], "<BASE_APP_TOKEN>");
  });

  it("uses --record-id when updating an existing record", () => {
    const cmd = upsertRecord(
      "jobs",
      { status: "paused" },
      { recordId: "recJob001" },
    );
    const recordIdIdx = cmd.args.indexOf("--record-id");
    assert.equal(cmd.args[recordIdIdx + 1], "recJob001");
  });

  it("rejects non-record IDs in upsert options", () => {
    assert.throws(
      () => upsertRecord("jobs", { status: "paused" }, { recordId: "job_demo_001" }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("recordId"),
    );
  });
});

describe("runtime — listRecords", () => {
  it("generates +record-list command with display table name", () => {
    const cmd = listRecords("candidates");
    assert.equal(cmd.command, "lark-cli");
    assert.ok(cmd.args.includes("+record-list"));
    assert.ok(cmd.args.includes("Candidates"));
    assert.ok(cmd.args.includes("--offset"));
    assert.ok(cmd.args.includes("--limit"));
    assert.equal(cmd.writesRemote, false);
    assert.ok(cmd.needsBaseToken);
  });

  it("respects custom offset and limit", () => {
    const cmd = listRecords("jobs", { offset: 10, limit: 50 });
    const offsetIdx = cmd.args.indexOf("--offset");
    const limitIdx = cmd.args.indexOf("--limit");
    assert.equal(cmd.args[offsetIdx + 1], "10");
    assert.equal(cmd.args[limitIdx + 1], "50");
  });

  it("includes view-id when provided", () => {
    const cmd = listRecords("jobs", { viewId: "viwOpenJobs", offset: 0, limit: 50 });
    const viewIdx = cmd.args.indexOf("--view-id");
    assert.equal(cmd.args[viewIdx + 1], "viwOpenJobs");
  });

  it("defaults to offset=0 limit=100", () => {
    const cmd = listRecords("agent_runs");
    const offsetIdx = cmd.args.indexOf("--offset");
    const limitIdx = cmd.args.indexOf("--limit");
    assert.equal(cmd.args[offsetIdx + 1], "0");
    assert.equal(cmd.args[limitIdx + 1], "100");
  });

  it("rejects record-list limit above 200", () => {
    assert.throws(
      () => listRecords("jobs", { limit: 201 }),
      /limit must be an integer between 1 and 200/,
    );
  });

  it("rejects negative record-list offset", () => {
    assert.throws(
      () => listRecords("jobs", { offset: -1 }),
      /offset must be a non-negative integer/,
    );
  });
});

describe("runtime — updateCandidateStatus", () => {
  it("agent can transition new -> parsed", () => {
    const cmd = updateCandidateStatus({
      candidateRecordId: "recCand001",
      fromStatus: "new",
      toStatus: "parsed",
      actor: "agent",
    });
    assert.ok(cmd.description.includes("new -> parsed"));
    assert.ok(cmd.writesRemote);
    const jsonIdx = cmd.args.indexOf("--json");
    const parsed = JSON.parse(cmd.args[jsonIdx + 1]!);
    assert.equal(parsed.status, "parsed");
    assert.equal("candidate_id" in parsed, false);
    const recordIdIdx = cmd.args.indexOf("--record-id");
    assert.equal(cmd.args[recordIdIdx + 1], "recCand001");
  });

  it("agent can transition parsed -> screened", () => {
    const cmd = updateCandidateStatus({
      candidateRecordId: "recCand001",
      fromStatus: "parsed",
      toStatus: "screened",
      actor: "agent",
    });
    assert.ok(cmd.description.includes("parsed -> screened"));
  });

  it("human_confirm can transition decision_pending -> offer", () => {
    const cmd = updateCandidateStatus({
      candidateRecordId: "recCand001",
      fromStatus: "decision_pending",
      toStatus: "offer",
      actor: "human_confirm",
    });
    assert.ok(cmd.description.includes("decision_pending -> offer"));
  });

  it("agent cannot transition decision_pending -> offer", () => {
    assert.throws(
      () => updateCandidateStatus({
        candidateRecordId: "recCand001",
        fromStatus: "decision_pending",
        toStatus: "offer",
        actor: "agent",
      }),
    );
  });

  it("agent cannot transition decision_pending -> rejected", () => {
    assert.throws(
      () => updateCandidateStatus({
        candidateRecordId: "recCand001",
        fromStatus: "decision_pending",
        toStatus: "rejected",
        actor: "agent",
      }),
    );
  });

  it("rejects invalid jump new -> screened", () => {
    assert.throws(
      () => updateCandidateStatus({
        candidateRecordId: "recCand001",
        fromStatus: "new",
        toStatus: "screened",
        actor: "agent",
      }),
    );
  });

  it("rejects non-record candidate IDs", () => {
    assert.throws(
      () => updateCandidateStatus({
        candidateRecordId: "cand_demo_001",
        fromStatus: "new",
        toStatus: "parsed",
        actor: "agent",
      }),
      (err: unknown) => err instanceof RecordValueError && err.message.includes("candidateRecordId"),
    );
  });
});

describe("runtime — appendAgentRun", () => {
  it("generates upsert command for agent_runs table", () => {
    const run: AgentRunRecord = {
      run_id: "run_001",
      agent_name: "screening",
      entity_type: "candidate",
      entity_ref: "recCand001",
      input_summary: "Screened candidate X",
      prompt_template_id: "screen_v1",
      git_commit_hash: "abc1234",
      run_status: "success",
      retry_count: 0,
      duration_ms: 1500,
    };
    const cmd = appendAgentRun(run);
    assert.ok(cmd.args.includes("Agent Runs"));
    assert.ok(cmd.writesRemote);
    const jsonIdx = cmd.args.indexOf("--json");
    const parsed = JSON.parse(cmd.args[jsonIdx + 1]!);
    assert.equal(parsed.run_id, "run_001");
    assert.equal(parsed.agent_name, "screening");
  });
});

describe("queries — command builders", () => {
  it("listCandidatesForStatusFilter uses candidates display name", () => {
    const cmd = listCandidatesForStatusFilter("new");
    assert.ok(cmd.args.includes("Candidates"));
    assert.ok(cmd.description.includes("client-side"));
    assert.ok(cmd.description.includes("new"));
  });

  it("listJobsForOpenFilter uses jobs display name", () => {
    const cmd = listJobsForOpenFilter();
    assert.ok(cmd.args.includes("Jobs"));
    assert.ok(cmd.description.includes("client-side"));
  });

  it("listAgentRunsForEntityFilter uses agent_runs display name", () => {
    const cmd = listAgentRunsForEntityFilter("candidate", "recCand001");
    assert.ok(cmd.args.includes("Agent Runs"));
    assert.ok(cmd.description.includes("client-side"));
    assert.ok(cmd.description.includes("candidate"));
    assert.ok(cmd.description.includes("recCand001"));
  });
});

describe("runtime — dry-run safety", () => {
  it("dry-run does not require secrets", () => {
    const cmd = upsertRecord("jobs", { job_id: "j1", status: "open" });
    const plan = planFromCommands([cmd]);
    const config = loadConfig({});
    const result = runPlan({ plan, config, execute: false });
    assert.equal(result.blocked, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]!.status, "planned");
  });

  it("execute blocked without config", () => {
    const cmd = upsertRecord("jobs", { job_id: "j1", status: "open" });
    const plan = planFromCommands([cmd]);
    const config = loadConfig({});
    const result = runPlan({ plan, config, execute: true });
    assert.equal(result.blocked, true);
    assert.equal(result.results[0]!.status, "skipped");
  });

  it("execute blocked without allowLarkWrite even with fake config", () => {
    const cmd = upsertRecord("jobs", { job_id: "j1", status: "open" });
    const plan = planFromCommands([cmd]);
    const config = loadConfig({
      LARK_APP_ID: "fake",
      LARK_APP_SECRET: "fake",
      BASE_APP_TOKEN: "fake",
    });
    const result = runPlan({ plan, config, execute: true });
    assert.equal(result.blocked, true);
    assert.equal(result.results[0]!.status, "skipped");
  });
});

describe("runner — output parsing", () => {
  it("parseRecordList extracts records from valid JSON", () => {
    const stdout = JSON.stringify({
      items: [
        { id: "rec001", fields: { title: "Test" } },
        { id: "rec002", fields: { title: "Other" } },
      ],
      total: 2,
      has_more: false,
    });
    const result = parseRecordList(stdout);
    assert.equal(result.records.length, 2);
    assert.equal(result.records[0]!.id, "rec001");
    assert.equal(result.records[1]!.fields.title, "Other");
    assert.equal(result.total, 2);
    assert.equal(result.hasMore, false);
  });

  it("parseRecordList accepts native record_id fields", () => {
    const stdout = JSON.stringify({
      items: [
        { record_id: "rec001", fields: { title: "Test" } },
      ],
      total: 1,
      has_more: false,
    });
    const result = parseRecordList(stdout);
    assert.equal(result.records[0]!.id, "rec001");
  });

  it("parseRecordList accepts data-wrapped outputs", () => {
    const stdout = JSON.stringify({
      data: {
        items: [
          { record_id: "rec001", fields: { title: "Test" } },
        ],
        total: 1,
        has_more: false,
      },
    });
    const result = parseRecordList(stdout);
    assert.equal(result.records[0]!.id, "rec001");
    assert.equal(result.total, 1);
    assert.equal(result.hasMore, false);
  });

  it("parseRecordList throws on null stdout", () => {
    assert.throws(
      () => parseRecordList(null),
      (err: unknown) => err instanceof OutputParseError,
    );
  });

  it("parseRecordList throws on invalid JSON", () => {
    assert.throws(
      () => parseRecordList("not json at all"),
      (err: unknown) => err instanceof OutputParseError,
    );
  });

  it("parseRecordList throws when items is not an array", () => {
    assert.throws(
      () => parseRecordList(JSON.stringify({ items: "oops" })),
      (err: unknown) => err instanceof OutputParseError,
    );
  });

  it("safeParseJson redacts tokens from output", () => {
    const stdout = JSON.stringify({ token: "app_abc123secret", data: "ok" });
    const result = safeParseJson(stdout) as Record<string, unknown>;
    assert.equal(result.token, "<REDACTED_TOKEN>");
    assert.equal(result.data, "ok");
  });

  it("safeParseJson throws on empty string", () => {
    assert.throws(
      () => safeParseJson(""),
      (err: unknown) => err instanceof OutputParseError,
    );
  });

  it("parseRecordList throws when record fields is missing", () => {
    const stdout = JSON.stringify({
      items: [{ id: "rec001" }],
    });
    assert.throws(
      () => parseRecordList(stdout),
      (err: unknown) => err instanceof OutputParseError && err.message.includes("missing"),
    );
  });

  it("parseRecordList throws when record fields is null", () => {
    const stdout = JSON.stringify({
      items: [{ id: "rec001", fields: null }],
    });
    assert.throws(
      () => parseRecordList(stdout),
      (err: unknown) => err instanceof OutputParseError && err.message.includes("missing"),
    );
  });

  it("parseRecordList throws when record fields is an array", () => {
    const stdout = JSON.stringify({
      items: [{ id: "rec001", fields: [1, 2, 3] }],
    });
    assert.throws(
      () => parseRecordList(stdout),
      (err: unknown) => err instanceof OutputParseError && err.message.includes("non-object"),
    );
  });

  it("parseRecordList throws when record fields is a string", () => {
    const stdout = JSON.stringify({
      items: [{ id: "rec001", fields: "oops" }],
    });
    assert.throws(
      () => parseRecordList(stdout),
      (err: unknown) => err instanceof OutputParseError && err.message.includes("non-object"),
    );
  });
});
