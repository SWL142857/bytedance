export type LiveE2eStepStatus =
  | "ready"
  | "blocked"
  | "manual"
  | "not_run"
  | "success"
  | "failed";

export interface LiveE2eRunbookStep {
  order: number;
  name: string;
  status: LiveE2eStepStatus;
  goal: string;
  commandHint: string;
  successCriteria: string;
  failureRecovery: string;
  safetyNote: string;
  rerunnable: boolean;
}

export interface LiveE2eRunbook {
  title: string;
  description: string;
  steps: LiveE2eRunbookStep[];
  finalSafetyNote: string;
  overallStatus: "ready" | "blocked" | "in_progress" | "completed" | "failed";
}

export interface LiveE2eRunbookInput {
  feishuConfigured: boolean;
  bootstrapDone: boolean;
  seedDone: boolean;
  localUiRunning: boolean;
  liveRecordsAccessible: boolean;
  candidateFound: boolean;
  writePlanGenerated: boolean;
  writePlanCommandCount: number;
  writeExecuted: boolean;
  writeSuccess: boolean;
  writeFailedCommandIndex: number | null;
  humanDecisionGenerated: boolean;
  humanDecisionExecuted: boolean;
  humanDecisionSuccess: boolean;
  analyticsReportGenerated: boolean;
  analyticsReportExecuted: boolean;
  analyticsReportSuccess: boolean;
  verificationRun: boolean;
  verificationPassed: boolean;
  recoveryRun: boolean;
  recoveryClean: boolean;
}

export function buildLiveE2eRunbook(
  input: LiveE2eRunbookInput,
): LiveE2eRunbook {
  const steps: LiveE2eRunbookStep[] = [
    buildStep1EnvAuth(input),
    buildStep2BootstrapDryRun(input),
    buildStep3BootstrapExecute(input),
    buildStep4StartUi(input),
    buildStep5LiveRecords(input),
    buildStep6CandidateWritePlan(input),
    buildStep7CandidateExecuteWrites(input),
    buildStep8HumanDecisionPlan(input),
    buildStep9HumanDecisionExecute(input),
    buildStep10AnalyticsReportPlan(input),
    buildStep11AnalyticsReportExecute(input),
    buildStep12Verification(input),
    buildStep13RecoveryReview(input),
  ];

  const overallStatus = computeOverallStatus(input, steps);

  return {
    title: "Live E2E Runbook",
    description:
      "真实飞书 MVP 闭环：bootstrap -> pipeline write -> human decision -> analytics report -> verification。每一步都有 success/blocked/manual 判定，失败不会要求盲目重跑整链路。",
    steps,
    finalSafetyNote:
      "任何 execute 步骤失败后，不要盲目重跑整条 pipeline。先检查 Base 中已写入的记录，再决定是 targeted retry 还是人工补偿。dry-run / plan / readiness / verification 可以安全重跑。",
    overallStatus,
  };
}

function computeOverallStatus(
  _input: LiveE2eRunbookInput,
  steps: LiveE2eRunbookStep[],
): LiveE2eRunbook["overallStatus"] {
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.every((s) => s.status === "success" || s.status === "ready"))
    return "completed";
  if (steps.some((s) => s.status === "success")) return "in_progress";
  if (steps.some((s) => s.status === "blocked")) return "blocked";
  return "ready";
}

function buildStep1EnvAuth(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  const configured = input.feishuConfigured;
  return {
    order: 1,
    name: "环境与飞书凭据",
    status: configured ? "ready" : "blocked",
    goal: "配置飞书应用凭据和 Base 应用凭证，启用只读权限。",
    commandHint:
      "export 飞书应用凭据和 Base 应用凭证，并设置 HIRELOOP_ALLOW_LARK_READ=1",
    successCriteria:
      "pnpm base:bootstrap:dry-run 输出 '配置检查通过' 或 base-status 返回 readEnabled=true。",
    failureRecovery:
      "检查飞书应用是否已创建、权限是否开通（Base 读写）、凭据是否正确。修复 env 后重试。",
    safetyNote: "凭据不出现在日志或 API 响应中，并通过 redaction 保护。",
    rerunnable: true,
  };
}

function buildStep2BootstrapDryRun(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.feishuConfigured) {
    return blockedStep(2, "Bootstrap Dry-Run", "pnpm base:bootstrap:dry-run",
      "检查飞书配置和 Base 状态，显示将要执行的建表和 seed 操作。");
  }
  return {
    order: 2,
    name: "Bootstrap Dry-Run",
    status: "ready",
    goal: "检查飞书配置和 Base 状态，显示将要执行的建表和 seed 操作。",
    commandHint: "pnpm base:bootstrap:dry-run",
    successCriteria:
      "输出 8 张表建表计划 + demo seed 计划，Unsupported fields: 0，无 blocked 原因。",
    failureRecovery:
      "如果 Base 非空（已有业务数据），需要人工确认是否清空后重试。如果配置错误，修复 env 后重试。",
    safetyNote:
      "dry-run 不写入任何数据，可以安全重跑。输出已安全投影，不暴露 record ID 或敏感凭据。",
    rerunnable: true,
  };
}

function buildStep3BootstrapExecute(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.feishuConfigured) {
    return blockedStep(3, "Bootstrap Execute", "pnpm base:bootstrap:execute",
      "初始化 8 张表 + 写入 demo job + demo candidate（含 job link 关联）。");
  }
  if (input.bootstrapDone) {
    if (!input.seedDone) {
      return {
        order: 3,
        name: "Bootstrap Execute",
        status: "failed",
        goal: "初始化 8 张表 + 写入 demo job + demo candidate（含 job link 关联）。",
        commandHint: "pnpm base:bootstrap:execute",
        successCriteria:
          "8 张表已创建，demo job 和 candidate 已写入且 job link 关联正确。",
        failureRecovery:
          "建表完成但 seed 未完成。先人工核查 Base 表结构和已有记录，再决定手动补 seed 或清空空表后重试。",
        safetyNote:
          "不要在未确认 Base 当前状态前重跑 bootstrap execute，避免重复表结构或半成品数据。",
        rerunnable: false,
      };
    }
    return successStep(3, "Bootstrap Execute",
      "初始化 8 张表 + 写入 demo job + demo candidate（含 job link 关联）。",
      "pnpm base:bootstrap:execute",
      "8 张表已创建，demo job 和 candidate 已写入且 job link 关联正确。",
      "非空 Base 时 fail closed。需人工确认后手动清空 Base 再重试。不要在有业务数据的 Base 上重跑。");
  }
  return {
    order: 3,
    name: "Bootstrap Execute",
    status: "manual",
    goal: "初始化 8 张表 + 写入 demo job + demo candidate（含 job link 关联）。",
    commandHint:
      "启用写入开关后运行 pnpm base:bootstrap:execute",
    successCriteria:
      "8 张表已创建，demo job 和 candidate 已写入且 job link 关联正确。",
    failureRecovery:
      "非空 Base 时 fail closed。需人工确认后手动清空 Base 再重试。不要在有业务数据的 Base 上重跑。",
    safetyNote:
      "需要 HIRELOOP_ALLOW_LARK_WRITE=1。非空 Base 自动阻断，不误删已有数据。输出已安全投影。",
    rerunnable: false,
  };
}

function buildStep4StartUi(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.bootstrapDone) {
    return blockedStep(4, "启动本地 UI", "pnpm ui:dev",
      "启动本地 UI 服务，可通过浏览器查看 live records 和候选人详情。");
  }
  return {
    order: 4,
    name: "启动本地 UI",
    status: input.localUiRunning ? "success" : "ready",
    goal: "启动本地 UI 服务，可通过浏览器查看 live records 和候选人详情。",
    commandHint: "pnpm ui:dev",
    successCriteria:
      "http://localhost:3000 可访问，/api/live/base-status 返回 readEnabled=true。",
    failureRecovery: "检查端口占用。确认 env 配置正确后重试。",
    safetyNote: "UI 只读展示，不暴露 record ID、resume 原文或敏感凭据。",
    rerunnable: true,
  };
}

function buildStep5LiveRecords(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.bootstrapDone) {
    return blockedStep(5, "Live Records 检查", 'curl "http://localhost:3000/api/live/records?table=candidates"',
      "确认候选人和岗位数据在飞书 Base 中可读取。");
  }
  if (!input.seedDone) {
    return blockedStep(5, "Live Records 检查", 'curl "http://localhost:3000/api/live/records?table=candidates"',
      "确认候选人和岗位数据在飞书 Base 中可读取。");
  }
  return {
    order: 5,
    name: "Live Records 检查",
    status: input.liveRecordsAccessible ? "success" : "ready",
    goal: "确认候选人和岗位数据在飞书 Base 中可读取。",
    commandHint:
      'curl "http://localhost:3000/api/live/records?table=candidates"',
    successCriteria:
      "返回至少 1 条候选人记录，包含 candidate_id 和 status 字段。不暴露 record ID。",
    failureRecovery:
      "检查凭据是否正确、飞书应用是否有 Base 读权限。修复后重试。",
    safetyNote: "只读查询，输出已安全投影，不包含 record ID 和简历原文。",
    rerunnable: true,
  };
}

function buildStep6CandidateWritePlan(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.candidateFound) {
    return blockedStep(6, "候选人写回计划",
      "POST /api/live/candidates/:linkId/generate-write-plan",
      "生成候选人 pipeline 写回计划（从 new 到 decision_pending）。");
  }
  return {
    order: 6,
    name: "候选人写回计划",
    status: input.writePlanGenerated ? "success" : "ready",
    goal: "生成候选人 pipeline 写回计划（从 new 到 decision_pending）。",
    commandHint:
      "POST /api/live/candidates/:linkId/generate-write-plan",
    successCriteria:
      `返回 status=planned，commandCount=${input.writePlanCommandCount || "N"}，包含 planNonce。`,
    failureRecovery:
      "如果候选人缺少岗位要求或 rubric，需要先补全 Base 数据。如果 pipeline 报错，检查 Agent Runs 日志。",
    safetyNote:
      "只读生成计划，不写入。返回安全摘要，不包含原始参数。",
    rerunnable: true,
  };
}

function buildStep7CandidateExecuteWrites(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.writePlanGenerated) {
    return blockedStep(7, "执行候选人写回",
      "POST /api/live/candidates/:linkId/execute-writes",
      "双确认后执行 pipeline 写回，将候选人推进到 decision_pending。");
  }
  if (input.writeExecuted && input.writeSuccess) {
    return successStep(7, "执行候选人写回",
      "双确认后执行 pipeline 写回，将候选人推进到 decision_pending。",
      "POST /api/live/candidates/:linkId/execute-writes",
      "候选人状态变为 decision_pending，Agent Runs 和相关表记录已写入。",
      "如果失败，先检查 Base 中已写入的 partial records，再决定 targeted retry 或人工补偿。");
  }
  if (input.writeExecuted && !input.writeSuccess) {
    return {
      order: 7,
      name: "执行候选人写回",
      status: "failed",
      goal: "双确认后执行 pipeline 写回，将候选人推进到 decision_pending。",
      commandHint:
        "POST /api/live/candidates/:linkId/execute-writes",
      successCriteria:
        "候选人状态变为 decision_pending，Agent Runs 和相关表记录已写入。",
      failureRecovery:
        `写入在第 ${input.writeFailedCommandIndex ?? "?"} 条命令失败。先检查 Base 中已写入的记录，再决定 targeted retry 或人工补偿。不要盲目重跑整条 pipeline。`,
      safetyNote:
        "需要双确认短语 + planNonce。TOCTOU guard 会在数据变更时阻断。失败后必须先 recovery review。",
      rerunnable: false,
    };
  }
  return {
    order: 7,
    name: "执行候选人写回",
    status: "manual",
    goal: "双确认后执行 pipeline 写回，将候选人推进到 decision_pending。",
    commandHint:
      "POST /api/live/candidates/:linkId/execute-writes（人工填写双确认短语和 planNonce）",
    successCriteria:
      "候选人状态变为 decision_pending，Agent Runs 和相关表记录已写入。",
    failureRecovery:
      "失败后不要盲目重跑。先检查 Base 中已写入的 partial records，再决定 targeted retry 或人工补偿。",
    safetyNote:
      "需要双确认短语 + planNonce TOCTOU guard。缺少 HIRELOOP_ALLOW_LARK_WRITE=1 时阻断。",
    rerunnable: false,
  };
}

function buildStep8HumanDecisionPlan(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.writeExecuted || !input.writeSuccess) {
    return blockedStep(8, "人类决策计划",
      "POST /api/live/candidates/:linkId/generate-human-decision-plan",
      "生成人类最终决策计划（offer 或 rejected）。");
  }
  return {
    order: 8,
    name: "人类决策计划",
    status: input.humanDecisionGenerated ? "success" : "ready",
    goal: "生成人类最终决策计划（offer 或 rejected）。",
    commandHint:
      "POST /api/live/candidates/:linkId/generate-human-decision-plan（填写 decision、decidedBy、decisionNote）",
    successCriteria:
      "返回 status=planned，decision=offer/rejected，包含 planNonce 和 candidateDisplayName。",
    failureRecovery:
      "如果候选人不是 decision_pending 状态，需要先完成 pipeline 写回。如果输入无效，修复后重试。",
    safetyNote:
      "只读生成计划，不写入。只有 decision_pending 状态的候选人才能生成计划。",
    rerunnable: true,
  };
}

function buildStep9HumanDecisionExecute(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.humanDecisionGenerated) {
    return blockedStep(9, "执行人类决策",
      "POST /api/live/candidates/:linkId/execute-human-decision",
      "双确认后执行人类最终决策写回。");
  }
  if (input.humanDecisionExecuted && input.humanDecisionSuccess) {
    return successStep(9, "执行人类决策",
      "双确认后执行人类最终决策写回。",
      "POST /api/live/candidates/:linkId/execute-human-decision",
      "候选人状态变为 offer 或 rejected，human decision fields 已写入。",
      "如果失败，检查 Base 中候选人状态是否已变更，再决定 targeted retry。");
  }
  return {
    order: 9,
    name: "执行人类决策",
    status: input.humanDecisionExecuted && !input.humanDecisionSuccess ? "failed" : "manual",
    goal: "双确认后执行人类最终决策写回。",
    commandHint:
      "POST /api/live/candidates/:linkId/execute-human-decision（人工填写双确认短语和 planNonce）",
    successCriteria:
      "候选人状态变为 offer 或 rejected，human decision fields 已写入。",
    failureRecovery:
      "如果失败，检查 Base 中候选人状态是否已变更（可能已写入部分字段）。不要盲目重跑。",
    safetyNote:
      "需要双确认短语 + planNonce TOCTOU guard。只有 human_confirm actor 可以触发。Agent 不能触发 offer/rejected。",
    rerunnable: false,
  };
}

function buildStep10AnalyticsReportPlan(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.humanDecisionExecuted || !input.humanDecisionSuccess) {
    return blockedStep(10, "Analytics 报告计划",
      "POST /api/live/analytics/generate-report-plan",
      "只读聚合真实 Base 数据，生成 Analytics 报告写回计划。");
  }
  return {
    order: 10,
    name: "Analytics 报告计划",
    status: input.analyticsReportGenerated ? "success" : "ready",
    goal: "只读聚合真实 Base 数据，生成 Analytics 报告写回计划。",
    commandHint:
      "POST /api/live/analytics/generate-report-plan（可填写 periodStart、periodEnd）",
    successCriteria:
      "返回 status=planned，candidateCount > 0，包含 Reports + Agent Runs 命令。",
    failureRecovery:
      "如果没有候选人数据（status=needs_review），需要先完成前面的步骤。如果 Base 不可读，检查 env。",
    safetyNote:
      "只读聚合，不写入。没有候选人数据时返回 needs_review，不写空报告。",
    rerunnable: true,
  };
}

function buildStep11AnalyticsReportExecute(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.analyticsReportGenerated) {
    return blockedStep(11, "执行 Analytics 报告",
      "POST /api/live/analytics/execute-report",
      "双确认后执行 Analytics 报告写回（Reports + Agent Runs）。");
  }
  if (input.analyticsReportExecuted && input.analyticsReportSuccess) {
    return successStep(11, "执行 Analytics 报告",
      "双确认后执行 Analytics 报告写回（Reports + Agent Runs）。",
      "POST /api/live/analytics/execute-report",
      "Reports 表已写入周报记录，Agent Runs 已记录 Analytics 执行。",
      "如果失败，检查 Reports 和 Agent Runs 表中已写入的记录，再决定 targeted retry。");
  }
  return {
    order: 11,
    name: "执行 Analytics 报告",
    status: input.analyticsReportExecuted && !input.analyticsReportSuccess ? "failed" : "manual",
    goal: "双确认后执行 Analytics 报告写回（Reports + Agent Runs）。",
    commandHint:
      "POST /api/live/analytics/execute-report（人工填写双确认短语和 planNonce）",
    successCriteria:
      "Reports 表已写入周报记录，Agent Runs 已记录 Analytics 执行。",
    failureRecovery:
      "如果失败，检查 Reports 和 Agent Runs 表中已写入的记录。不要盲目重跑。",
    safetyNote:
      "需要双确认短语 + planNonce TOCTOU guard。只写 Reports + Agent Runs，不写 Candidates。",
    rerunnable: false,
  };
}

function buildStep12Verification(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.analyticsReportExecuted || !input.analyticsReportSuccess) {
    return blockedStep(12, "验证",
      "pnpm mvp:live-verification 或手动检查 Base",
      "验证所有写入是否正确完成。");
  }
  return {
    order: 12,
    name: "验证",
    status: input.verificationRun
      ? input.verificationPassed
        ? "success"
        : "failed"
      : "ready",
    goal: "验证所有写入是否正确完成。",
    commandHint: "pnpm mvp:live-verification",
    successCriteria:
      "Agent Runs 记录完整，Candidates 状态正确（offer/rejected），Reports 有周报记录。",
    failureRecovery:
      "如果验证失败，对照 Base 中的记录逐项检查。可能需要 targeted retry 或人工补偿。",
    safetyNote:
      "验证是只读操作，可以安全重跑。验证报告不暴露 record ID 或敏感数据。",
    rerunnable: true,
  };
}

function buildStep13RecoveryReview(
  input: LiveE2eRunbookInput,
): LiveE2eRunbookStep {
  if (!input.writeExecuted) {
    return blockedStep(13, "Recovery Review", "pnpm mvp:live-recovery",
      "检查执行过程中是否有失败或 partial writes，制定恢复计划。");
  }
  return {
    order: 13,
    name: "Recovery Review",
    status: input.recoveryRun
      ? input.recoveryClean
        ? "success"
        : "failed"
      : "ready",
    goal: "检查执行过程中是否有失败或 partial writes，制定恢复计划。",
    commandHint: "pnpm mvp:live-recovery",
    successCriteria:
      "无 partial writes，无 failed commands，recovery status=completed_successfully。",
    failureRecovery:
      "如果有 partial writes，先人工核查 Base 中已写入的记录，再决定补偿策略。不要盲目重跑。",
    safetyNote:
      "recovery review 是只读分析，可以安全重跑。它帮助判断是否需要人工干预。",
    rerunnable: true,
  };
}

function blockedStep(
  order: number,
  name: string,
  commandHint: string,
  goal: string,
): LiveE2eRunbookStep {
  return {
    order,
    name,
    status: "blocked",
    goal,
    commandHint,
    successCriteria: "前置步骤未完成，无法执行。",
    failureRecovery: "完成前置步骤后重试。",
    safetyNote: "blocked 步骤不会执行任何写入。",
    rerunnable: true,
  };
}

function successStep(
  order: number,
  name: string,
  goal: string,
  commandHint: string,
  successCriteria: string,
  failureRecovery: string,
): LiveE2eRunbookStep {
  return {
    order,
    name,
    status: "success",
    goal,
    commandHint,
    successCriteria,
    failureRecovery,
    safetyNote: "该步骤已成功完成。",
    rerunnable: false,
  };
}
