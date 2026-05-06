import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  buildCardActionToastText,
  buildReplyText,
  parseEventKeys,
  parseMessageText,
  resolveLoggerLevel,
} from "../src/feishu/long-connection.js";

describe("feishu long connection helpers", () => {
  it("uses message event by default", () => {
    assert.deepEqual(parseEventKeys(null), ["im.message.receive_v1"]);
  });

  it("deduplicates and trims event keys", () => {
    assert.deepEqual(
      parseEventKeys(" im.message.receive_v1 , out_approval , im.message.receive_v1 "),
      ["im.message.receive_v1", "out_approval"],
    );
  });

  it("extracts text message payload", () => {
    assert.equal(parseMessageText('{ "text": "hello world" }'), "hello world");
  });

  it("returns null for invalid or non-text message payload", () => {
    assert.equal(parseMessageText("not-json"), null);
    assert.equal(parseMessageText('{ "image_key": "img_xxx" }'), null);
  });

  it("prefers configured reply text", () => {
    assert.equal(buildReplyText("hello", "收到，稍后处理"), "收到，稍后处理");
  });

  it("falls back to echo reply or default reply", () => {
    assert.equal(buildReplyText("hello", null), "已收到：hello");
    assert.equal(buildReplyText(null, null), "已收到你的消息。");
  });

  it("prefers configured card action toast or default toast", () => {
    assert.equal(buildCardActionToastText("操作已处理"), "操作已处理");
    assert.equal(buildCardActionToastText(null), "卡片交互已收到。");
  });

  it("maps logger levels with safe default", () => {
    assert.equal(resolveLoggerLevel("debug"), Lark.LoggerLevel.debug);
    assert.equal(resolveLoggerLevel("bogus"), Lark.LoggerLevel.info);
  });
});
