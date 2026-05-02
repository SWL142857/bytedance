import { esc } from "./helpers.js";
import { AGENT_NODES, TARGET_TABLE_LABELS, UI_MESSAGES } from "./constants.js";

// ── Agent Drawer Content ──

function statusClassFor(status) {
  if (status === "工作中") return "active";
  if (status === "需要人工处理") return "human";
  if (status === "阻塞") return "blocked";
  return "idle";
}

function statusLabelFor(status) {
  if (status === "工作中") return "工作中";
  if (status === "需要人工处理") return "需人工";
  if (status === "阻塞") return "阻塞";
  return "待命";
}

function avatarColorClass(agentId) {
  return "av-titanium";
}

export function renderAgentDrawer(orgData, highlightAgentId) {
  var list = document.getElementById("drawer-agent-list");
  if (!list) return;

  var agentDataMap = {};
  if (orgData && Array.isArray(orgData.agents)) {
    for (var i = 0; i < orgData.agents.length; i++) {
      agentDataMap[orgData.agents[i].agent_name] = orgData.agents[i];
    }
  }

  var html = "";
  for (var j = 0; j < AGENT_NODES.length; j++) {
    var def = AGENT_NODES[j];
    var apiAgent = agentDataMap[def.name] || {};
    var status = apiAgent.status || "空闲";
    var sCls = "drawer-agent-status " + statusClassFor(status);
    var avCls = "drawer-agent-avatar " + avatarColorClass(def.id);
    var isHighlighted = highlightAgentId === def.id;
    var cardStyle = isHighlighted ? ' style="border-color:var(--accent-blue);box-shadow:0 0 0 2px var(--accent-blue-glow)"' : '';

    html += '<div class="drawer-agent-card"' + cardStyle + '>';
    html += '<div class="drawer-agent-head">';
    html += '<div class="' + avCls + '">' + esc(def.avatarInitial) + '</div>';
    html += '<div class="drawer-agent-info">';
    html += '<div class="drawer-agent-name">' + esc(def.name) + '</div>';
    html += '<div class="drawer-agent-key">' + esc(def.id) + '</div>';
    html += '</div>';
    html += '<span class="' + sCls + '">' + esc(statusLabelFor(status)) + '</span>';
    html += '</div>';

    html += '<div class="drawer-agent-row">';
    html += '<span class="drawer-agent-row-label">职责</span>';
    html += '<span class="drawer-agent-row-value">' + esc(def.role) + '</span>';
    html += '</div>';

    html += '<div class="drawer-agent-row">';
    html += '<span class="drawer-agent-row-label">目标数据表</span>';
    html += '<span class="drawer-agent-row-value">' + esc(TARGET_TABLE_LABELS[def.targetTable] || def.targetTable) + '</span>';
    html += '</div>';

    html += '<div class="drawer-agent-row">';
    html += '<span class="drawer-agent-row-label">运行模式</span>';
    html += '<span class="drawer-agent-row-value">' + esc(def.mode) + '</span>';
    html += '</div>';

    html += '<div class="drawer-agent-summary">' + esc(apiAgent.last_event_summary || "暂无运行快照") + '</div>';

    html += '<div class="drawer-agent-foot">' + UI_MESSAGES.CARD_AUDIT_NOTE + ' · 真实写入需人工确认</div>';
    html += '</div>';
  }

  list.innerHTML = html;
}

// ── Drawer open/close ──

export function openAgentDrawer(orgData, highlightAgentId) {
  renderAgentDrawer(orgData, highlightAgentId);
  var drawer = document.getElementById("agent-drawer");
  var overlay = document.getElementById("drawer-overlay");
  if (drawer) drawer.classList.add("open");
  if (overlay) overlay.classList.add("active");
}

export function closeAgentDrawer() {
  var drawer = document.getElementById("agent-drawer");
  var overlay = document.getElementById("drawer-overlay");
  if (drawer) drawer.classList.remove("open");
  if (overlay) overlay.classList.remove("active");
}

export function setupAgentDrawer(orgData) {
  // Close button
  var closeBtn = document.getElementById("drawer-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", closeAgentDrawer);

  // Overlay click
  var overlay = document.getElementById("drawer-overlay");
  if (overlay) overlay.addEventListener("click", closeAgentDrawer);

  // Expose for pipeline.js click delegation
  window._hireloopOpenAgentDrawer = function (agentId) {
    openAgentDrawer(orgData, agentId);
  };
}
