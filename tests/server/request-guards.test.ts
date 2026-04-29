import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLoopbackAddress } from "../../src/server/request-guards.js";

describe("request-guards — isLoopbackAddress", () => {
  it("accepts IPv4 loopback", () => {
    assert.ok(isLoopbackAddress("127.0.0.1"));
  });

  it("accepts IPv6 loopback", () => {
    assert.ok(isLoopbackAddress("::1"));
  });

  it("accepts IPv4-mapped IPv6 loopback", () => {
    assert.ok(isLoopbackAddress("::ffff:127.0.0.1"));
  });

  it("rejects non-loopback IPv4", () => {
    assert.equal(isLoopbackAddress("192.168.1.1"), false);
  });

  it("rejects non-loopback IPv6", () => {
    assert.equal(isLoopbackAddress("fe80::1"), false);
  });

  it("rejects undefined address", () => {
    assert.equal(isLoopbackAddress(undefined), false);
  });

  it("rejects empty string", () => {
    assert.equal(isLoopbackAddress(""), false);
  });
});
