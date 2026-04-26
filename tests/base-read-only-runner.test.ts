import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertReadOnlyCommands,
  runReadOnlyCommands,
  ReadOnlyExecutionBlockedError,
  type CommandExecutor,
  type CommandResult,
} from "../src/base/read-only-runner.js";
import type { BaseCommandSpec } from "../src/base/commands.js";
import { listRecords, upsertRecord } from "../src/base/runtime.js";
import { loadConfig } from "../src/config.js";

function makeWriteCommand(description: string): BaseCommandSpec {
  return {
    description,
    command: "lark-cli",
    args: ["base", "+record-upsert", "--base-token", "tok", "--table-id", "Jobs", "--json", "{}"],
    redactedArgs: [],
    needsBaseToken: true,
    writesRemote: true,
  };
}

// --- assertReadOnlyCommands ---

describe("assertReadOnlyCommands — allows read-only commands", () => {
  it("allows listRecords command", () => {
    const cmd = listRecords("jobs");
    assert.doesNotThrow(() => assertReadOnlyCommands([cmd]));
  });

  it("allows multiple list commands", () => {
    const cmds = [listRecords("jobs"), listRecords("candidates")];
    assert.doesNotThrow(() => assertReadOnlyCommands(cmds));
  });
});

describe("assertReadOnlyCommands — rejects write commands", () => {
  it("rejects upsertRecord command", () => {
    const cmd = upsertRecord("jobs", { job_id: "j1", status: "open" });
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects +record-upsert in args even if writesRemote=false", () => {
    const cmd: BaseCommandSpec = {
      description: "Sneaky write",
      command: "lark-cli",
      args: ["base", "+record-upsert", "--base-token", "tok"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects +table-create in args", () => {
    const cmd: BaseCommandSpec = {
      description: "Create table",
      command: "lark-cli",
      args: ["base", "+table-create", "--base-token", "tok"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects +field-create in args", () => {
    const cmd: BaseCommandSpec = {
      description: "Create field",
      command: "lark-cli",
      args: ["base", "+field-create", "--base-token", "tok"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects unknown base shortcuts even when writesRemote=false", () => {
    const cmd: BaseCommandSpec = {
      description: "Unknown mutating shortcut",
      command: "lark-cli",
      args: ["base", "+record-archive", "--base-token", "tok"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects non-lark-cli commands even when writesRemote=false", () => {
    const cmd: BaseCommandSpec = {
      description: "Shell command",
      command: "sh",
      args: ["-c", "echo ok"],
      redactedArgs: [],
      needsBaseToken: false,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects record-list commands with hardcoded base tokens", () => {
    const cmd: BaseCommandSpec = {
      description: "Hardcoded token read",
      command: "lark-cli",
      args: ["base", "+record-list", "--base-token", "app_secret_token", "--table-id", "Jobs"],
      redactedArgs: [],
      needsBaseToken: false,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("rejects record-list commands missing the base token placeholder", () => {
    const cmd: BaseCommandSpec = {
      description: "Missing token placeholder",
      command: "lark-cli",
      args: ["base", "+record-list", "--table-id", "Jobs"],
      redactedArgs: [],
      needsBaseToken: true,
      writesRemote: false,
    };
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("error lists blocked command descriptions", () => {
    const cmd = upsertRecord("jobs", { job_id: "j1", status: "open" });
    assert.throws(
      () => assertReadOnlyCommands([cmd]),
      (err: unknown) => {
        assert.ok(err instanceof ReadOnlyExecutionBlockedError);
        assert.equal(err.blockedCommands.length, 1);
        return true;
      },
    );
  });
});

// --- runReadOnlyCommands ---

describe("runReadOnlyCommands — dry-run", () => {
  it("returns planned results in dry-run mode", () => {
    const cmd = listRecords("jobs");
    const result = runReadOnlyCommands({
      commands: [cmd],
      config: loadConfig({}),
      execute: false,
    });
    assert.equal(result.mode, "dry_run");
    assert.equal(result.blocked, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]!.status, "planned");
  });

  it("does not require config for an empty execute run", () => {
    const result = runReadOnlyCommands({
      commands: [],
      config: loadConfig({}),
      execute: true,
    });
    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, false);
    assert.deepEqual(result.results, []);
  });
});

describe("runReadOnlyCommands — execute blocked", () => {
  it("blocked when write command is mixed in", () => {
    assert.throws(
      () => runReadOnlyCommands({
        commands: [listRecords("jobs"), makeWriteCommand("write")],
        config: loadConfig({}),
        execute: true,
      }),
      (err: unknown) => err instanceof ReadOnlyExecutionBlockedError,
    );
  });

  it("blocked when config is empty", () => {
    const result = runReadOnlyCommands({
      commands: [listRecords("jobs")],
      config: loadConfig({}),
      execute: true,
    });
    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, true);
    assert.equal(result.results[0]!.status, "skipped");
  });

  it("blocked when allowLarkWrite is false", () => {
    const result = runReadOnlyCommands({
      commands: [listRecords("jobs")],
      config: loadConfig({
        LARK_APP_ID: "fake",
        LARK_APP_SECRET: "fake",
        BASE_APP_TOKEN: "fake",
      }),
      execute: true,
    });
    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, true);
    assert.equal(result.results[0]!.status, "skipped");
  });

  it("blocked result does not leak raw tokens", () => {
    const result = runReadOnlyCommands({
      commands: [listRecords("jobs")],
      config: loadConfig({
        LARK_APP_ID: "secret_id_123",
        LARK_APP_SECRET: "secret_secret_456",
        BASE_APP_TOKEN: "secret_token_789",
      }),
      execute: true,
    });
    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, true);
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes("secret_id_123"), "Must not leak LARK_APP_ID");
    assert.ok(!resultStr.includes("secret_secret_456"), "Must not leak LARK_APP_SECRET");
    assert.ok(!resultStr.includes("secret_token_789"), "Must not leak BASE_APP_TOKEN");
  });
});

describe("runReadOnlyCommands — custom executor", () => {
  it("uses injected executor when provided", () => {
    const fakeExecutor: CommandExecutor = (
      _command: string,
      _args: string[],
    ): CommandResult => ({
      description: "faked",
      status: "success",
      stdout: JSON.stringify({
        items: [{ record_id: "rec001", fields: { job_id: "j1" } }],
        total: 1,
        has_more: false,
      }),
      stderr: null,
      exitCode: 0,
      durationMs: 1,
    });

    const result = runReadOnlyCommands({
      commands: [listRecords("jobs")],
      config: loadConfig({
        LARK_APP_ID: "fake",
        LARK_APP_SECRET: "fake",
        BASE_APP_TOKEN: "fake",
        HIRELOOP_ALLOW_LARK_WRITE: "1",
      }),
      execute: true,
      executor: fakeExecutor,
    });

    assert.equal(result.mode, "execute");
    assert.equal(result.blocked, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]!.status, "success");
    assert.equal(result.results[0]!.description, listRecords("jobs").description);
    assert.ok(result.results[0]!.stdout !== null);
  });

  it("stops on first failed command", () => {
    const failExecutor: CommandExecutor = (): CommandResult => ({
      description: "failed",
      status: "failed",
      stdout: null,
      stderr: "some error",
      exitCode: 1,
      durationMs: 1,
    });

    const result = runReadOnlyCommands({
      commands: [listRecords("jobs"), listRecords("candidates")],
      config: loadConfig({
        LARK_APP_ID: "fake",
        LARK_APP_SECRET: "fake",
        BASE_APP_TOKEN: "fake",
        HIRELOOP_ALLOW_LARK_WRITE: "1",
      }),
      execute: true,
      executor: failExecutor,
    });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]!.status, "failed");
  });

  it("redacts configured secrets from executor stderr", () => {
    const token = "fake-token-secret";
    const failExecutor: CommandExecutor = (): CommandResult => ({
      description: "failed",
      status: "failed",
      stdout: null,
      stderr: `command failed with token ${token}`,
      exitCode: 1,
      durationMs: 1,
    });

    const result = runReadOnlyCommands({
      commands: [listRecords("jobs")],
      config: loadConfig({
        LARK_APP_ID: "fake",
        LARK_APP_SECRET: "fake",
        BASE_APP_TOKEN: token,
        HIRELOOP_ALLOW_LARK_WRITE: "1",
      }),
      execute: true,
      executor: failExecutor,
    });

    assert.equal(result.results[0]!.status, "failed");
    assert.ok(!result.results[0]!.stderr?.includes(token));
    assert.ok(result.results[0]!.stderr?.includes("<REDACTED>"));
  });
});

describe("runReadOnlyCommands — does not process.exit", () => {
  it("returns structured result instead of exiting", () => {
    const result = runReadOnlyCommands({
      commands: [listRecords("jobs")],
      config: loadConfig({}),
      execute: true,
    });
    assert.ok(typeof result.blocked === "boolean");
    assert.ok(Array.isArray(result.results));
  });
});
