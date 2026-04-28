import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateExecutionConfig, validateReadOnlyConfig, redactConfig } from "../src/config.js";
import type { HireLoopConfig } from "../src/config.js";

describe("config — dry-run does not require secrets", () => {
  it("loads config with all empty env vars", () => {
    const config = loadConfig({});
    assert.equal(config.larkAppId, null);
    assert.equal(config.larkAppSecret, null);
    assert.equal(config.baseAppToken, null);
    assert.equal(config.modelApiKey, null);
    assert.equal(config.modelApiEndpoint, null);
    assert.equal(config.modelId, null);
    assert.equal(config.modelProvider, "volcengine-ark");
    assert.equal(config.allowLarkWrite, false);
    assert.equal(config.debug, false);
  });

  it("loads provider API config without requiring it for dry-run", () => {
    const config = loadConfig({
      MODEL_API_ENDPOINT: "https://api.example.com/v1",
      MODEL_ID: "model-or-endpoint-id",
      MODEL_API_KEY: "sk-test",
    });
    assert.equal(config.modelApiEndpoint, "https://api.example.com/v1");
    assert.equal(config.modelId, "model-or-endpoint-id");
    assert.equal(config.modelApiKey, "sk-test");
    assert.equal(config.allowLarkWrite, false);
  });

  it("loads config with debug enabled", () => {
    const config = loadConfig({ DEBUG: "true" });
    assert.equal(config.debug, true);
  });

  it("loads config with debug=1", () => {
    const config = loadConfig({ DEBUG: "1" });
    assert.equal(config.debug, true);
  });

  it("loads config with allowLarkWrite=1", () => {
    const config = loadConfig({ HIRELOOP_ALLOW_LARK_WRITE: "1" });
    assert.equal(config.allowLarkWrite, true);
  });

  it("loads config with allowLarkRead=1", () => {
    const config = loadConfig({ HIRELOOP_ALLOW_LARK_READ: "1" });
    assert.equal(config.allowLarkRead, true);
    assert.equal(config.allowLarkWrite, false);
  });

  it("loads optional table-specific Feishu web URLs", () => {
    const config = loadConfig({
      FEISHU_BASE_WEB_URL: "https://example.feishu.cn/base/main",
      FEISHU_CANDIDATES_WEB_URL: "https://example.feishu.cn/base/candidates",
      FEISHU_JOBS_WEB_URL: "https://example.feishu.cn/base/jobs",
      FEISHU_WORK_EVENTS_WEB_URL: "https://example.feishu.cn/base/work-events",
    });
    assert.equal(config.feishuBaseWebUrl, "https://example.feishu.cn/base/main");
    assert.equal(config.feishuTableWebUrls?.candidates, "https://example.feishu.cn/base/candidates");
    assert.equal(config.feishuTableWebUrls?.jobs, "https://example.feishu.cn/base/jobs");
    assert.equal(config.feishuTableWebUrls?.work_events, "https://example.feishu.cn/base/work-events");
  });

  it("allowLarkWrite is false for any non-1 value", () => {
    const config = loadConfig({ HIRELOOP_ALLOW_LARK_WRITE: "yes" });
    assert.equal(config.allowLarkWrite, false);
  });
});

describe("config — read-only mode validation", () => {
  it("fails when read-only flag is missing even if write flag is set", () => {
    const config = loadConfig({
      LARK_APP_ID: "test_id",
      LARK_APP_SECRET: "test_secret",
      BASE_APP_TOKEN: "test_token",
      HIRELOOP_ALLOW_LARK_WRITE: "1",
    });
    const errors = validateReadOnlyConfig(config);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.field, "HIRELOOP_ALLOW_LARK_READ");
  });

  it("passes when credentials and allowLarkRead are present", () => {
    const config = loadConfig({
      LARK_APP_ID: "test_id",
      LARK_APP_SECRET: "test_secret",
      BASE_APP_TOKEN: "test_token",
      HIRELOOP_ALLOW_LARK_READ: "1",
    });
    assert.deepEqual(validateReadOnlyConfig(config), []);
  });
});

describe("config — execute mode validation", () => {
  it("fails when all required fields are missing", () => {
    const config = loadConfig({});
    const errors = validateExecutionConfig(config);
    assert.ok(errors.length >= 3);
    const fields = errors.map((e) => e.field);
    assert.ok(fields.includes("LARK_APP_ID"));
    assert.ok(fields.includes("LARK_APP_SECRET"));
    assert.ok(fields.includes("BASE_APP_TOKEN"));
    assert.ok(fields.includes("HIRELOOP_ALLOW_LARK_WRITE"));
  });

  it("fails when only allowLarkWrite is missing", () => {
    const config = loadConfig({
      LARK_APP_ID: "test_id",
      LARK_APP_SECRET: "test_secret",
      BASE_APP_TOKEN: "test_token",
    });
    const errors = validateExecutionConfig(config);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.field, "HIRELOOP_ALLOW_LARK_WRITE");
  });

  it("fails when allowLarkWrite is set but credentials are missing", () => {
    const config = loadConfig({
      HIRELOOP_ALLOW_LARK_WRITE: "1",
    });
    const errors = validateExecutionConfig(config);
    assert.ok(errors.length >= 3);
    const fields = errors.map((e) => e.field);
    assert.ok(fields.includes("LARK_APP_ID"));
    assert.ok(fields.includes("LARK_APP_SECRET"));
    assert.ok(fields.includes("BASE_APP_TOKEN"));
  });

  it("passes when all required fields are present and allowLarkWrite is 1", () => {
    const config = loadConfig({
      LARK_APP_ID: "cli_test_id",
      LARK_APP_SECRET: "cli_test_secret",
      BASE_APP_TOKEN: "cli_test_token",
      HIRELOOP_ALLOW_LARK_WRITE: "1",
    });
    const errors = validateExecutionConfig(config);
    assert.equal(errors.length, 0);
  });
});

describe("config — redactConfig does not leak secrets", () => {
  const fullConfig: HireLoopConfig = {
    larkAppId: "app_id_12345",
    larkAppSecret: "secret_abcdef",
    baseAppToken: "token_xyz789",
    feishuBaseWebUrl: null,
    modelApiKey: "sk-abc123def456",
    modelApiEndpoint: "https://api.example.com/v1",
    modelId: "model-or-endpoint-id",
    modelProvider: "volcengine-ark",
    allowLarkRead: false,
    allowLarkWrite: true,
    debug: false,
  };

  it("redacts larkAppId", () => {
    const redacted = redactConfig(fullConfig);
    assert.ok(!redacted.larkAppId!.includes("app_id_12345"));
    assert.ok(redacted.larkAppId!.includes("****"));
  });

  it("redacts larkAppSecret", () => {
    const redacted = redactConfig(fullConfig);
    assert.ok(!redacted.larkAppSecret!.includes("secret_abcdef"));
    assert.ok(redacted.larkAppSecret!.includes("****"));
  });

  it("redacts baseAppToken", () => {
    const redacted = redactConfig(fullConfig);
    assert.ok(!redacted.baseAppToken!.includes("token_xyz789"));
    assert.ok(redacted.baseAppToken!.includes("****"));
  });

  it("redacts modelApiKey", () => {
    const redacted = redactConfig(fullConfig);
    assert.ok(!redacted.modelApiKey!.includes("sk-abc123def456"));
    assert.ok(redacted.modelApiKey!.includes("****"));
  });

  it("redacts modelApiEndpoint", () => {
    const redacted = redactConfig(fullConfig);
    assert.ok(!redacted.modelApiEndpoint!.includes("https://api.example.com/v1"));
    assert.ok(redacted.modelApiEndpoint!.includes("****"));
  });

  it("redacts modelId", () => {
    const redacted = redactConfig(fullConfig);
    assert.ok(!redacted.modelId!.includes("model-or-endpoint-id"));
    assert.ok(redacted.modelId!.includes("****"));
  });

  it("preserves allowLarkWrite and debug", () => {
    const redacted = redactConfig(fullConfig);
    assert.equal(redacted.allowLarkWrite, true);
    assert.equal(redacted.debug, false);
  });

  it("preserves modelProvider", () => {
    const redacted = redactConfig(fullConfig);
    assert.equal(redacted.modelProvider, "volcengine-ark");
  });

  it("handles null values", () => {
    const nullConfig: HireLoopConfig = {
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
    };
    const redacted = redactConfig(nullConfig);
    assert.equal(redacted.larkAppId, null);
    assert.equal(redacted.larkAppSecret, null);
    assert.equal(redacted.baseAppToken, null);
    assert.equal(redacted.modelApiKey, null);
    assert.equal(redacted.modelApiEndpoint, null);
    assert.equal(redacted.modelId, null);
  });

  it("redacts short values fully", () => {
    const shortConfig: HireLoopConfig = {
      ...fullConfig,
      larkAppSecret: "ab",
    };
    const redacted = redactConfig(shortConfig);
    assert.equal(redacted.larkAppSecret, "****");
  });
});
