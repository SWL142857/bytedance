import {
  STATE_FLOW,
  STATE_LABELS,
  AGENT_DESCRIPTIONS,
  ICON_USERS,
  ICON_FLAG,
  ICON_BOLT,
  ICON_PULSE,
  ICON_SHIELD,
} from "./constants.js";
import {
  esc,
  avatarHtml,
  errorHtml,
} from "./helpers.js";
import { buildSafetySubText, safetyRow } from "./safety-badge.js";

// ── Hero KPI ──

function kpiCardHtml(opts) {
  return '<div class="kpi-card">' +
    '<div class="kpi-icon kpi-icon-' + opts.tone + '">' + opts.icon + '</div>' +
    '<div class="kpi-label">' + esc(opts.label) + '</div>' +
    '<div class="kpi-value">' + esc(opts.value) +
      (opts.suffix ? ('<span class="kpi-value-suffix">' + esc(opts.suffix) + '</span>') : '') +
    '</div>' +
    '<div class="kpi-foot ' + (opts.footTone ? ('kpi-foot-' + opts.footTone) : '') + '">' +
      esc(opts.foot) + '</div>' +
    '</div>';
}

export function renderHero(orgData, eventsData) {
  const grid = document.getElementById("kpi-grid");
  if (!grid) return;

  const pipeline = (orgData && orgData.pipeline) || { stage_counts: [] };
  const stageCounts = Array.isArray(pipeline.stage_counts) ? pipeline.stage_counts : [];
  let totalCandidates = 0;
  for (let i = 0; i < stageCounts.length; i++) {
    totalCandidates += Number(stageCounts[i].count) || 0;
  }
  let pendingDecision = 0;
  for (let j = 0; j < stageCounts.length; j++) {
    if (stageCounts[j].label === "待决策") {
      pendingDecision = Number(stageCounts[j].count) || 0;
      break;
    }
  }

  const agents = (orgData && Array.isArray(orgData.agents)) ? orgData.agents : [];
  let workingCount = 0;
  let idleCount = 0;
  let blockedCount = 0;
  for (let k = 0; k < agents.length; k++) {
    const s = agents[k].status;
    if (s === "工作中") workingCount++;
    else if (s === "需要人工处理") workingCount++;
    else if (s === "阻塞") blockedCount++;
    else idleCount++;
  }

  const events = Array.isArray(eventsData) ? eventsData : [];
  let blockedEvents = 0;
  let dryRunEvents = 0;
  for (let m = 0; m < events.length; m++) {
    if (events[m].execution_mode === "blocked") blockedEvents++;
    if (events[m].execution_mode === "dry_run") dryRunEvents++;
  }

  const safety = (orgData && orgData.safety) || {};
  const safetyOk = safety.read_only === true && safety.real_writes === false &&
    safety.external_model_calls === false;

  let html = "";
  html += kpiCardHtml({
    tone: "brand", icon: ICON_USERS,
    label: "流水线候选人",
    value: totalCandidates, suffix: "人",
    foot: "当前阶段分布 · 追踪 " + stageCounts.length + " 个流程状态",
  });
  html += kpiCardHtml({
    tone: "warning", icon: ICON_FLAG,
    label: "等待人工决策",
    value: pendingDecision, suffix: "人",
    foot: pendingDecision > 0 ? "请操作员尽快确认" : "暂无待决策",
    footTone: pendingDecision > 0 ? "warning" : "",
  });
  html += kpiCardHtml({
    tone: "purple", icon: ICON_BOLT,
    label: "在岗虚拟员工",
    value: agents.length || 5, suffix: "位",
    foot: workingCount + " 位工作中 · " + blockedCount + " 位阻塞",
    footTone: blockedCount > 0 ? "warning" : "success",
  });
  html += kpiCardHtml({
    tone: "info", icon: ICON_PULSE,
    label: "今日协作活动",
    value: events.length,
    foot: dryRunEvents + " 次干跑 · " + blockedEvents + " 次阻断",
  });
  html += kpiCardHtml({
    tone: safetyOk ? "success" : "warning", icon: ICON_SHIELD,
    label: "组织安全状态",
    value: safetyOk ? "安全" : "需复核",
    foot: "只读模式 · 写入需人工",
    footTone: safetyOk ? "success" : "warning",
  });

  grid.innerHTML = html;
}

// ── Org Overview ──

function statusClassFor(status) {
  if (status === "工作中") return "agent-status-active";
  if (status === "需要人工处理") return "agent-status-human";
  if (status === "阻塞") return "agent-status-blocked";
  return "agent-status-idle";
}

export function renderOrgOverview(data, eventsData) {
  const el = document.getElementById("org-overview-container");
  if (!el) return;
  if (!data || !Array.isArray(data.agents)) {
    el.innerHTML = errorHtml();
    return;
  }

  const events = Array.isArray(eventsData) ? eventsData : [];
  const countsByAgent = {};
  const blockedByAgent = {};
  for (let i = 0; i < events.length; i++) {
    const name = events[i].agent_name;
    if (!name) continue;
    countsByAgent[name] = (countsByAgent[name] || 0) + 1;
    if (events[i].execution_mode === "blocked") {
      blockedByAgent[name] = (blockedByAgent[name] || 0) + 1;
    }
  }

  let html = '<div class="org-overview-grid">';
  html += '<div class="org-agents-grid">';
  for (let j = 0; j < data.agents.length; j++) {
    const a = data.agents[j];
    const statusCls = "agent-status " + statusClassFor(a.status);
    const role = AGENT_DESCRIPTIONS[a.agent_name] || (a.role_label || "");
    const count = countsByAgent[a.agent_name] || 0;
    const blocked = blockedByAgent[a.agent_name] || 0;

    html += '<div class="agent-card">';
    html += '<div class="agent-card-head">';
    html += avatarHtml(a.agent_name);
    html += '<div class="agent-card-meta-top">';
    html += '<div class="agent-card-name">' + esc(a.agent_name) + '</div>';
    html += '<div class="agent-card-role">' + esc(role) + '</div>';
    html += '</div>';
    html += '<span class="' + statusCls + '"><span class="agent-status-dot"></span>' +
      esc(a.status) + '</span>';
    html += '</div>';
    html += '<div class="agent-card-summary">' + esc(a.last_event_summary || "暂无活动记录") + '</div>';
    html += '<div class="agent-card-foot">';
    html += '<span class="agent-card-foot-item">活动 <strong>' + count + '</strong> 次</span>';
    html += '<span class="agent-card-foot-item">阻塞 <strong>' + blocked + '</strong></span>';
    html += '<span class="agent-card-foot-item" style="margin-left:auto">' +
      (a.duration_ms != null ? '上次耗时 <strong>' + a.duration_ms + ' ms</strong>' : '—') +
      '</span>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  if (data.safety) {
    html += '<div class="org-safety">';
    html += '<div class="org-safety-title">组织安全状态</div>';
    html += '<div class="org-safety-sub">' + esc(buildSafetySubText(data)) + '</div>';
    html += '<div class="safety-rows">';
    html += safetyRow("只读模式", data.safety.read_only);
    html += safetyRow("真实写入", data.safety.real_writes);
    html += safetyRow("外部模型调用", data.safety.external_model_calls);
    html += safetyRow("演示模式", data.safety.demo_mode);
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  el.innerHTML = html;
}

// ── Pipeline Funnel ──

export function renderPipeline(data, orgData) {
  const container = document.getElementById("pipeline-container");
  if (!container) return;

  let finalIdx = STATE_FLOW.indexOf(data.finalStatus);
  if (finalIdx === -1) finalIdx = STATE_FLOW.length - 1;

  const stageCounts = (orgData && orgData.pipeline && Array.isArray(orgData.pipeline.stage_counts))
    ? orgData.pipeline.stage_counts : [];
  let total = 0;
  for (let ci = 0; ci < stageCounts.length; ci++) {
    total += Number(stageCounts[ci].count) || 0;
  }

  let html = '<div class="flow-wrapper"><div class="flow-track">';

  for (let i = 0; i < STATE_FLOW.length; i++) {
    const reached = i <= finalIdx;
    const current = i === finalIdx && data.completed;
    const cls = "flow-stage" + (current ? " is-current" : reached ? " is-reached" : "");
    const label = STATE_LABELS[STATE_FLOW[i]] || STATE_FLOW[i];
    const count = stageCounts[i] ? (Number(stageCounts[i].count) || 0) : 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;

    html += '<div class="' + cls + '">';
    html += '<div class="flow-stage-pill">' + esc(label) + '</div>';
    html += '<div class="flow-stage-count">' + count + '</div>';
    html += '<div class="flow-stage-bar"><div class="flow-stage-bar-fill" style="width:' + pct + '%"></div></div>';
    html += '<div class="flow-stage-pct">占比 ' + pct + '%</div>';
    html += '</div>';

    if (i < STATE_FLOW.length - 1) {
      html += '<div class="flow-arrow">›</div>';
    }
  }

  html += '</div></div>';

  html += '<div class="pipeline-meta">';
  html += '<div class="meta-chip"><span class="meta-label">最终状态</span>' +
    '<span class="meta-value ' + (data.completed ? 'is-success' : '') + '">' +
    esc(STATE_LABELS[data.finalStatus] || data.finalStatus) + '</span></div>';
  html += '<div class="meta-chip"><span class="meta-label">是否完成</span>' +
    '<span class="meta-value ' + (data.completed ? 'is-success' : 'is-error') + '">' +
    (data.completed ? '是' : '否') + '</span></div>';
  html += '<div class="meta-chip"><span class="meta-label">命令总数</span>' +
    '<span class="meta-value">' + data.commandCount + '</span></div>';
  html += '<div class="meta-chip"><span class="meta-label">写入计划</span>' +
    '<span class="meta-value">已生成 ' + data.commandCount + ' 条</span></div>';
  if (data.failedAgent) {
    html += '<div class="meta-chip"><span class="meta-label">失败 Agent</span>' +
      '<span class="meta-value is-error">' + esc(data.failedAgent) + '</span></div>';
  }
  html += '</div>';

  container.innerHTML = html;
}
