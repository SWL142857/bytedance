import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HireLoopConfig } from "../src/config.js";
import type { CommandExecutor } from "../src/base/read-only-runner.js";
import {
  bootstrap,
  runPreflight,
  checkTableStatuses,
  executeSetup,
  executeSeedWithJobLink,
  buildDemoCandidateSeedWithLink,
  buildDemoJobSeed,
  getBootstrapStatus,
  validateBootstrapReport,
} from "../src/base/live-bootstrap.js";
import { isLarkRecordId } from "../src/base/record-values.js";
import { containsSensitivePattern } from "../src/server/redaction.js";
import { DEMO_CANDIDATE_ID, DEMO_JOB_ID } from "../src/fixtures/demo-data.js";

// ── Helpers ──

function fakeConfig(overrides?: Partial<HireLoopConfig>): HireLoopConfig {
  return {
    larkAppId: null,
    larkAppSecret: null,
    baseAppToken: null,
    feishuBaseWebUrl: null,
    modelApiKey: null,
    modelApiEndpoint: null,
    modelId: null,
    modelProvider: "volcengine-ark",
    allowLarkRead: false,
    allowLarkWrite: false,
    debug: false,
    ...overrides,
  };
}

function readyConfig(overrides?: Partial<HireLoopConfig>): HireLoopConfig {
  return fakeConfig({
    larkAppId: "cli_test",
    larkAppSecret: "secret",
    baseAppToken: "basetoken123",
    allowLarkRead: true,
    ...overrides,
  });
}

function emptyBaseExecutor(): CommandExecutor {
  return (_command, args) => {
    const tableIdx = args.indexOf("--table-id");
    const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
    const shortcut = args[1] ?? "";

    // For record-list: return empty list
    if (shortcut === "+record-list") {
      return {
        description: "",
        status: "success",
        stdout: JSON.stringify({ items: [], total: 0, has_more: false }),
        stderr: null,
        exitCode: 0,
        durationMs: 5,
      };
    }

    // For table-create / field-create: succeed
    if (shortcut === "+table-create" || shortcut === "+field-create") {
      return {
        description: "",
        status: "success",
        stdout: JSON.stringify({ code: 0 }),
        stderr: null,
        exitCode: 0,
        durationMs: 10,
      };
    }

    // For record-upsert: return record with ID
    if (shortcut === "+record-upsert") {
      const recordId = table === "Jobs" ? "rec_job_001" : "rec_cand_001";
      return {
        description: "",
        status: "success",
        stdout: JSON.stringify({
          code: 0,
          data: { record: { record_id: recordId } },
        }),
        stderr: null,
        exitCode: 0,
        durationMs: 10,
      };
    }

    return {
      description: "",
      status: "failed",
      stdout: null,
      stderr: "unknown command",
      exitCode: 1,
      durationMs: 0,
    };
  };
}

function nonEmptyBaseExecutor(): CommandExecutor {
  return (_command, args) => {
    const shortcut = args[1] ?? "";
    if (shortcut === "+record-list") {
      return {
        description: "",
        status: "success",
        stdout: JSON.stringify({
          items: [{ id: "rec_existing_001", fields: { title: "已有岗位" } }],
          total: 1,
          has_more: false,
        }),
        stderr: null,
        exitCode: 0,
        durationMs: 5,
      };
    }
    return {
      description: "",
      status: "success",
      stdout: JSON.stringify({ code: 0 }),
      stderr: null,
      exitCode: 0,
      durationMs: 5,
    };
  };
}

function failingExecutor(): CommandExecutor {
  return () => ({
    description: "",
    status: "failed",
    stdout: null,
    stderr: "connection refused",
    exitCode: 1,
    durationMs: 0,
  });
}

function missingTableExecutor(): CommandExecutor {
  return (_command, args) => {
    const shortcut = args[1] ?? "";
    if (shortcut === "+record-list") {
      return {
        description: "",
        status: "failed",
        stdout: null,
        stderr: "table not found",
        exitCode: 1,
        durationMs: 5,
      };
    }
    return emptyBaseExecutor()(_command, args);
  };
}

function commandMissingExecutor(): CommandExecutor {
  return () => ({
    description: "",
    status: "failed",
    stdout: null,
    stderr: "lark-cli: command not found",
    exitCode: 127,
    durationMs: 0,
  });
}

// ── Tests ──

describe("live-bootstrap — getBootstrapStatus", () => {
  it("blocked when no config", () => {
    const status = getBootstrapStatus(fakeConfig());
    assert.equal(status.canRead, false);
    assert.equal(status.canWrite, false);
    assert.ok(status.blockedReasons.length > 0);
    assert.ok(status.blockedReasons.some((r) => r.includes("飞书应用 ID")));
  });

  it("canRead but not canWrite when write flag missing", () => {
    const status = getBootstrapStatus(readyConfig());
    assert.equal(status.canRead, true);
    assert.equal(status.canWrite, false);
  });

  it("canRead and canWrite when fully configured", () => {
    const status = getBootstrapStatus(readyConfig({ allowLarkWrite: true }));
    assert.equal(status.canRead, true);
    assert.equal(status.canWrite, true);
    assert.equal(status.blockedReasons.length, 0);
  });
});

describe("live-bootstrap — preflight", () => {
  it("blocked when config incomplete", () => {
    const result = runPreflight({ config: fakeConfig() });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.length > 0);
    assert.equal(result.tableStatuses.length, 0);
  });

  it("ready on empty Base", () => {
    const result = runPreflight({
      config: readyConfig(),
      executor: emptyBaseExecutor(),
    });
    assert.equal(result.status, "ready");
    assert.equal(result.blockedReasons.length, 0);
    assert.equal(result.tableStatuses.length, 8);
    for (const ts of result.tableStatuses) {
      assert.equal(ts.exists, true);
      assert.equal(ts.recordCount, 0);
    }
  });

  it("blocked when tables have existing data", () => {
    const result = runPreflight({
      config: readyConfig(),
      executor: nonEmptyBaseExecutor(),
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("已有业务数据")));
  });

  it("treats missing tables as safe for empty Base bootstrap", () => {
    const result = runPreflight({
      config: readyConfig(),
      executor: missingTableExecutor(),
    });
    assert.equal(result.status, "ready");
    for (const ts of result.tableStatuses) {
      assert.equal(ts.exists, false);
      assert.equal(ts.readStatus, "missing");
    }
  });

  it("blocks on unknown executor failure", () => {
    const result = runPreflight({
      config: readyConfig(),
      executor: failingExecutor(),
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("无法确认")));
    for (const ts of result.tableStatuses) {
      assert.equal(ts.exists, false);
      assert.equal(ts.readStatus, "failed");
    }
  });

  it("does not treat missing lark-cli as missing tables", () => {
    const result = runPreflight({
      config: readyConfig(),
      executor: commandMissingExecutor(),
    });

    assert.equal(result.status, "blocked");
    assert.ok(result.blockedReasons.some((r) => r.includes("无法确认")));
    assert.equal(result.tableStatuses[0]?.readStatus, "failed");
  });
});

describe("live-bootstrap — checkTableStatuses", () => {
  it("returns status for all 8 tables", () => {
    const statuses = checkTableStatuses(emptyBaseExecutor(), readyConfig());
    assert.equal(statuses.length, 8);
    const tableNames = statuses.map((s) => s.tableName);
    assert.ok(tableNames.includes("jobs"));
    assert.ok(tableNames.includes("candidates"));
    assert.ok(tableNames.includes("resume_facts"));
    assert.ok(tableNames.includes("evaluations"));
    assert.ok(tableNames.includes("interview_kits"));
    assert.ok(tableNames.includes("agent_runs"));
    assert.ok(tableNames.includes("work_events"));
    assert.ok(tableNames.includes("reports"));
  });
});

describe("live-bootstrap — dry-run", () => {
  it("dry-run returns report without executing", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: false,
      executor: emptyBaseExecutor(),
    });

    assert.equal(report.mode, "dry_run");
    assert.equal(report.preflight.status, "ready");
    assert.equal(report.setup.created, 0);
    assert.ok(report.setup.skipped > 0, "should have skipped setup commands");
    assert.equal(report.seed.created, 0);
    assert.equal(report.seed.skipped, 2);
    assert.equal(report.seed.jobLinked, false);
    assert.ok(report.safeSummary.length > 0);
  });

  it("dry-run report is valid", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: false,
      executor: emptyBaseExecutor(),
    });
    assert.doesNotThrow(() => validateBootstrapReport(report));
  });

  it("dry-run still checks preflight", () => {
    const report = bootstrap({
      config: fakeConfig(),
      execute: false,
    });

    assert.equal(report.mode, "dry_run");
    assert.equal(report.preflight.status, "blocked");
  });

  it("dry-run blocked on non-empty Base", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: false,
      executor: nonEmptyBaseExecutor(),
    });

    assert.equal(report.preflight.status, "blocked");
    assert.ok(report.safeSummary.includes("阻断") || report.safeSummary.includes("业务数据"));
  });
});

describe("live-bootstrap — execute blocked paths", () => {
  it("blocked without HIRELOOP_ALLOW_LARK_WRITE", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: true,
      executor: emptyBaseExecutor(),
    });

    assert.equal(report.mode, "execute");
    assert.ok(report.safeSummary.includes("写入未启用"));
    assert.equal(report.setup.created, 0);
    assert.equal(report.seed.created, 0);
  });

  it("blocked without lark credentials", () => {
    const report = bootstrap({
      config: fakeConfig({ allowLarkWrite: true }),
      execute: true,
    });

    assert.equal(report.mode, "execute");
    assert.equal(report.preflight.status, "blocked");
  });

  it("blocked on non-empty Base even with write enabled", () => {
    const report = bootstrap({
      config: readyConfig({ allowLarkWrite: true }),
      execute: true,
      executor: nonEmptyBaseExecutor(),
    });

    assert.equal(report.mode, "execute");
    assert.equal(report.preflight.status, "blocked");
    assert.ok(report.safeSummary.includes("业务数据"));
  });
});

describe("live-bootstrap — execute success path", () => {
  it("execute creates tables and seeds data", () => {
    const report = bootstrap({
      config: readyConfig({ allowLarkWrite: true }),
      execute: true,
      executor: emptyBaseExecutor(),
    });

    assert.equal(report.mode, "execute");
    assert.equal(report.preflight.status, "ready");
    assert.ok(report.setup.created > 0, "should have created tables");
    assert.equal(report.setup.failed, 0);
    assert.equal(report.seed.created, 2);
    assert.equal(report.seed.jobLinked, true);
    assert.ok(report.safeSummary.length > 0);
  });
});

describe("live-bootstrap — job link resolution", () => {
  it("buildDemoCandidateSeedWithLink uses rec_xxx format", () => {
    const seed = buildDemoCandidateSeedWithLink("rec_job_001");
    const jobValue = seed.record.job;
    assert.ok(Array.isArray(jobValue), "job should be array");
    const linkArray = jobValue as Array<{ id: string }>;
    assert.equal(linkArray.length, 1);
    assert.equal(linkArray[0]!.id, "rec_job_001");
    assert.ok(isLarkRecordId(linkArray[0]!.id), "link must be a valid Lark record ID");
  });

  it("buildDemoCandidateSeedWithLink rejects non-record-ID format", () => {
    assert.throws(
      () => buildDemoCandidateSeedWithLink("job_demo_ai_pm_001"),
      (err: unknown) => err instanceof Error && err.message.includes("记录 ID 格式不正确"),
    );
  });

  it("buildDemoCandidateSeedWithLink rejects empty string", () => {
    assert.throws(
      () => buildDemoCandidateSeedWithLink(""),
      (err: unknown) => err instanceof Error,
    );
  });

  it("executeSeedWithJobLink returns jobRecordId from executor output", () => {
    const result = executeSeedWithJobLink({
      config: readyConfig({ allowLarkWrite: true }),
      executor: emptyBaseExecutor(),
    });

    assert.equal(result.jobRecordId, "rec_job_001");
    assert.equal(result.runResult.results.length, 2);
    assert.equal(result.runResult.results[0]!.status, "success");
    assert.equal(result.runResult.results[1]!.status, "success");
  });

  it("executeSeedWithJobLink stops when job creation fails", () => {
    let callCount = 0;
    const failJobExecutor: CommandExecutor = (_command, args) => {
      callCount++;
      const tableIdx = args.indexOf("--table-id");
      const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
      if (table === "Jobs") {
        return {
          description: "",
          status: "failed",
          stdout: null,
          stderr: "permission denied",
          exitCode: 1,
          durationMs: 0,
        };
      }
      return {
        description: "",
        status: "success",
        stdout: JSON.stringify({ code: 0, data: { record: { record_id: "rec_cand_001" } } }),
        stderr: null,
        exitCode: 0,
        durationMs: 5,
      };
    };

    const result = executeSeedWithJobLink({
      config: readyConfig({ allowLarkWrite: true }),
      executor: failJobExecutor,
    });

    assert.equal(result.jobRecordId, null);
    assert.equal(result.runResult.results.length, 1, "should not attempt candidate creation");
    assert.equal(result.runResult.results[0]!.status, "failed");
  });

  it("executeSeedWithJobLink blocks without base token", () => {
    const result = executeSeedWithJobLink({
      config: readyConfig({ baseAppToken: null, allowLarkWrite: true }),
      executor: emptyBaseExecutor(),
    });

    assert.equal(result.jobRecordId, null);
    assert.equal(result.runResult.blocked, true);
  });

  it("executeSeedWithJobLink blocks without write flag", () => {
    const result = executeSeedWithJobLink({
      config: readyConfig(),
      executor: emptyBaseExecutor(),
    });

    assert.equal(result.jobRecordId, null);
    assert.equal(result.runResult.blocked, true);
  });

  it("executeSeedWithJobLink does not return raw stdout/stderr", () => {
    const result = executeSeedWithJobLink({
      config: readyConfig({ allowLarkWrite: true }),
      executor: emptyBaseExecutor(),
    });

    assert.equal(result.runResult.results.length, 2);
    for (const commandResult of result.runResult.results) {
      assert.equal(commandResult.stdout, null);
      assert.equal(commandResult.stderr, null);
    }
  });
});

describe("live-bootstrap — candidate seed does not use business ID as link", () => {
  it("candidate seed record has job as [{ id: rec_xxx }], not job_demo_*", () => {
    const seed = buildDemoCandidateSeedWithLink("rec_test_abc");
    const jobField = seed.record.job;

    // Must be an array of objects with id field
    assert.ok(Array.isArray(jobField), "job must be array");
    const arr = jobField as Array<{ id: string }>;
    assert.equal(arr.length, 1);

    // Must NOT contain business IDs
    const jobStr = JSON.stringify(jobField);
    assert.ok(!jobStr.includes("job_demo_"), "must not contain job_demo_ business ID");
    assert.ok(!jobStr.includes(DEMO_JOB_ID), `must not contain ${DEMO_JOB_ID}`);

    // Must be a valid Lark record ID
    assert.ok(isLarkRecordId(arr[0]!.id), `expected rec_xxx format, got ${arr[0]!.id}`);
  });

  it("full bootstrap uses real record ID for job link", () => {
    let capturedCandidateJson: string | null = null;

    const captureExecutor: CommandExecutor = (_command, args) => {
      const shortcut = args[1] ?? "";
      const tableIdx = args.indexOf("--table-id");
      const table = tableIdx >= 0 ? args[tableIdx + 1] : "";
      const jsonIdx = args.indexOf("--json");

      if (shortcut === "+record-list") {
        return {
          description: "",
          status: "success",
          stdout: JSON.stringify({ items: [], total: 0, has_more: false }),
          stderr: null,
          exitCode: 0,
          durationMs: 5,
        };
      }

      if (shortcut === "+table-create" || shortcut === "+field-create") {
        return {
          description: "",
          status: "success",
          stdout: JSON.stringify({ code: 0 }),
          stderr: null,
          exitCode: 0,
          durationMs: 10,
        };
      }

      if (shortcut === "+record-upsert") {
        if (table === "Candidates" && jsonIdx >= 0) {
          capturedCandidateJson = args[jsonIdx + 1] ?? null;
        }
        const recordId = table === "Jobs" ? "rec_job_xyz" : "rec_cand_xyz";
        return {
          description: "",
          status: "success",
          stdout: JSON.stringify({ code: 0, data: { record: { record_id: recordId } } }),
          stderr: null,
          exitCode: 0,
          durationMs: 10,
        };
      }

      return { description: "", status: "failed", stdout: null, stderr: "unknown", exitCode: 1, durationMs: 0 };
    };

    bootstrap({
      config: readyConfig({ allowLarkWrite: true }),
      execute: true,
      executor: captureExecutor,
    });

    assert.ok(capturedCandidateJson, "should have captured candidate JSON");
    const parsed = JSON.parse(capturedCandidateJson!);
    const jobLink = parsed.job;
    assert.ok(Array.isArray(jobLink), "job should be array");
    assert.equal(jobLink.length, 1);
    assert.equal(jobLink[0].id, "rec_job_xyz", "must use the actual record ID from job creation");
    assert.ok(!(capturedCandidateJson as string).includes("job_demo_"), "must not contain business ID");
  });
});

describe("live-bootstrap — report redaction safety", () => {
  it("safeSummary does not contain sensitive patterns", () => {
    const report = bootstrap({
      config: readyConfig({ allowLarkWrite: true }),
      execute: true,
      executor: emptyBaseExecutor(),
    });

    assert.ok(!containsSensitivePattern(report.safeSummary), `safeSummary contains sensitive pattern: ${report.safeSummary}`);
  });

  it("dry-run safeSummary does not contain sensitive patterns", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: false,
      executor: emptyBaseExecutor(),
    });

    assert.ok(!containsSensitivePattern(report.safeSummary), `safeSummary contains sensitive pattern: ${report.safeSummary}`);
  });

  it("blocked safeSummary does not contain sensitive patterns", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: true,
      executor: emptyBaseExecutor(),
    });

    assert.ok(!containsSensitivePattern(report.safeSummary));
  });

  it("report does not contain rec_ or BASE_APP_TOKEN", () => {
    const report = bootstrap({
      config: readyConfig({ allowLarkWrite: true }),
      execute: true,
      executor: emptyBaseExecutor(),
    });

    const reportJson = JSON.stringify(report);
    assert.ok(!reportJson.includes("rec_"), "report must not contain rec_ record IDs");
    assert.ok(!reportJson.includes("basetoken123"), "report must not contain base token");
  });
});

describe("live-bootstrap — validateBootstrapReport", () => {
  it("validates a correct report", () => {
    const report = bootstrap({
      config: readyConfig(),
      execute: false,
      executor: emptyBaseExecutor(),
    });
    assert.doesNotThrow(() => validateBootstrapReport(report));
  });

  it("rejects invalid mode", () => {
    assert.throws(
      () => validateBootstrapReport({
        mode: "invalid" as "dry_run",
        preflight: { status: "ready", blockedReasons: [], tableStatuses: [] },
        setup: { created: 0, skipped: 0, failed: 0 },
        seed: { created: 0, skipped: 0, failed: 0, jobLinked: false },
        safeSummary: "test",
      }),
      (err: unknown) => err instanceof Error && err.message.includes("mode"),
    );
  });

  it("rejects missing preflight", () => {
    assert.throws(
      () => validateBootstrapReport({
        mode: "dry_run",
        preflight: null as unknown as import("../src/base/live-bootstrap.js").PreflightResult,
        setup: { created: 0, skipped: 0, failed: 0 },
        seed: { created: 0, skipped: 0, failed: 0, jobLinked: false },
        safeSummary: "test",
      }),
    );
  });
});

describe("live-bootstrap — demo seed data integrity", () => {
  it("buildDemoJobSeed has correct business ID", () => {
    const seed = buildDemoJobSeed();
    assert.equal(seed.record.job_id, DEMO_JOB_ID);
    assert.equal(seed.tableName, "jobs");
    assert.equal(seed.displayName, "Jobs");
  });

  it("buildDemoCandidateSeedWithLink has correct business ID", () => {
    const seed = buildDemoCandidateSeedWithLink("rec_any");
    assert.equal(seed.record.candidate_id, DEMO_CANDIDATE_ID);
    assert.equal(seed.tableName, "candidates");
    assert.equal(seed.displayName, "Candidates");
  });

  it("buildDemoCandidateSeedWithLink has resume text", () => {
    const seed = buildDemoCandidateSeedWithLink("rec_any");
    const resumeText = seed.record.resume_text as string;
    assert.ok(resumeText.length > 0, "resume text should not be empty");
    assert.ok(resumeText.includes("fictional"), "resume text should be explicitly fictional");
  });

  it("buildDemoCandidateSeedWithLink does not have business ID in job field", () => {
    const seed = buildDemoCandidateSeedWithLink("rec_real_123");
    const jobField = JSON.stringify(seed.record.job);
    assert.ok(!jobField.includes(DEMO_JOB_ID), "job link must not contain business ID");
    assert.ok(jobField.includes("rec_real_123"), "job link must contain the passed record ID");
  });
});

describe("live-bootstrap — executeSetup (blocked paths)", () => {
  it("blocked without write flag", () => {
    const result = executeSetup(readyConfig());
    assert.equal(result.blocked, true);
    for (const r of result.results) {
      assert.equal(r.status, "skipped");
    }
  });
});
