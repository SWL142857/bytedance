#!/usr/bin/env -S node --import tsx
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadConfig, validateReadOnlyConfig } from "../src/config.js";
import { getLiveBaseStatus } from "../src/server/live-base.js";

const REPO_ROOT = resolve(dirname(import.meta.dirname), "..");

const { values: args } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
  },
});

interface PreflightCheck {
  label: string;
  status: "ok" | "warn" | "missing";
  detail: string;
}

interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
  summary: string;
}

function checkEnvVars(): PreflightCheck[] {
  const vars = [
    "LARK_APP_ID",
    "LARK_APP_SECRET",
    "BASE_APP_TOKEN",
    "HIRELOOP_ALLOW_LARK_READ",
    "HIRELOOP_ALLOW_LARK_WRITE",
  ];
  return vars.map(function (v) {
    const present = !!process.env[v];
    return {
      label: v,
      status: present ? ("ok" as const) : ("missing" as const),
      detail: present ? "present" : "missing",
    };
  });
}

function checkBaseStatus(): PreflightCheck {
  try {
    const status = getLiveBaseStatus();
    if (status.readEnabled && status.blockedReasons.length === 0) {
      return { label: "飞书 Base 只读连接", status: "ok", detail: "已连接，无阻断" };
    }
    return { label: "飞书 Base 只读连接", status: "warn", detail: status.blockedReasons.join("; ") };
  } catch {
    return { label: "飞书 Base 只读连接", status: "warn", detail: "状态检查失败" };
  }
}

function checkCompetitionOverview(): PreflightCheck {
  // Static check: do the source files exist?
  const competitionRoot = process.env["HIRELOOP_COMPETITION_ROOT"];
  if (!competitionRoot) {
    return { label: "竞赛图谱数据", status: "warn", detail: "HIRELOOP_COMPETITION_ROOT 未设置" };
  }
  const artifactsDir = resolve(competitionRoot, "artifacts", "memory_graph");
  if (!existsSync(artifactsDir)) {
    return { label: "竞赛图谱数据", status: "warn", detail: `目录不存在: ${artifactsDir}` };
  }
  return { label: "竞赛图谱数据", status: "ok", detail: `目录存在: ${artifactsDir}` };
}

function checkRunbookFiles(): PreflightCheck[] {
  const files = [
    "docs/competition-delivery-runbook.md",
    "docs/morning-live-loop-checklist.md",
    "docs/demo-scorecard-script.md",
    "scripts/competition-live-loop-runbook.ts",
  ];
  return files.map(function (f) {
    const fullPath = resolve(REPO_ROOT, f);
    const present = existsSync(fullPath);
    return {
      label: f,
      status: present ? ("ok" as const) : ("missing" as const),
      detail: present ? "存在" : "不存在",
    };
  });
}

function checkConfigComplete(): PreflightCheck {
  const config = loadConfig();
  const errors = validateReadOnlyConfig(config);
  if (errors.length === 0) {
    return { label: "飞书只读配置", status: "ok", detail: "完整" };
  }
  return { label: "飞书只读配置", status: "warn", detail: errors.join("; ") };
}

function runPreflight(): PreflightResult {
  const allChecks: PreflightCheck[] = [
    ...checkEnvVars(),
    checkConfigComplete(),
    checkBaseStatus(),
    checkCompetitionOverview(),
    ...checkRunbookFiles(),
  ];

  const failed = allChecks.filter(function (c) { return c.status === "missing"; });
  const warned = allChecks.filter(function (c) { return c.status === "warn"; });
  const passed = allChecks.every(function (c) { return c.status === "ok"; });

  let summary: string;
  if (passed) {
    summary = "所有检查通过，可以开始执行闭环。";
  } else if (failed.length > 0) {
    summary = `${failed.length} 项缺失，${warned.length} 项警告。请先修复缺失项。`;
  } else {
    summary = `${warned.length} 项警告。可以尝试执行，但部分功能可能受限。`;
  }

  return { passed, checks: allChecks, summary };
}

function printText(result: PreflightResult): void {
  console.log("=== HireLoop Live Loop Preflight ===\n");
  for (const c of result.checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗";
    console.log(`  ${icon} ${c.label}: ${c.detail}`);
  }
  console.log(`\n${result.summary}`);
}

function printJson(result: PreflightResult): void {
  // Ensure no env values leak — only present/missing status
  const safe = {
    passed: result.passed,
    summary: result.summary,
    checks: result.checks.map(function (c) {
      return { label: c.label, status: c.status, detail: c.detail };
    }),
  };
  console.log(JSON.stringify(safe, null, 2));
}

function main(): void {
  const result = runPreflight();
  if (args.json) {
    printJson(result);
  } else {
    printText(result);
  }
  process.exitCode = result.passed ? 0 : 1;
}

main();
