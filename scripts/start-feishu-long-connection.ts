import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import {
  getMissingLongConnectionConfig,
  parseEventKeys,
  resolveLoggerLevel,
  startFeishuLongConnection,
} from "../src/feishu/long-connection.js";

loadLocalEnvFiles();

interface CliOptions {
  eventKeys: string[] | null;
  enableAutoReply: boolean;
  replyText: string | null;
  cardActionToastText: string | null;
  logLevel: string | null;
}

function loadLocalEnvFiles(): void {
  const repoRoot = resolve(dirname(import.meta.dirname));
  const envPaths = [resolve(repoRoot, ".env.local"), resolve(repoRoot, ".env")];
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  const rawEvents = args.find((arg) => arg.startsWith("--events="))?.slice("--events=".length) ?? null;
  const rawReplyText = args.find((arg) => arg.startsWith("--reply-text="))?.slice("--reply-text=".length) ?? null;
  const rawCardActionToastText = args.find((arg) => arg.startsWith("--card-toast-text="))?.slice("--card-toast-text=".length) ?? null;
  const rawLogLevel = args.find((arg) => arg.startsWith("--log-level="))?.slice("--log-level=".length) ?? null;

  return {
    eventKeys: rawEvents ? parseEventKeys(rawEvents) : null,
    enableAutoReply: args.includes("--reply"),
    replyText: rawReplyText,
    cardActionToastText: rawCardActionToastText,
    logLevel: rawLogLevel,
  };
}

function printHeader(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const eventKeys = args.eventKeys ?? parseEventKeys(process.env["FEISHU_EVENT_KEYS"]);
  const enableAutoReply = args.enableAutoReply || process.env["FEISHU_BOT_AUTO_REPLY"] === "1";
  const replyText = args.replyText ?? process.env["FEISHU_BOT_REPLY_TEXT"] ?? null;
  const cardActionToastText = args.cardActionToastText ?? process.env["FEISHU_CARD_ACTION_TOAST_TEXT"] ?? null;
  const loggerLevel = resolveLoggerLevel(
    args.logLevel ?? process.env["FEISHU_LOG_LEVEL"] ?? (config.debug ? "debug" : "info"),
  );
  const missing = getMissingLongConnectionConfig(config);

  console.log("=== Feishu Long Connection ===");
  printHeader("Event Keys", eventKeys.join(", "));
  printHeader("Auto Reply", enableAutoReply);
  printHeader("Reply Text Override", replyText ? "configured" : "default");
  printHeader("Card Toast Override", cardActionToastText ? "configured" : "default");
  printHeader("Log Level", LarkLoggerLevelName[loggerLevel] ?? "info");
  printHeader("Debug Payload", config.debug);
  console.log("");

  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    console.error("Set them in /data/bytedance/.env.local or export them before running.");
    process.exitCode = 1;
    return;
  }

  const handle = await startFeishuLongConnection(config, {
    eventKeys,
      enableAutoReply,
      replyText,
      cardActionToastText,
      loggerLevel,
      debug: config.debug,
    });

  const shutdown = (signal: string) => {
    console.log("");
    console.log(`Received ${signal}, closing Feishu long connection...`);
    handle.close();
    setTimeout(() => {
      process.exit(0);
    }, 100).unref();
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  console.log("Listening for Feishu events. Keep this process running.");
}

const LarkLoggerLevelName: Record<number, string> = {
  0: "fatal",
  1: "error",
  2: "warn",
  3: "info",
  4: "debug",
  5: "trace",
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
