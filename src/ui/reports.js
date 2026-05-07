import {
  badgeHtml,
  checkListHtml,
  codeListHtml,
  indicatorHtml,
  noteHtml,
  changesHtml,
  displayText,
  esc,
  errorHtml,
} from "./helpers.js";

// ── Console Health State ──

export const consoleHealthState = {
  releaseGate: { ok: true, error: false },
  apiAudit: { ok: true, error: false },
  preApiFreeze: { ok: true, error: false },
  liveReadiness: { ok: true, error: false },
  providerReadiness: { ok: true, error: false },
  providerSmoke: { ok: true, error: false },
  providerAgentDemo: { ok: true, error: false },
};

export function isStatusOk(status) {
  if (status == null) return true;
  const s = String(status).toLowerCase();
  return s === "pass" || s === "passed" || s === "ok" || s === "ready" ||
         s === "locked" || s === "disabled" || s === "readonly" || s === "dry_run";
}

function isStatusIssue(status) {
  if (status == null) return false;
  const s = String(status).toLowerCase();
  return s === "fail" || s === "failed" || s === "block" || s === "blocked" ||
         s === "warn" || s === "warning" || s === "needs_review" || s === "error";
}

export function updateConsoleBadge() {
  const badge = document.getElementById("console-badge");
  if (!badge) return;

  let hasError = false;
  let hasIssue = false;
  const keys = Object.keys(consoleHealthState);
  for (let i = 0; i < keys.length; i++) {
    const state = consoleHealthState[keys[i]];
    if (state.error) { hasError = true; break; }
    if (!state.ok) hasIssue = true;
  }

  if (hasError) {
    badge.textContent = "加载异常";
    badge.className = "console-entry-badge badge-warn";
  } else if (hasIssue) {
    badge.textContent = "存在预警";
    badge.className = "console-entry-badge badge-warn";
  } else {
    badge.textContent = "全部正常";
    badge.className = "console-entry-badge badge-ok";
  }
}

export function renderDrawerError(drawerId, title) {
  const el = document.getElementById(drawerId);
  if (!el) return;
  let html = '<div class="card-header"><span class="card-header-dot"></span>' + esc(title) + '</div>';
  html += '<div class="card-body">' + errorHtml() + '</div>';
  el.innerHTML = html;
}

export const REPORT_DRAWER_MAP = {
  "release-gate-content": { healthKey: "releaseGate", drawerId: "drawer-release-gate", title: "交付检查" },
  "api-audit-content": { healthKey: "apiAudit", drawerId: "drawer-api-audit", title: "API 边界审计" },
  "pre-api-freeze-content": { healthKey: "preApiFreeze", drawerId: "drawer-pre-api-freeze", title: "架构冻结" },
  "live-readiness-content": { healthKey: "liveReadiness", drawerId: "drawer-live-readiness", title: "后端写入守卫" },
  "provider-readiness-content": { healthKey: "providerReadiness", drawerId: "drawer-provider-readiness", title: "就绪状态" },
  "provider-smoke-content": { healthKey: "providerSmoke", drawerId: "drawer-provider-smoke", title: "连通测试" },
  "provider-agent-demo-content": { healthKey: "providerAgentDemo", drawerId: "drawer-provider-agent-demo", title: "Agent 演示" },
};

export function safeCatch(elementId) {
  return function () {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = errorHtml();

    const mapping = REPORT_DRAWER_MAP[elementId];
    if (mapping) {
      consoleHealthState[mapping.healthKey].error = true;
      consoleHealthState[mapping.healthKey].ok = false;
      renderDrawerError(mapping.drawerId, mapping.title);
      updateConsoleBadge();
    }
  };
}

// ── Report renderers ──

export function renderReleaseGate(data) {
  consoleHealthState.releaseGate.error = false;
  consoleHealthState.releaseGate.ok = isStatusOk(data.status);
  const drawerEl = document.getElementById("drawer-release-gate");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>交付检查</div>';
  html += '<div class="card-body">';
  html += badgeHtml(data.status);
  html += '<div class="indicator-rows">';
  html += indicatorHtml("本地演示就绪", data.localDemoReady);
  html += indicatorHtml("Live 安全就绪", data.liveSafetyReady);
  html += indicatorHtml("真实写入", data.realWritePermittedByReport);
  html += indicatorHtml("外部模型调用", data.externalModelCallPermittedByReport);
  html += '</div>';
  html += checkListHtml(data.checks);
  html += codeListHtml(data.recommendedDemoCommands);
  html += noteHtml(data.finalHandoffNote);
  html += '</div>';
  drawerEl.innerHTML = html;
}

export function renderApiAudit(data) {
  consoleHealthState.apiAudit.error = false;
  consoleHealthState.apiAudit.ok = isStatusOk(data.status);
  const drawerEl = document.getElementById("drawer-api-audit");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>API 边界审计</div>';
  html += '<div class="card-body">';
  html += badgeHtml(data.status);
  html += '<div class="indicator-rows">';
  html += indicatorHtml("外部模型调用", data.defaultExternalModelCallsPermittedByReport);
  html += indicatorHtml("真实 Base 写入", data.realBaseWritesPermittedByReport);
  html += indicatorHtml("Provider Smoke 守卫", data.providerSmokeGuarded);
  html += indicatorHtml("Provider Agent 守卫", data.providerAgentDemoGuarded);
  html += indicatorHtml("Base 写入守卫独立", data.baseWriteGuardIndependent);
  html += indicatorHtml("确定性演示安全", data.deterministicDemoSafe);
  html += indicatorHtml("输出脱敏安全", data.outputRedactionSafe);
  html += indicatorHtml("密钥扫描", data.secretScanPassed);
  html += indicatorHtml("门禁一致", data.releaseGateConsistent);
  html += '</div>';
  html += checkListHtml(data.checks);
  html += codeListHtml(data.recommendedCommands);
  html += noteHtml(data.finalNote);
  html += '</div>';
  drawerEl.innerHTML = html;
}

export function renderPreApiFreeze(data) {
  consoleHealthState.preApiFreeze.error = false;
  consoleHealthState.preApiFreeze.ok = isStatusOk(data.status);
  const drawerEl = document.getElementById("drawer-pre-api-freeze");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>架构冻结</div>';
  html += '<div class="card-body">';
  html += badgeHtml(data.status);
  html += '<div class="indicator-rows">';
  html += indicatorHtml("允许 API 接入", data.apiIntegrationAllowed);
  html += indicatorHtml("允许外部模型", data.externalModelCallAllowedByReport);
  html += indicatorHtml("允许真实 Base 写入", data.realBaseWriteAllowedByReport);
  html += '</div>';
  html += checkListHtml(data.checks);
  html += changesHtml(data.allowedNextChanges, data.blockedChanges);
  html += noteHtml(data.finalNote);
  html += '</div>';
  drawerEl.innerHTML = html;
}

export function renderLiveReadiness(data) {
  consoleHealthState.liveReadiness.error = false;
  consoleHealthState.liveReadiness.ok = data.ready === true;
  const drawerEl = document.getElementById("drawer-live-readiness");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>后端写入守卫</div>';
  html += '<div class="card-body">';
  html += '<div class="readiness-hero">';
  html += '<div class="readiness-status ' + (data.ready ? 'ready' : 'not-ready') + '">' +
    (data.ready ? '就绪' : '未就绪') + '</div>';
  html += '<div class="readiness-metrics">';
  html += '<div class="readiness-metric"><div class="readiness-metric-value">' +
    data.resolvedRecordCount + ' / ' + data.requiredRecordCount + '</div>' +
    '<div class="readiness-metric-label">记录解析</div></div>';
  html += '<div class="readiness-metric"><div class="readiness-metric-value">' +
    data.plannedWriteCount + '</div>' +
    '<div class="readiness-metric-label">写入计划</div></div>';
  html += '<div class="readiness-metric"><div class="readiness-metric-value">' +
    esc(displayText(data.resolutionMode || '—')) + '</div>' +
    '<div class="readiness-metric-label">解析模式</div></div>';
  html += '</div></div>';
  html += checkListHtml(data.checks);
  if (data.nextStep) {
    html += '<div class="readiness-next">' + esc(displayText(data.nextStep)) + '</div>';
  }
  html += '</div>';
  drawerEl.innerHTML = html;
}

export function renderProviderReadiness(data) {
  consoleHealthState.providerReadiness.error = false;
  consoleHealthState.providerReadiness.ok = isStatusOk(data.status);
  const drawerEl = document.getElementById("drawer-provider-readiness");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>就绪状态</div>';
  html += '<div class="card-body">';
  html += badgeHtml(data.status);
  html += '<div class="indicator-rows">';
  html += indicatorHtml("模型供应商", data.providerName);
  html += indicatorHtml("外部模型调用", data.canCallExternalModel);
  html += '</div>';
  if (data.blockedReasons && data.blockedReasons.length) {
    html += '<div class="blocked-reasons">';
    for (let i = 0; i < data.blockedReasons.length; i++) {
      html += '<div class="blocked-reason">' + esc(displayText(data.blockedReasons[i])) + '</div>';
    }
    html += '</div>';
  }
  html += '<div class="provider-summary">' + esc(displayText(data.safeSummary)) + '</div>';
  html += '</div>';
  drawerEl.innerHTML = html;
}

export function renderProviderSmoke(data) {
  consoleHealthState.providerSmoke.error = false;
  consoleHealthState.providerSmoke.ok = isStatusOk(data.status);
  const drawerEl = document.getElementById("drawer-provider-smoke");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>连通测试</div>';
  html += '<div class="card-body">';
  html += badgeHtml(data.mode);
  html += badgeHtml(data.status);
  html += '<div class="provider-metric"><span class="provider-metric-label">HTTP 状态</span>' +
    '<span class="provider-metric-value">' + (data.httpStatus != null ? data.httpStatus : '—') + '</span></div>';
  html += '<div class="provider-metric"><span class="provider-metric-label">耗时</span>' +
    '<span class="provider-metric-value">' + data.durationMs + ' ms</span></div>';
  html += '<div class="provider-metric"><span class="provider-metric-label">有响应</span>' +
    '<span class="provider-metric-value">' + (data.hasChoices != null ? (data.hasChoices ? '是' : '否') : '—') + '</span></div>';
  html += '<div class="provider-metric"><span class="provider-metric-label">错误</span>' +
    '<span class="provider-metric-value">' + esc(data.errorKind || '无') + '</span></div>';
  html += '<div class="provider-summary">' + esc(displayText(data.safeSummary)) + '</div>';
  html += '</div>';
  drawerEl.innerHTML = html;
}

export function renderProviderAgentDemo(data) {
  consoleHealthState.providerAgentDemo.error = false;
  consoleHealthState.providerAgentDemo.ok = isStatusOk(data.status);
  const drawerEl = document.getElementById("drawer-provider-agent-demo");
  if (!drawerEl) return;

  let html = '<div class="card-header"><span class="card-header-dot"></span>Agent 演示</div>';
  html += '<div class="card-body">';
  html += badgeHtml(data.mode);
  html += badgeHtml(data.status);
  html += '<div class="provider-metric"><span class="provider-metric-label">命令数</span>' +
    '<span class="provider-metric-value">' + (data.commandCount != null ? data.commandCount : '—') + '</span></div>';
  html += '<div class="provider-metric"><span class="provider-metric-label">Agent 状态</span>' +
    '<span class="provider-metric-value">' + esc(data.agentRunStatus || '—') + '</span></div>';
  html += '<div class="provider-metric"><span class="provider-metric-label">耗时</span>' +
    '<span class="provider-metric-value">' + data.durationMs + ' ms</span></div>';
  html += '<div class="provider-metric"><span class="provider-metric-label">重试次数</span>' +
    '<span class="provider-metric-value">' + (data.retryCount != null ? data.retryCount : '—') + '</span></div>';
  html += '<div class="provider-summary">' + esc(displayText(data.safeSummary)) + '</div>';
  html += '</div>';
  drawerEl.innerHTML = html;
}
