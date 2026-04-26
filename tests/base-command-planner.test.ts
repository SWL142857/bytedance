import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateSetupPlan, generateSeedPlan, generateFullPlan, validateExecutablePlan, ExecutionBlockedError } from "../src/base/commands.js";
import { ALL_TABLES } from "../src/base/schema.js";
import { DEMO_JOB, DEMO_CANDIDATE, ALL_DEMO_SEEDS } from "../src/fixtures/demo-data.js";
import { runPlan } from "../src/base/lark-cli-runner.js";
import { loadConfig } from "../src/config.js";
import { mapFieldDef } from "../src/base/field-mapping.js";

describe("base command planner — setup plan command shape", () => {
  const plan = generateSetupPlan();

  it("has zero unsupported fields", () => {
    assert.equal(plan.unsupportedFields.length, 0, `Unsupported: ${plan.unsupportedFields.map((u) => `${u.tableName}.${u.fieldName}: ${u.fieldType}`).join(", ")}`);
  });

  it("contains commands for all 7 tables", () => {
    const tableCreateCmds = plan.commands.filter(
      (c) => c.description.includes("Create table"),
    );
    assert.equal(tableCreateCmds.length, 7);

    const tableNames = tableCreateCmds.map((c) => {
      const idx = c.args.indexOf("--name");
      return idx >= 0 ? c.args[idx + 1] : null;
    });
    const expectedTableNames = ALL_TABLES.map((t) => t.name);
    for (const tName of expectedTableNames) {
      assert.ok(tableNames.includes(tName), `Missing table: ${tName}`);
    }
  });

  it("creates a field command for every field in every table", () => {
    const fieldCreateCmds = plan.commands.filter(
      (c) => c.description.includes("Create field"),
    );
    let expectedFieldCount = 0;
    for (const table of ALL_TABLES) {
      expectedFieldCount += table.fields.length;
    }
    assert.equal(fieldCreateCmds.length, expectedFieldCount);
  });

  it("uses lark-cli as command", () => {
    for (const cmd of plan.commands) {
      assert.equal(cmd.command, "lark-cli", `Expected lark-cli, got ${cmd.command} for: ${cmd.description}`);
    }
  });

  it("table create uses +table-create shortcut", () => {
    const tableCmds = plan.commands.filter((c) => c.description.includes("Create table"));
    for (const cmd of tableCmds) {
      assert.ok(cmd.args.includes("+table-create"), `Missing +table-create in: ${cmd.description}`);
      assert.ok(cmd.args.includes("--base-token"), `Missing --base-token in: ${cmd.description}`);
      assert.ok(cmd.args.includes("--name"), `Missing --name in: ${cmd.description}`);
      assert.ok(!cmd.args.includes("--table_id"), `Should not have --table_id: ${cmd.description}`);
    }
  });

  it("field create uses visible table name as --table-id", () => {
    const fieldCmds = plan.commands.filter((c) => c.description.includes("Create field"));
    for (const cmd of fieldCmds) {
      assert.ok(cmd.args.includes("+field-create"), `Missing +field-create in: ${cmd.description}`);
      assert.ok(cmd.args.includes("--table-id"), `Missing --table-id in: ${cmd.description}`);
      assert.ok(cmd.args.includes("--json"), `Missing --json in: ${cmd.description}`);

      const tableIdIdx = cmd.args.indexOf("--table-id");
      const tableId = cmd.args[tableIdIdx + 1];
      const isDisplayName = ALL_TABLES.some((t) => t.name === tableId);
      assert.ok(isDisplayName, `--table-id "${tableId}" is not a visible table name, expected one of: ${ALL_TABLES.map((t) => t.name).join(", ")}`);

      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      assert.ok(jsonArg, `Missing JSON argument after --json in: ${cmd.description}`);
      const fieldJson = JSON.parse(jsonArg);
      assert.ok(typeof fieldJson.name === "string", `Field JSON missing name: ${cmd.description}`);
      assert.ok(typeof fieldJson.type === "string", `Field JSON missing string type: ${cmd.description}`);
      assert.ok(!("field_name" in fieldJson), `Field JSON should not have field_name: ${cmd.description}`);
      assert.ok(!("property" in fieldJson), `Field JSON should not have property: ${cmd.description}`);
    }
  });

  it("table creation comes before field creation for same table", () => {
    const cmds = plan.commands;
    for (let i = 1; i < cmds.length; i++) {
      if (cmds[i]?.description.includes("Create field")) {
        const tableIdIdx = cmds[i]!.args.indexOf("--table-id");
        const tableId = tableIdIdx >= 0 ? cmds[i]!.args[tableIdIdx + 1] ?? null : null;
        const tableCreateIndex = cmds.findIndex(
          (c) =>
            tableId &&
            c.description.includes("Create table") &&
            c.description.includes(tableId),
        );
        assert.ok(tableCreateIndex < i, `Field for ${tableId} appears before table creation`);
      }
    }
  });

  it("command order is stable across multiple calls", () => {
    const plan2 = generateSetupPlan();
    assert.equal(plan.commands.length, plan2.commands.length);
    for (let i = 0; i < plan.commands.length; i++) {
      assert.equal(plan.commands[i]!.description, plan2.commands[i]!.description);
    }
  });

  it("all commands use argv arrays", () => {
    for (const cmd of plan.commands) {
      assert.ok(Array.isArray(cmd.args));
      assert.ok(Array.isArray(cmd.redactedArgs));
    }
  });

  it("redactedArgs use <BASE_APP_TOKEN> placeholder", () => {
    for (const cmd of plan.commands) {
      if (cmd.needsBaseToken) {
        const tokenIdx = cmd.redactedArgs.indexOf("--base-token");
        assert.ok(tokenIdx >= 0, `Missing --base-token in redactedArgs: ${cmd.description}`);
        assert.equal(cmd.redactedArgs[tokenIdx + 1], "<BASE_APP_TOKEN>", `Token not redacted in: ${cmd.description}`);
      }
    }
  });

  it("no command spec or redactedArgs contains raw secrets", () => {
    const secretPatterns = [/app_secret/i, /api_key/i, /sk-[a-f0-9]/i, /Bearer/i];
    for (const cmd of plan.commands) {
      const allText = [...cmd.redactedArgs, cmd.description].join(" ");
      for (const pattern of secretPatterns) {
        assert.ok(!pattern.test(allText), `Secret pattern found in: ${cmd.description}`);
      }
    }
  });

  it("all commands have writesRemote=true", () => {
    for (const cmd of plan.commands) {
      assert.equal(cmd.writesRemote, true);
    }
  });

  it("all commands have needsBaseToken=true", () => {
    for (const cmd of plan.commands) {
      assert.equal(cmd.needsBaseToken, true);
    }
  });
});

describe("base command planner — seed plan command shape", () => {
  const plan = generateSeedPlan(ALL_DEMO_SEEDS);

  it("uses lark-cli as command", () => {
    for (const cmd of plan.commands) {
      assert.equal(cmd.command, "lark-cli");
    }
  });

  it("seed uses +record-upsert with visible table name as --table-id", () => {
    for (const cmd of plan.commands) {
      assert.ok(cmd.args.includes("+record-upsert"), `Missing +record-upsert in: ${cmd.description}`);
      assert.ok(cmd.args.includes("--table-id"), `Missing --table-id in: ${cmd.description}`);
      assert.ok(cmd.args.includes("--json"), `Missing --json in: ${cmd.description}`);

      const tableIdIdx = cmd.args.indexOf("--table-id");
      const tableId = cmd.args[tableIdIdx + 1];
      const isDisplayName = ALL_TABLES.some((t) => t.name === tableId);
      assert.ok(isDisplayName, `Seed --table-id "${tableId}" is not a visible table name`);
    }
  });

  it("contains seed commands for demo job and candidate", () => {
    const seedDescs = plan.commands.map((c) => c.description);
    assert.ok(seedDescs.some((d) => d.includes("Jobs")), "Missing Jobs seed");
    assert.ok(seedDescs.some((d) => d.includes("Candidates")), "Missing Candidates seed");
  });

  it("demo job has stable ID", () => {
    assert.equal(DEMO_JOB.record.job_id, "job_demo_ai_pm_001");
  });

  it("demo job uses stable datetime record format", () => {
    assert.equal(DEMO_JOB.record.created_at, "2026-04-25 00:00:00");
  });

  it("demo candidate has stable ID", () => {
    assert.equal(DEMO_CANDIDATE.record.candidate_id, "cand_demo_001");
  });

  it("demo candidate does not write link fields before record IDs exist", () => {
    assert.equal("job" in DEMO_CANDIDATE.record, false);
  });

  it("demo seed data uses visible table names", () => {
    for (const seed of ALL_DEMO_SEEDS) {
      const isDisplayName = ALL_TABLES.some((t) => t.name === seed.displayName);
      assert.ok(isDisplayName, `Seed displayName "${seed.displayName}" is not a visible table name`);
    }
  });

  it("demo data does not contain real PII patterns", () => {
    const allText = JSON.stringify(ALL_DEMO_SEEDS);
    const phonePattern = /1[3-9]\d{9}/;
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/;
    const idCardPattern = /\d{17}[\dXx]/;
    assert.ok(!phonePattern.test(allText), "Demo data contains phone number pattern");
    assert.ok(!emailPattern.test(allText), "Demo data contains email pattern");
    assert.ok(!idCardPattern.test(allText), "Demo data contains ID card pattern");
  });

  it("demo candidate resume text is explicitly fictional", () => {
    const resumeText = DEMO_CANDIDATE.record.resume_text as string;
    assert.ok(resumeText.includes("fictional"), "Resume text should be clearly fictional");
  });

  it("seed redactedArgs use <BASE_APP_TOKEN> placeholder", () => {
    for (const cmd of plan.commands) {
      const tokenIdx = cmd.redactedArgs.indexOf("--base-token");
      assert.ok(tokenIdx >= 0);
      assert.equal(cmd.redactedArgs[tokenIdx + 1], "<BASE_APP_TOKEN>");
    }
  });
});

describe("base command planner — full plan ordering", () => {
  const plan = generateFullPlan(ALL_DEMO_SEEDS);

  it("setup commands come before seed commands", () => {
    const cmds = plan.commands;
    const firstSeedIndex = cmds.findIndex((c) => c.description.includes("Seed record"));
    const lastSetupIndex = cmds.findLastIndex(
      (c) => c.description.includes("Create field") || c.description.includes("Create table"),
    );
    assert.ok(firstSeedIndex > lastSetupIndex, "Seed commands should come after setup commands");
  });

  it("full plan also has zero unsupported fields", () => {
    assert.equal(plan.unsupportedFields.length, 0);
  });
});

describe("base command planner — field mapping", () => {
  it("mapFieldDef returns unsupported for json type", () => {
    const result = mapFieldDef({ name: "test_json", type: "json", required: false, description: "test" });
    assert.equal(result.supported, false);
    if (!result.supported) {
      assert.equal(result.fieldType, "json");
      assert.equal(result.fieldName, "test_json");
    }
  });

  it("mapFieldDef returns unsupported for multi_select type", () => {
    const result = mapFieldDef({ name: "test_multi", type: "multi_select", required: false, description: "test" });
    assert.equal(result.supported, false);
    if (!result.supported) {
      assert.equal(result.fieldType, "multi_select");
      assert.equal(result.fieldName, "test_multi");
      assert.ok(result.reason.length > 0);
    }
  });

  it("mapFieldDef for text returns string type in fieldJson", () => {
    const result = mapFieldDef({ name: "test_text", type: "text", required: false, description: "test" });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.fieldJson.type, "text");
      assert.equal(result.fieldJson.name, "test_text");
      assert.ok(!("field_name" in result.fieldJson));
      assert.ok(!("property" in result.fieldJson));
    }
  });

  it("mapFieldDef for select returns options with name only", () => {
    const result = mapFieldDef({ name: "status", type: "select", required: true, description: "test", options: ["a", "b"] });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.fieldJson.type, "select");
      assert.equal(result.fieldJson.options?.length, 2);
      assert.equal(result.fieldJson.options?.[0]?.name, "a");
      const firstOpt = result.fieldJson.options?.[0];
      const optKeys = firstOpt ? Object.keys(firstOpt) : [];
      assert.deepEqual(optKeys, ["name"], `Select option should only have "name" key, got: ${optKeys.join(", ")}`);
    }
  });

  it("mapFieldDef for date returns datetime with format style", () => {
    const result = mapFieldDef({ name: "created_at", type: "date", required: true, description: "test" });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.fieldJson.type, "datetime");
      assert.equal(result.fieldJson.name, "created_at");
      assert.equal(result.fieldJson.style?.format, "yyyy-MM-dd HH:mm");
      assert.equal(result.fieldJson.style?.type, undefined);
    }
  });

  it("mapFieldDef for checkbox returns checkbox type", () => {
    const result = mapFieldDef({ name: "is_done", type: "checkbox", required: false, description: "test" });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.fieldJson.type, "checkbox");
      assert.equal(result.fieldJson.name, "is_done");
      assert.equal(result.fieldJson.style, undefined);
    }
  });

  it("mapFieldDef for url returns text with url style", () => {
    const result = mapFieldDef({ name: "link", type: "url", required: false, description: "test" });
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.fieldJson.type, "text");
      assert.equal(result.fieldJson.name, "link");
      assert.equal(result.fieldJson.style?.type, "url");
    }
  });

  it("mapFieldDef for link with valid linkTo returns link with display name", () => {
    const sourceTable = ALL_TABLES.find((t) => t.tableName === "candidates")!;
    const result = mapFieldDef(
      { name: "job", type: "link", required: true, description: "test", linkTo: "jobs" },
      { sourceTable },
    );
    assert.equal(result.supported, true);
    if (result.supported) {
      assert.equal(result.fieldJson.type, "link");
      assert.equal(result.fieldJson.name, "job");
      assert.equal(result.fieldJson.link_table, "Jobs");
      assert.equal(result.fieldJson.bidirectional, true);
      assert.equal(result.fieldJson.bidirectional_link_field_name, "Candidates");
    }
  });

  it("mapFieldDef for link without linkTo returns unsupported", () => {
    const result = mapFieldDef({ name: "bad_link", type: "link", required: false, description: "test" });
    assert.equal(result.supported, false);
    if (!result.supported) {
      assert.equal(result.fieldType, "link");
      assert.ok(result.reason.includes("linkTo"));
    }
  });

  it("mapFieldDef for link with unknown linkTo returns unsupported", () => {
    const sourceTable = ALL_TABLES[0]!;
    const result = mapFieldDef(
      { name: "bad_link", type: "link", required: false, description: "test", linkTo: "nonexistent" },
      { sourceTable },
    );
    assert.equal(result.supported, false);
    if (!result.supported) {
      assert.ok(result.reason.includes("unknown table"));
    }
  });

  it("mapFieldDef for link without context returns unsupported", () => {
    const result = mapFieldDef({ name: "test_link", type: "link", required: false, description: "test", linkTo: "jobs" });
    assert.equal(result.supported, false);
    if (!result.supported) {
      assert.ok(result.reason.includes("source table context"));
    }
  });

  it("all generated field JSONs use string type, not numeric", () => {
    const plan = generateSetupPlan();
    const fieldCmds = plan.commands.filter((c) => c.description.includes("Create field"));
    for (const cmd of fieldCmds) {
      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      assert.ok(jsonArg, `Missing JSON for: ${cmd.description}`);
      const fieldJson = JSON.parse(jsonArg!);
      assert.equal(typeof fieldJson.type, "string", `Field type should be string, got ${typeof fieldJson.type} in: ${cmd.description}`);
      assert.ok(!("field_name" in fieldJson), `Should not have field_name: ${cmd.description}`);
      assert.ok(!("property" in fieldJson), `Should not have property: ${cmd.description}`);
    }
  });

  it("link_table in generated JSON uses display names", () => {
    const plan = generateSetupPlan();
    const linkCmds = plan.commands.filter((c) => {
      const jsonIdx = c.args.indexOf("--json");
      if (jsonIdx < 0) return false;
      const jsonArg = c.args[jsonIdx + 1];
      if (!jsonArg) return false;
      const parsed = JSON.parse(jsonArg);
      return parsed.type === "link";
    });
    for (const cmd of linkCmds) {
      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      const fieldJson = JSON.parse(jsonArg!);
      const isDisplayName = ALL_TABLES.some((t) => t.name === fieldJson.link_table);
      assert.ok(isDisplayName, `link_table "${fieldJson.link_table}" is not a display name`);
    }
  });

  it("select options in generated JSON only have name key", () => {
    const plan = generateSetupPlan();
    const selectCmds = plan.commands.filter((c) => {
      const jsonIdx = c.args.indexOf("--json");
      if (jsonIdx < 0) return false;
      const jsonArg = c.args[jsonIdx + 1];
      if (!jsonArg) return false;
      const parsed = JSON.parse(jsonArg);
      return parsed.type === "select";
    });
    for (const cmd of selectCmds) {
      const jsonIdx = cmd.args.indexOf("--json");
      const jsonArg = cmd.args[jsonIdx + 1];
      const fieldJson = JSON.parse(jsonArg!);
      for (const opt of fieldJson.options) {
        assert.deepEqual(Object.keys(opt), ["name"], `Select option should only have "name" key, got: ${Object.keys(opt).join(", ")} in: ${cmd.description}`);
      }
    }
  });
});

describe("base command planner — execute plan guard", () => {
  it("validateExecutablePlan throws on unsupported fields", () => {
    const plan = generateSetupPlan();
    // Manually inject an unsupported field to test the guard
    const badPlan = {
      ...plan,
      unsupportedFields: [{ tableName: "Jobs", fieldName: "bad", fieldType: "json", reason: "test" }],
    };
    assert.throws(
      () => validateExecutablePlan(badPlan),
      (err: unknown) => err instanceof ExecutionBlockedError,
    );
  });

  it("validateExecutablePlan does not throw when unsupported is zero", () => {
    const plan = generateSetupPlan();
    assert.equal(plan.unsupportedFields.length, 0);
    assert.doesNotThrow(() => validateExecutablePlan(plan));
  });

  it("runPlan with execute=true and unsupported fields returns blocked", () => {
    const plan = generateSetupPlan();
    const badPlan = {
      ...plan,
      unsupportedFields: [{ tableName: "Jobs", fieldName: "bad", fieldType: "json", reason: "test" }],
    };
    const config = loadConfig({
      HIRELOOP_ALLOW_LARK_WRITE: "1",
      LARK_APP_ID: "fake",
      LARK_APP_SECRET: "fake",
      BASE_APP_TOKEN: "fake",
    });
    const result = runPlan({ plan: badPlan, config, execute: true });
    assert.equal(result.blocked, true);
    for (const r of result.results) {
      assert.equal(r.status, "skipped");
    }
  });

  it("runPlan with execute=true and zero unsupported still blocks without config", () => {
    const plan = generateSetupPlan();
    assert.equal(plan.unsupportedFields.length, 0);
    const config = loadConfig({});
    const result = runPlan({ plan, config, execute: true });
    // Blocked because config is missing, not because of unsupported fields
    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, true);
    for (const r of result.results) {
      assert.equal(r.status, "skipped");
    }
  });
});

describe("base plan runner — dry-run and execution guards", () => {
  it("dry-run returns all commands as planned", () => {
    const plan = generateSetupPlan();
    const config = loadConfig({});
    const result = runPlan({ plan, config, execute: false });

    assert.equal(result.mode, "dry_run");
    assert.equal(result.results.length, plan.commands.length);
    assert.equal(result.blocked, false);
    for (const r of result.results) {
      assert.equal(r.status, "planned");
      assert.equal(r.exitCode, null);
      assert.equal(r.stdout, null);
    }
  });

  it("execute blocked without allowLarkWrite returns skipped not planned", () => {
    const plan = generateSetupPlan();
    const config = loadConfig({});
    const result = runPlan({ plan, config, execute: true });

    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, true);
    for (const r of result.results) {
      assert.equal(r.status, "skipped", `Expected skipped but got ${r.status} for: ${r.description}`);
    }
  });

  it("execute blocked without credentials returns skipped not planned", () => {
    const plan = generateSetupPlan();
    const config = loadConfig({ HIRELOOP_ALLOW_LARK_WRITE: "1" });
    const result = runPlan({ plan, config, execute: true });

    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, true);
    for (const r of result.results) {
      assert.equal(r.status, "skipped", `Expected skipped but got ${r.status} for: ${r.description}`);
    }
  });
});
