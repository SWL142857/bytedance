import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLiveLinkRegistry } from "../../src/server/live-link-registry.js";

describe("live-link-registry", () => {
  it("register returns opaque linkId", () => {
    const reg = createLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_abc123");
    assert.ok(linkId.startsWith("lnk_live_"));
    assert.ok(!linkId.includes("rec_abc123"), "linkId must not contain recordId");
    assert.ok(!linkId.includes("candidates"), "linkId must not contain table name");
  });

  it("resolve returns entry with table and recordId", () => {
    const reg = createLiveLinkRegistry();
    const linkId = reg.register("jobs", "rec_job_001");
    const entry = reg.resolve(linkId);
    assert.ok(entry);
    assert.equal(entry.table, "jobs");
    assert.equal(entry.recordId, "rec_job_001");
  });

  it("resolve returns null for unknown linkId", () => {
    const reg = createLiveLinkRegistry();
    assert.equal(reg.resolve("lnk_live_nonexistent"), null);
  });

  it("size tracks entries", () => {
    const reg = createLiveLinkRegistry();
    assert.equal(reg.size, 0);
    reg.register("candidates", "rec_1");
    reg.register("jobs", "rec_2");
    assert.equal(reg.size, 2);
  });

  it("each register generates unique linkId", () => {
    const reg = createLiveLinkRegistry();
    const a = reg.register("candidates", "rec_1");
    const b = reg.register("candidates", "rec_2");
    assert.notEqual(a, b);
  });

  it("linkId is opaque — no table or record leaked", () => {
    const reg = createLiveLinkRegistry();
    const linkId = reg.register("candidates", "rec_secret_001");
    // The linkId itself must not expose the record or table
    assert.ok(!linkId.includes("rec_"));
    assert.ok(!linkId.includes("cand"));
    assert.ok(!linkId.includes("secret"));
    assert.ok(!linkId.includes("table"));
  });
});
