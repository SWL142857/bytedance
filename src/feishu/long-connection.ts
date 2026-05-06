import * as Lark from "@larksuiteoapi/node-sdk";
import type { HireLoopConfig } from "../config.js";

const DEFAULT_EVENT_KEYS = ["im.message.receive_v1"];
const DEFAULT_REPLY_TEXT = "已收到你的消息。";
const DEFAULT_CARD_ACTION_TOAST_TEXT = "卡片交互已收到。";
const MAX_PREVIEW_CHARS = 120;

type MessageEventHandler = NonNullable<Lark.EventHandles["im.message.receive_v1"]>;
type MessageEvent = Parameters<MessageEventHandler>[0];

export interface FeishuLongConnectionOptions {
  eventKeys: string[];
  enableAutoReply: boolean;
  replyText: string | null;
  cardActionToastText: string | null;
  loggerLevel: Lark.LoggerLevel;
  debug: boolean;
}

export interface FeishuLongConnectionHandle {
  close: () => void;
}

export function parseEventKeys(raw: string | null | undefined): string[] {
  if (!raw) {
    return [...DEFAULT_EVENT_KEYS];
  }

  const keys = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (keys.length === 0) {
    return [...DEFAULT_EVENT_KEYS];
  }

  return Array.from(new Set(keys));
}

export function resolveLoggerLevel(raw: string | null | undefined): Lark.LoggerLevel {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "fatal":
      return Lark.LoggerLevel.fatal;
    case "error":
      return Lark.LoggerLevel.error;
    case "warn":
      return Lark.LoggerLevel.warn;
    case "debug":
      return Lark.LoggerLevel.debug;
    case "trace":
      return Lark.LoggerLevel.trace;
    case "info":
    default:
      return Lark.LoggerLevel.info;
  }
}

export function parseMessageText(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as { text?: unknown };
    return typeof parsed.text === "string" && parsed.text.trim().length > 0
      ? parsed.text.trim()
      : null;
  } catch {
    return null;
  }
}

export function buildReplyText(messageText: string | null, configuredReplyText: string | null): string {
  const trimmedConfigured = configuredReplyText?.trim();
  if (trimmedConfigured) {
    return trimmedConfigured;
  }
  if (messageText) {
    return `已收到：${messageText}`;
  }
  return DEFAULT_REPLY_TEXT;
}

export function buildCardActionToastText(configuredToastText: string | null): string {
  const trimmedConfigured = configuredToastText?.trim();
  if (trimmedConfigured) {
    return trimmedConfigured;
  }
  return DEFAULT_CARD_ACTION_TOAST_TEXT;
}

export function getMissingLongConnectionConfig(config: HireLoopConfig): string[] {
  const missing: string[] = [];
  if (!config.larkAppId) {
    missing.push("LARK_APP_ID");
  }
  if (!config.larkAppSecret) {
    missing.push("LARK_APP_SECRET");
  }
  return missing;
}

export async function startFeishuLongConnection(
  config: HireLoopConfig,
  options: FeishuLongConnectionOptions,
): Promise<FeishuLongConnectionHandle> {
  const missing = getMissingLongConnectionConfig(config);
  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }

  const clientConfig = {
    appId: config.larkAppId!,
    appSecret: config.larkAppSecret!,
    loggerLevel: options.loggerLevel,
    source: "hireloop-long-connection",
  };

  const client = new Lark.Client(clientConfig);
  const eventDispatcher = buildEventDispatcher(client, options);
  const wsClient = new Lark.WSClient({
    ...clientConfig,
    onReady: () => {
      console.log(
        `[feishu-ws] connected autoReply=${options.enableAutoReply ? "on" : "off"} events=${options.eventKeys.join(",")}`,
      );
    },
    onError: (err) => {
      console.error(`[feishu-ws] connect failed: ${err.message}`);
    },
    onReconnecting: () => {
      console.log("[feishu-ws] reconnecting");
    },
    onReconnected: () => {
      console.log("[feishu-ws] reconnected");
    },
  });

  await wsClient.start({ eventDispatcher });

  return {
    close: () => {
      wsClient.close();
    },
  };
}

function buildEventDispatcher(client: Lark.Client, options: FeishuLongConnectionOptions): Lark.EventDispatcher {
  const handlers: Record<string, (data: unknown) => Promise<unknown>> = {};

  for (const eventKey of options.eventKeys) {
    if (eventKey === "im.message.receive_v1") {
      handlers[eventKey] = async (data: unknown) => {
        await handleMessageEvent(client, options, data as MessageEvent);
      };
      continue;
    }

    if (eventKey === "card.action.trigger") {
      handlers[eventKey] = async (data: unknown) => {
        return handleCardActionCallback(options, data);
      };
      continue;
    }

    handlers[eventKey] = async (data: unknown) => {
      logGenericEvent(eventKey, data, options.debug);
    };
  }

  return new Lark.EventDispatcher({ loggerLevel: options.loggerLevel }).register(handlers);
}

async function handleMessageEvent(
  client: Lark.Client,
  options: FeishuLongConnectionOptions,
  data: MessageEvent,
): Promise<void> {
  const messageText = parseMessageText(data.message.content);
  const preview = previewText(messageText ?? `[${data.message.message_type}]`);
  const senderType = data.sender.sender_type.toLowerCase();

  console.log(
    `[feishu-ws] message chat=${data.message.chat_id} type=${data.message.message_type} sender=${senderType} preview=${preview}`,
  );

  if (options.debug) {
    console.log(JSON.stringify(data, null, 2));
  }

  if (!options.enableAutoReply) {
    return;
  }

  if (senderType !== "user") {
    console.log(`[feishu-ws] skip auto reply for sender_type=${senderType}`);
    return;
  }

  const replyText = buildReplyText(messageText, options.replyText);
  await client.im.v1.message.create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: data.message.chat_id,
      content: JSON.stringify({ text: replyText }),
      msg_type: "text",
    },
  });

  console.log(`[feishu-ws] replied chat=${data.message.chat_id} text=${previewText(replyText)}`);
}

function handleCardActionCallback(
  options: FeishuLongConnectionOptions,
  data: unknown,
): {
  toast: {
    type: "info";
    content: string;
    i18n: {
      zh_cn: string;
      en_us: string;
    };
  };
} {
  const chatId = getOptionalStringFromPath(data, ["context", "open_chat_id"])
    ?? getOptionalString(data, "open_chat_id")
    ?? "unknown";
  const messageId = getOptionalStringFromPath(data, ["context", "open_message_id"])
    ?? getOptionalString(data, "open_message_id")
    ?? "unknown";
  const operatorName = getOptionalStringFromPath(data, ["operator", "name"])
    ?? getOptionalStringFromPath(data, ["operator", "open_id"])
    ?? "unknown";
  const actionTag = getOptionalStringFromPath(data, ["action", "tag"]) ?? "unknown";
  const actionName = getOptionalStringFromPath(data, ["action", "name"]);
  const actionOption = getOptionalStringFromPath(data, ["action", "option"]);
  const actionValue = getUnknownFromPath(data, ["action", "value"]);
  const toastText = buildCardActionToastText(options.cardActionToastText);
  const actionSummary = [
    `tag=${actionTag}`,
    actionName ? `name=${actionName}` : null,
    actionOption ? `option=${actionOption}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

  console.log(
    `[feishu-ws] card action chat=${chatId} message=${messageId} operator=${operatorName} ${actionSummary}`,
  );

  if (actionValue !== null) {
    console.log(`[feishu-ws] card action value=${previewText(safeJsonStringify(actionValue))}`);
  }

  if (options.debug) {
    console.log(JSON.stringify(data, null, 2));
  }

  return {
    toast: {
      type: "info",
      content: toastText,
      i18n: {
        zh_cn: toastText,
        en_us: "Card action received",
      },
    },
  };
}

function logGenericEvent(eventKey: string, data: unknown, debug: boolean): void {
  const eventId = getOptionalString(data, "event_id") ?? getOptionalString(data, "uuid") ?? "unknown";
  const eventType = getOptionalString(data, "event_type") ?? eventKey;
  console.log(`[feishu-ws] event key=${eventKey} type=${eventType} id=${eventId}`);

  if (debug) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function getOptionalString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function getOptionalStringFromPath(value: unknown, path: string[]): string | null {
  const candidate = getUnknownFromPath(value, path);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function getUnknownFromPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function previewText(value: string): string {
  return value.length <= MAX_PREVIEW_CHARS ? value : `${value.slice(0, MAX_PREVIEW_CHARS)}...`;
}
