#!/usr/bin/env -S node --import tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_SNAPSHOT_PATH = "tmp/auto-demo-loop-snapshot.json";

type SafeFetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface SafeJsonResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export interface AutoDemoLoopSnapshot {
  generatedAt: string;
  baseUrl: string;
  liveBase: {
    ready: boolean;
    readiness: string;
    readEnabled: boolean;
    writeDisabled: boolean;
    candidateCount: number;
    jobCount: number;
  };
  competition: {
    status: string;
    candidateCount: number;
    evidenceCount: number;
    roleCount: number;
  };
  workEvents: {
    count: number;
    latestSummary: string | null;
  };
  analytics: {
    status: string;
    blocked: boolean;
    commandCount: number;
    candidateCount: number;
  };
  safety: {
    frontendNoExecute: true;
    planOnly: true;
    writeExecution: false;
    writesToBase: false;
  };
}

export async function runAutoDemoLoopOnce(
  baseUrl: string,
  fetcher: SafeFetcher = fetch,
): Promise<AutoDemoLoopSnapshot> {
  const safeBaseUrl = normalizeBaseUrl(baseUrl);
  const [baseStatus, candidates, jobs, workEvents, competition] = await Promise.all([
    getJson(fetcher, `${safeBaseUrl}/api/live/base-status`),
    getJson(fetcher, `${safeBaseUrl}/api/live/records?table=candidates`),
    getJson(fetcher, `${safeBaseUrl}/api/live/records?table=jobs`),
    getJson(fetcher, `${safeBaseUrl}/api/work-events`),
    getJson(fetcher, `${safeBaseUrl}/api/competition/overview`),
  ]);
  const analytics = await postJson(fetcher, `${safeBaseUrl}/api/live/analytics/generate-report-plan`, {});

  const baseStatusData = asRecord(baseStatus.data);
  const competitionData = asRecord(competition.data);
  const eventRecords = extractRecords(workEvents.data);
  const analyticsData = asRecord(analytics.data);

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: safeBaseUrl,
    liveBase: {
      ready: baseStatus.ok && baseStatusData.readiness === "ready",
      readiness: readString(baseStatusData.readiness, baseStatus.ok ? "unknown" : "unavailable"),
      readEnabled: readBoolean(baseStatusData.readEnabled, false),
      writeDisabled: readBoolean(baseStatusData.writeDisabled, true),
      candidateCount: extractRecords(candidates.data).length,
      jobCount: extractRecords(jobs.data).length,
    },
    competition: {
      status: readString(competitionData.status, competition.ok ? "unknown" : "unavailable"),
      candidateCount: readNumber(competitionData.candidateCount, 0),
      evidenceCount: readNumber(competitionData.evidenceCount, 0),
      roleCount: readNumber(competitionData.roleCount, 0),
    },
    workEvents: {
      count: eventRecords.length,
      latestSummary: readString(asRecord(eventRecords[0]).safe_summary, null),
    },
    analytics: {
      status: readString(analyticsData.status, analytics.ok ? "unknown" : "unavailable"),
      blocked: !analytics.ok || readString(analyticsData.status, "") === "blocked",
      commandCount: extractRecords(analyticsData.commands).length,
      candidateCount: readNumber(analyticsData.candidateCount, 0),
    },
    safety: {
      frontendNoExecute: true,
      planOnly: true,
      writeExecution: false,
      writesToBase: false,
    },
  };
}

export function formatStatusLine(snapshot: AutoDemoLoopSnapshot): string {
  return [
    `[${snapshot.generatedAt}]`,
    `live=${snapshot.liveBase.ready ? "ready" : snapshot.liveBase.readiness}`,
    `base=${snapshot.liveBase.candidateCount}c/${snapshot.liveBase.jobCount}j`,
    `events=${snapshot.workEvents.count}`,
    `graph=${snapshot.competition.candidateCount}c/${snapshot.competition.evidenceCount}e/${snapshot.competition.roleCount}r`,
    `analytics=${snapshot.analytics.blocked ? "blocked" : snapshot.analytics.status}`,
    "plan-only",
  ].join(" ");
}

export function writeSafeSnapshot(path: string, snapshot: AutoDemoLoopSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function getJson(fetcher: SafeFetcher, url: string): Promise<SafeJsonResult> {
  return requestJson(fetcher, url, { method: "GET" });
}

async function postJson(fetcher: SafeFetcher, url: string, body: Record<string, unknown>): Promise<SafeJsonResult> {
  return requestJson(fetcher, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requestJson(fetcher: SafeFetcher, url: string, init: RequestInit): Promise<SafeJsonResult> {
  try {
    const res = await fetcher(url, init);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function extractRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (Array.isArray(record.records)) return record.records;
  if (Array.isArray(record.events)) return record.events;
  if (Array.isArray(record.commands)) return record.commands;
  return [];
}

function readString(value: unknown, fallback: string): string;
function readString(value: unknown, fallback: null): string | null;
function readString(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const cliArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
  const { values: args } = parseArgs({
    args: cliArgs,
    options: {
      "base-url": { type: "string", default: DEFAULT_BASE_URL },
      "interval-ms": { type: "string", default: String(DEFAULT_INTERVAL_MS) },
      "snapshot-path": { type: "string", default: DEFAULT_SNAPSHOT_PATH },
      once: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  const baseUrl = args["base-url"] || DEFAULT_BASE_URL;
  const snapshotPath = args["snapshot-path"] || DEFAULT_SNAPSHOT_PATH;
  const intervalMs = Math.max(5_000, Number(args["interval-ms"]) || DEFAULT_INTERVAL_MS);

  while (true) {
    const snapshot = await runAutoDemoLoopOnce(baseUrl);
    writeSafeSnapshot(snapshotPath, snapshot);

    if (args.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      console.log(formatStatusLine(snapshot));
      console.log(`[snapshot] ${snapshotPath}`);
    }

    if (args.once) return;
    await delay(intervalMs);
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedDirectly) {
  main().catch(() => {
    process.stderr.write("auto demo loop failed safely before any write operation\n");
    process.exit(1);
  });
}
