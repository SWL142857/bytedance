import { esc } from "./helpers.js";

var STEPS = [
  {
    tool: "lark-cli record-list",
    input: "服务器镜像 Candidates / Jobs",
    decision: "确定性读取，不做推理",
    output: function (counts) { return counts.candidates + " 候选人, " + counts.roles + " 岗位"; },
    boundary: "只读",
    boundaryCls: "att-boundary-read",
  },
  {
    tool: "Graph RAG Builder",
    input: "候选人简历 + 岗位描述 + 证据库",
    decision: "图嵌入 → 相似边计算 → 邻居检索",
    output: function (counts) { return counts.evidence + " 证据, 图谱邻居索引"; },
    boundary: "只读",
    boundaryCls: "att-boundary-read",
  },
  {
    tool: "Graph RAG Reviewer (LLM)",
    input: "Graph RAG 信号 (投影/邻居/GNN)",
    decision: "LLM 融合 6 种图谱信号 → 可解释推荐",
    output: "匹配分数 + 命中特征 + 缺失约束",
    boundary: "只读",
    boundaryCls: "att-boundary-read",
  },
  {
    tool: "generate-write-plan",
    input: "Agent Pipeline 输出",
    decision: "确定性生成候选人与评估写入命令",
    output: "命令列表 → Candidates + Evaluations + Agent Runs",
    boundary: "生成计划",
    boundaryCls: "att-boundary-plan",
  },
  {
    tool: "human-decision-gate",
    input: "写入计划摘要 + planNonce",
    decision: "人工确认 → 后端双确认 + TOCTOU",
    output: "decision_pending → offer / rejected",
    boundary: "双确认",
    boundaryCls: "att-boundary-confirm",
  },
  {
    tool: "generate-report-plan",
    input: "Candidates + Evaluations + Agent Runs 聚合",
    decision: "漏斗分析 → 周报命令生成",
    output: "Analytics 周报计划 → Reports + Agent Runs",
    boundary: "只读",
    boundaryCls: "att-boundary-read",
  },
];

var EXECUTION_MODE_LABELS = {
  dry_run: "干跑",
  live_read: "在线只读",
  live_write: "后端写入审计",
  blocked: "写入被安全拦截",
};

var GUARD_STATUS_LABELS = {
  passed: "已通过",
  blocked: "写入被安全拦截",
  skipped: "已跳过",
};

function eventModeLabel(mode) {
  return EXECUTION_MODE_LABELS[mode] || mode || "—";
}

function eventGuardLabel(guard) {
  return GUARD_STATUS_LABELS[guard] || guard || "—";
}

function eventBoundaryCls(event) {
  if (event.execution_mode === "live_write") return "att-boundary-confirm";
  if (event.execution_mode === "blocked" || event.guard_status === "blocked") return "att-boundary-confirm";
  if (event.execution_mode === "live_read") return "att-boundary-read";
  return "att-boundary-read";
}

function eventBoundaryLabel(event) {
  if (event.execution_mode === "live_write") return "后端写入审计";
  if (event.execution_mode === "blocked" || event.guard_status === "blocked") return "写入被安全拦截";
  return "只读";
}

// ── Blueprint rendering ──

function renderBlueprintStep(step, index, counts) {
  var num = index + 1;
  var outputText = typeof step.output === "function" ? step.output(counts) : step.output;

  return (
    '<div class="att-step">' +
    '<div class="att-step-marker">' +
    '<span class="att-step-num att-step-num-blueprint">' + num + '</span>' +
    (num < STEPS.length ? '<span class="att-step-line"></span>' : '') +
    '</div>' +
    '<div class="att-step-card">' +
    '<div class="att-step-card-top">' +
    '<span class="att-step-tool">' + esc(step.tool) + '</span>' +
    '<span class="att-step-boundary ' + step.boundaryCls + '">' + esc(step.boundary) + '</span>' +
    '</div>' +
    '<div class="att-step-card-body">' +
    '<div class="att-step-field"><span class="att-step-field-label">输入</span><span class="att-step-field-value">' + esc(step.input) + '</span></div>' +
    '<div class="att-step-field"><span class="att-step-field-label">决策</span><span class="att-step-field-value">' + esc(step.decision) + '</span></div>' +
    '<div class="att-step-field"><span class="att-step-field-label">输出</span><span class="att-step-field-value att-step-output">' + esc(outputText) + '</span></div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderBlueprint(counts) {
  var container = document.getElementById("agent-tool-trace-body");
  if (!container) return;

  var html = '<div class="att-timeline">';
  for (var i = 0; i < STEPS.length; i++) {
    html += renderBlueprintStep(STEPS[i], i, counts);
  }
  html += '</div>';

  html += '<div class="att-footer-note">前端只读 · 真实写入需后端双确认 + planNonce · 前端无执行入口</div>';

  container.innerHTML = html;
}

// ── Real events rendering ──

function renderEventCard(event, index, total) {
  var num = index + 1;
  var toolLabel = event.tool_type || event.event_type || "—";
  var tableLabel = event.target_table || "";
  var modeLabel = eventModeLabel(event.execution_mode);
  var boundaryLabel = eventBoundaryLabel(event);
  var boundaryCls = eventBoundaryCls(event);
  var duration = event.duration_ms != null ? (event.duration_ms + "ms") : "";

  return (
    '<div class="att-step">' +
    '<div class="att-step-marker">' +
    '<span class="att-step-num att-step-num-live">' + num + '</span>' +
    (num < total ? '<span class="att-step-line"></span>' : '') +
    '</div>' +
    '<div class="att-step-card att-event-card">' +
    '<div class="att-step-card-top">' +
    '<span class="att-step-tool">' + esc(toolLabel) + '</span>' +
    '<span class="att-step-boundary ' + boundaryCls + '">' + esc(boundaryLabel) + '</span>' +
    '</div>' +
    '<div class="att-step-card-body">' +
    '<div class="att-step-field"><span class="att-step-field-label">Agent</span><span class="att-step-field-value att-event-agent">' + esc(event.agent_name || "—") + '</span></div>' +
    '<div class="att-step-field"><span class="att-step-field-label">模式</span><span class="att-step-field-value">' + esc(modeLabel) + (tableLabel ? (' · ' + esc(tableLabel)) : '') + '</span></div>' +
    '<div class="att-step-field"><span class="att-step-field-label">摘要</span><span class="att-step-field-value att-step-output">' + esc(event.safe_summary || "—") + '</span></div>' +
    (duration ? '<div class="att-step-field"><span class="att-step-field-label">耗时</span><span class="att-step-field-value att-event-meta">' + esc(duration) + '</span></div>' : '') +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderRealEvents(events, counts) {
  var container = document.getElementById("agent-tool-trace-body");
  if (!container) return;

  // Sort by created_at desc, take up to 6
  var sorted = events.slice().sort(function (a, b) {
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  var top = sorted.slice(0, 6);

  var html = '<div class="att-timeline">';
  for (var i = 0; i < top.length; i++) {
    html += renderEventCard(top[i], i, top.length);
  }
  html += '</div>';

  html += '<div class="att-event-counts">审计轨迹示例 · 最近 ' + top.length + ' 条 · ' +
    esc(String(counts.candidates)) + ' candidates / ' + esc(String(counts.evidence)) + ' evidence / ' + esc(String(counts.roles)) + ' roles</div>';

  html += '<div class="att-footer-note">前端只读 · 真实写入需后端双确认 + planNonce · 前端无执行入口</div>';

  container.innerHTML = html;
}

// ── Render ──

function renderHeading(sourceLabel, sourceHint) {
  var headingEl = document.getElementById("agent-tool-trace-heading");
  if (headingEl) {
    headingEl.innerHTML =
      '<h3 class="audit-log-title">Agent 工具轨迹 · ' + esc(sourceLabel) + '</h3>' +
      '<span class="section-source-hint">' + esc(sourceHint) + '</span>';
  }
}

function renderFallbackError() {
  var container = document.getElementById("agent-tool-trace-body");
  if (container) container.innerHTML = '<div class="sr-loading">数据暂不可用</div>';
}

// ── Init ──

export function initAgentToolTrace() {
  var section = document.getElementById("agent-tool-trace-section");
  if (!section) return;

  // Fire both APIs; render whichever resolves first with data
  var eventsPromise = fetch("/api/work-events")
    .then(function (r) { return r.json(); })
    .catch(function () { return null; });

  var overviewPromise = fetch("/api/competition/overview")
    .then(function (r) { return r.json(); })
    .catch(function () { return null; });

  Promise.all([eventsPromise, overviewPromise]).then(function (results) {
    var eventsData = results[0];
    var overviewData = results[1];

    var counts = {
      candidates: overviewData ? (overviewData.candidateCount ?? overviewData.totalCandidates ?? "—") : "—",
      evidence: overviewData ? (overviewData.evidenceCount ?? overviewData.totalEvidence ?? "—") : "—",
      roles: overviewData ? (overviewData.roleCount ?? overviewData.totalRoles ?? "—") : "—",
    };

    var hasEvents = eventsData && Array.isArray(eventsData) && eventsData.length > 0;

    // Detect demo vs real: demo events have execution_mode "dry_run", real events are "live_read" or "live_write"
    var isDemo = hasEvents && eventsData.every(function (e) {
      return e.execution_mode === "dry_run" || e.execution_mode === "blocked";
    });

    if (hasEvents) {
      if (isDemo) {
        renderHeading("审计轨迹示例", "安全运行样本 · 来自 /api/work-events + /api/competition/overview");
      } else {
        renderHeading("真实审计轨迹", "来自 /api/work-events + /api/competition/overview");
      }
      renderRealEvents(eventsData, counts);
    } else {
      renderHeading("流程蓝图", "暂无真实事件 · 来自 /api/competition/overview");
      renderBlueprint(counts);
    }
  }).catch(function () {
    renderFallbackError();
  });
}
