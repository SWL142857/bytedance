#!/usr/bin/env -S node --import tsx
import { parseArgs } from "node:util";
import { loadConfig, validateReadOnlyConfig } from "../src/config.js";
import { getLiveBaseStatus } from "../src/server/live-base.js";

const COMPETITION_LOOP_CONFIRM = "COMPETITION_LOOP_RUNBOOK_CHECK";

const { values: args } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
    confirm: { type: "string", default: "" },
    json: { type: "boolean", default: false },
  },
});

const EXECUTE_MODE = args.execute === true;
const CONFIRM_PHRASE = args.confirm || "";

if (EXECUTE_MODE && CONFIRM_PHRASE !== COMPETITION_LOOP_CONFIRM) {
  process.stderr.write("确认短语错误。如需执行检查步骤，请添加 --confirm=COMPETITION_LOOP_RUNBOOK_CHECK\n");
  process.exit(1);
}

interface LoopStep {
  order: number;
  name: string;
  agent: string;
  mode: "dry_run" | "plan" | "execute_guarded";
  baseTablesIn: string[];
  baseTablesOut: string[];
  command: string;
  successCriteria: string;
  requiresHumanConfirm: boolean;
}

interface LoopRunbook {
  title: string;
  agents: Array<{ name: string; key: string; role: string; writableTables: string[] }>;
  tables: Array<{ name: string; purpose: string }>;
  steps: LoopStep[];
  safety: {
    readsOnly: boolean;
    writesGuarded: boolean;
    frontendNoExecute: boolean;
    planNonceRequired: boolean;
  };
}

function buildRunbook(): LoopRunbook {
  return {
    title: "HireLoop Competition Closed-Loop Runbook",
    agents: [
      { name: "HR 协调", key: "hr_coordinator", role: "流程协调、任务分配、状态更新", writableTables: ["Candidates", "Agent Runs"] },
      { name: "简历录入", key: "resume_intake", role: "原始简历入库、输入打包", writableTables: ["Candidates", "Agent Runs"] },
      { name: "信息抽取", key: "resume_extraction", role: "简历结构化事实抽取", writableTables: ["Resume Facts", "Candidates", "Agent Runs"] },
      { name: "图谱构建", key: "graph_builder", role: "候选人图谱信号、相似关系", writableTables: ["Agent Runs"] },
      { name: "图谱复核", key: "screening_reviewer", role: "融合图谱信号做复核建议", writableTables: ["Evaluations", "Candidates", "Agent Runs"] },
      { name: "面试准备", key: "interview_kit", role: "生成面试问题、评分表", writableTables: ["Interview Kits", "Candidates", "Agent Runs"] },
      { name: "数据分析", key: "analytics", role: "漏斗统计、周报、阻塞点分析", writableTables: ["Reports", "Agent Runs"] },
    ],
    tables: [
      { name: "Jobs", purpose: "岗位定义、要求、评分标准" },
      { name: "Candidates", purpose: "候选人记录与状态跟踪" },
      { name: "Resume Facts", purpose: "简历结构化事实" },
      { name: "Evaluations", purpose: "筛选评估结果" },
      { name: "Interview Kits", purpose: "面试准备材料" },
      { name: "Agent Runs", purpose: "Agent 审计日志" },
      { name: "Work Events", purpose: "Agent 工具调用与流程事件" },
      { name: "Reports", purpose: "招聘周报与分析" },
    ],
    steps: [
      {
        order: 1, name: "环境与飞书凭据配置", agent: "操作员",
        mode: "dry_run", baseTablesIn: [], baseTablesOut: [],
        command: "export LARK_APP_ID=... LARK_APP_SECRET=... BASE_APP_TOKEN=... HIRELOOP_ALLOW_LARK_READ=1",
        successCriteria: "飞书凭据已配置，lark-cli 可用", requiresHumanConfirm: false,
      },
      {
        order: 2, name: "Base Bootstrap Dry-Run", agent: "操作员",
        mode: "dry_run", baseTablesIn: [], baseTablesOut: [],
        command: "pnpm base:bootstrap:dry-run",
        successCriteria: "显示 8 表建表计划 + seed 命令，Unsupported fields: 0", requiresHumanConfirm: false,
      },
      {
        order: 3, name: "Base Bootstrap Execute", agent: "操作员",
        mode: "execute_guarded", baseTablesIn: [], baseTablesOut: ["Jobs", "Candidates", "Agent Runs"],
        command: "export HIRELOOP_ALLOW_LARK_WRITE=1 && pnpm base:bootstrap:execute",
        successCriteria: "8 张表 + Demo Job + Demo Candidate 写入成功", requiresHumanConfirm: true,
      },
      {
        order: 4, name: "启动本地 UI 控制台", agent: "操作员",
        mode: "dry_run", baseTablesIn: [], baseTablesOut: [],
        command: "pnpm ui:dev",
        successCriteria: "http://localhost:3000 可访问，前端只读", requiresHumanConfirm: false,
      },
      {
        order: 5, name: "Live Records 只读检查", agent: "操作员",
        mode: "dry_run", baseTablesIn: ["Candidates", "Jobs"], baseTablesOut: [],
        command: "curl /api/live/records?table=candidates && curl /api/live/records?table=jobs",
        successCriteria: "返回安全投影记录（不含 rec_/resume_text/token）", requiresHumanConfirm: false,
      },
      {
        order: 6, name: "Agent Pipeline: Intake → Extraction → Graph → Kit → Reviewer → HR", agent: "7 个 Agent 协作",
        mode: "plan", baseTablesIn: ["Candidates", "Jobs"], baseTablesOut: ["Candidates", "Resume Facts", "Evaluations", "Interview Kits", "Agent Runs"],
        command: "POST /api/live/candidates/:linkId/generate-write-plan",
        successCriteria: "planNonce 生成，commands count > 0", requiresHumanConfirm: false,
      },
      {
        order: 7, name: "Candidate Pipeline Write 执行", agent: "7 个 Agent 协作",
        mode: "execute_guarded", baseTablesIn: ["Candidates", "Jobs"], baseTablesOut: ["Candidates", "Resume Facts", "Evaluations", "Interview Kits", "Agent Runs"],
        command: "POST /api/live/candidates/:linkId/execute-writes (需双确认 + planNonce + HIRELOOP_ALLOW_LARK_WRITE=1)",
        successCriteria: "候选人状态推进到 decision_pending，各表有记录", requiresHumanConfirm: true,
      },
      {
        order: 8, name: "Human Decision 计划生成", agent: "HR 协调",
        mode: "plan", baseTablesIn: ["Candidates"], baseTablesOut: [],
        command: "POST /api/live/candidates/:linkId/generate-human-decision-plan",
        successCriteria: "decision=offer/rejected, planNonce 生成", requiresHumanConfirm: false,
      },
      {
        order: 9, name: "Human Decision 执行", agent: "human_confirm (人工)",
        mode: "execute_guarded", baseTablesIn: ["Candidates"], baseTablesOut: ["Candidates"],
        command: "POST /api/live/candidates/:linkId/execute-human-decision (需双确认 + planNonce + HIRELOOP_ALLOW_LARK_WRITE=1)",
        successCriteria: "decision_pending → offer/rejected, human_decision 字段已写入", requiresHumanConfirm: true,
      },
      {
        order: 10, name: "Analytics 周报计划生成", agent: "数据分析",
        mode: "plan", baseTablesIn: ["Candidates", "Evaluations", "Agent Runs"], baseTablesOut: [],
        command: "POST /api/live/analytics/generate-report-plan",
        successCriteria: "candidateCount/evaluationCount/agentRunCount 有数值, planNonce 生成", requiresHumanConfirm: false,
      },
      {
        order: 11, name: "Analytics 周报执行", agent: "数据分析",
        mode: "execute_guarded", baseTablesIn: ["Candidates", "Evaluations", "Agent Runs"], baseTablesOut: ["Reports", "Agent Runs"],
        command: "POST /api/live/analytics/execute-report (需双确认 + planNonce + HIRELOOP_ALLOW_LARK_WRITE=1)",
        successCriteria: "Reports 表有周报记录，Agent Runs 有审计记录", requiresHumanConfirm: true,
      },
      {
        order: 12, name: "闭环验证", agent: "操作员",
        mode: "dry_run", baseTablesIn: ["Candidates", "Reports", "Agent Runs", "Work Events"], baseTablesOut: [],
        command: "pnpm mvp:live-verification",
        successCriteria: "nonce 一致、写入记录数匹配、状态一致性通过", requiresHumanConfirm: false,
      },
      {
        order: 13, name: "恢复与补偿检查", agent: "操作员",
        mode: "dry_run", baseTablesIn: ["Candidates", "Reports", "Agent Runs"], baseTablesOut: [],
        command: "pnpm mvp:live-recovery",
        successCriteria: "partial writes 已识别、targeted retry 建议已生成", requiresHumanConfirm: false,
      },
    ],
    safety: {
      readsOnly: true,
      writesGuarded: true,
      frontendNoExecute: true,
      planNonceRequired: true,
    },
  };
}

function printText(runbook: LoopRunbook, baseStatus: ReturnType<typeof getLiveBaseStatus>): void {
  console.log(`=== ${runbook.title} ===\n`);

  console.log("--- 7 Virtual Employees ---");
  for (const a of runbook.agents) {
    console.log(`  ${a.name} (${a.key}): ${a.role}`);
    console.log(`    可写表: ${a.writableTables.join(", ")}`);
  }
  console.log("");

  console.log("--- 8 Base Tables ---");
  for (const t of runbook.tables) {
    console.log(`  ${t.name}: ${t.purpose}`);
  }
  console.log("");

  const readOk = baseStatus.readEnabled && baseStatus.blockedReasons.length === 0;
  console.log(`--- Current Status ---`);
  console.log(`  飞书只读: ${readOk ? "已配置" : "未配置"}`);
  console.log(`  写入开关: ${baseStatus.writeDisabled !== false ? "关闭" : "已打开"}`);
  console.log(`  阻断原因: ${baseStatus.blockedReasons.length > 0 ? baseStatus.blockedReasons.join("; ") : "无"}`);
  console.log("");

  console.log("--- 13-Step Closed Loop ---");
  for (const s of runbook.steps) {
    const modeLabel = s.mode === "execute_guarded" ? "执行（需人工确认）" : s.mode === "plan" ? "计划（只读）" : "检查（只读）";
    console.log(`  [${s.order}] ${s.name}`);
    console.log(`      Agent: ${s.agent}`);
    console.log(`      模式: ${modeLabel}`);
    console.log(`      读表: ${s.baseTablesIn.length > 0 ? s.baseTablesIn.join(", ") : "—"}`);
    console.log(`      写表: ${s.baseTablesOut.length > 0 ? s.baseTablesOut.join(", ") : "—"}`);
    console.log(`      命令: ${s.command}`);
    console.log(`      成功标准: ${s.successCriteria}`);
    console.log(`      需人工确认: ${s.requiresHumanConfirm ? "是" : "否"}`);
    console.log("");
  }

  console.log("--- Safety ---");
  console.log("  只读默认: 是 (所有 dry-run/plan 步骤不写入 Base)");
  console.log("  写入守卫: 是 (execute 步骤需 HIRELOOP_ALLOW_LARK_WRITE=1 + 双确认 + planNonce)");
  console.log("  前端无执行入口: 是 (前端只有 plan/preview/read-only)");
  console.log("  planNonce TOCTOU: 是 (所有 execute 步骤执行前复算 nonce)");
  console.log("");

  if (!EXECUTE_MODE) {
    console.log("[INFO] 当前为默认只读模式。如需执行检查步骤（非写入），请添加 --execute --confirm=COMPETITION_LOOP_RUNBOOK_CHECK");
  }
  console.log("[SAFETY] 此脚本不执行任何 Base 写入操作。真实写入需通过后端 API 双确认完成。");
}

function printJson(runbook: LoopRunbook, baseStatus: ReturnType<typeof getLiveBaseStatus>): void {
  const output = {
    title: runbook.title,
    agentCount: runbook.agents.length,
    tableCount: runbook.tables.length,
    stepCount: runbook.steps.length,
    currentStatus: {
      feishuReadOk: baseStatus.readEnabled && baseStatus.blockedReasons.length === 0,
      writeDisabled: baseStatus.writeDisabled !== false,
      blockedReasons: baseStatus.blockedReasons,
    },
    agents: runbook.agents.map((a) => ({ name: a.name, key: a.key, role: a.role, writableTables: a.writableTables })),
    tables: runbook.tables.map((t) => ({ name: t.name, purpose: t.purpose })),
    steps: runbook.steps.map((s) => ({
      order: s.order,
      name: s.name,
      agent: s.agent,
      mode: s.mode,
      baseTablesIn: s.baseTablesIn,
      baseTablesOut: s.baseTablesOut,
      requiresHumanConfirm: s.requiresHumanConfirm,
    })),
    safety: runbook.safety,
    mode: EXECUTE_MODE ? "check_execute" : "dry_run",
  };
  console.log(JSON.stringify(output, null, 2));
}

function main(): void {
  const runbook = buildRunbook();
  const config = loadConfig();
  const readOnlyErrors = validateReadOnlyConfig(config);

  if (readOnlyErrors.length > 0) {
    if (!args.json) {
      console.log("[WARN] 飞书配置不完整。runbook 步骤将显示为计划状态。");
      console.log(`  缺失: ${readOnlyErrors.join("; ")}`);
      console.log("");
    }
  }

  const baseStatus = getLiveBaseStatus();

  if (args.json) {
    printJson(runbook, baseStatus);
  } else {
    printText(runbook, baseStatus);
  }
}

main();
