import { esc } from "./helpers.js";
import { AGENT_NODES, RETIRED_AGENT_NAMES } from "./constants.js";

// ── Virtual Org Relay Status ──
// Derived from /api/org/overview and /api/work-events.
// Shows which agents have been active, their last status, and the relay flow.
// No fake data — if API has no data, shows "等待运行快照 / 暂无事件".

function statusLabel(status) {
  if (status === "工作中") return "活跃";
  if (status === "需要人工处理") return "需确认";
  if (status === "阻塞") return "阻塞";
  return "待命";
}

function statusDotClass(status) {
  if (status === "工作中") return "dot-active";
  if (status === "需要人工处理") return "dot-human";
  if (status === "阻塞") return "dot-blocked";
  return "dot-idle";
}

function relaySummaryClass(status) {
  if (status === "工作中") return "active";
  if (status === "阻塞") return "blocked";
  return "idle";
}

export function renderOrgRelay(orgData, eventsData) {
  var el = document.getElementById("org-relay-container");
  if (!el) return;

  // Build agent status map from org overview
  var agentStatusMap = {};
  if (orgData && Array.isArray(orgData.agents)) {
    for (var i = 0; i < orgData.agents.length; i++) {
      agentStatusMap[orgData.agents[i].agent_name] = orgData.agents[i];
    }
  }

  // Count events per agent from work-events
  var events = Array.isArray(eventsData) ? eventsData : [];
  var eventCounts = {};
  var latestEventSummary = {};
  for (var j = 0; j < events.length; j++) {
    var name = events[j].agent_name;
    if (!name || RETIRED_AGENT_NAMES.indexOf(name) !== -1) continue;
    eventCounts[name] = (eventCounts[name] || 0) + 1;
    if (!latestEventSummary[name]) {
      latestEventSummary[name] = events[j].safe_summary || "";
    }
  }

  // Count active/blocked/idle agents
  var activeCount = 0, blockedCount = 0, idleCount = 0, humanCount = 0;
  for (var k = 0; k < AGENT_NODES.length; k++) {
    var s = (agentStatusMap[AGENT_NODES[k].name] || {}).status || "空闲";
    if (s === "工作中") activeCount++;
    else if (s === "需要人工处理") humanCount++;
    else if (s === "阻塞") blockedCount++;
    else idleCount++;
  }

  var currentAgentEventCount = 0;
  for (var ec = 0; ec < Object.keys(eventCounts).length; ec++) {
    currentAgentEventCount += eventCounts[Object.keys(eventCounts)[ec]];
  }

  var html = '<div class="org-relay-strip">';

  // Summary bar
  html += '<div class="org-relay-summary">';
  html += '<div class="org-relay-summary-item"><span class="org-relay-summary-val active">' + activeCount + '</span><span class="org-relay-summary-lbl">活跃 Agent</span></div>';
  html += '<div class="org-relay-summary-item"><span class="org-relay-summary-val human">' + humanCount + '</span><span class="org-relay-summary-lbl">待人工确认</span></div>';
  html += '<div class="org-relay-summary-item"><span class="org-relay-summary-val blocked">' + blockedCount + '</span><span class="org-relay-summary-lbl">阻塞</span></div>';
  html += '<div class="org-relay-summary-item"><span class="org-relay-summary-val idle">' + idleCount + '</span><span class="org-relay-summary-lbl">待命中</span></div>';
  html += '</div>';

  // Agent relay flow
  html += '<div class="org-relay-flow">';
  for (var m = 0; m < AGENT_NODES.length; m++) {
    var def = AGENT_NODES[m];
    var apiAgent = agentStatusMap[def.name] || {};
    var status = apiAgent.status || "空闲";
    var dotCls = "org-relay-dot " + statusDotClass(status);
    var summary = latestEventSummary[def.name] || apiAgent.last_event_summary || "暂无运行快照";
    var count = eventCounts[def.name] || 0;

    var isLast = m === AGENT_NODES.length - 1;

    html += '<div class="org-relay-node">';
    html += '<div class="org-relay-node-top">';
    html += '<span class="' + dotCls + '"></span>';
    html += '<span class="org-relay-node-name">' + esc(def.name) + '</span>';
    html += '<span class="org-relay-node-status">' + esc(statusLabel(status)) + '</span>';
    html += '</div>';
    html += '<div class="org-relay-node-summary">' + esc(summary) + '</div>';
    html += '<div class="org-relay-node-meta">';
    html += esc(def.role.split("·")[0].trim());
    html += ' · ' + count + ' 次事件';
    html += '</div>';
    html += '</div>';

    if (!isLast) {
      html += '<div class="org-relay-arrow">→</div>';
    }
  }
  html += '</div>';

  // Empty state
  if (!currentAgentEventCount) {
    html += '<div class="org-relay-note">等待运行快照 — 尚无协作事件。启动 pipeline 后，Agent 接力状态将在此展示。</div>';
  }

  html += '</div>'; // org-relay-strip

  el.innerHTML = html;
}
