import {
  PIPELINE_ROW1,
  PIPELINE_ROW2,
  PIPELINE_STAGE_LABELS,
  AGENT_NODES,
} from "./constants.js";
import { esc } from "./helpers.js";

// ── Pipeline Grid (2 rows × 4 columns) ──

var failedAgentStageMap = {
  "resume_intake": "Intake",
  "resume_extraction": "Extraction",
  "graph_builder": "Graph Builder",
  "interview_kit": "Interview Kit",
  "screening_reviewer": "Reviewer",
  "hr_coordinator": "HR Coordinator",
  "analytics": "Analytics"
};

var backendStateMap = {
  "new": "new",
  "parsed": "Intake",
  "screened": "Extraction",
  "interview_kit_ready": "Interview Kit",
  "decision_pending": "decision_pending",
  "offer": "decision_pending",
  "rejected": "decision_pending"
};

var graphRagStages = ["Graph Builder", "Reviewer"];

function resolveFailedStage(data) {
  if (!data.completed && data.failedAgent) {
    return failedAgentStageMap[data.failedAgent] || null;
  }
  return null;
}

function resolveFinalIdx(data) {
  var failedStage = resolveFailedStage(data);
  var actualFinalStage = failedStage || backendStateMap[data.finalStatus] || "decision_pending";
  var fullOrder = PIPELINE_ROW1.concat(PIPELINE_ROW2);
  var idx = fullOrder.indexOf(actualFinalStage);
  if (idx === -1) idx = fullOrder.indexOf("decision_pending");
  if (idx === -1) idx = fullOrder.length - 1;
  return idx;
}

function hasAnalyticsData(orgData) {
  if (!orgData || !Array.isArray(orgData.agents)) return false;
  for (var i = 0; i < orgData.agents.length; i++) {
    var a = orgData.agents[i];
    if (a.agent_name === "数据分析") {
      return hasMeaningfulSummary(a.last_event_summary) || a.status !== "空闲";
    }
  }
  return false;
}

function hasMeaningfulSummary(summary) {
  if (typeof summary !== "string") return false;
  var text = summary.trim();
  return text.length > 0 && text !== "暂无活动" && text !== "暂无运行快照";
}

function agentForStage(stageName) {
  for (var i = 0; i < AGENT_NODES.length; i++) {
    if (PIPELINE_STAGE_LABELS[stageName] === AGENT_NODES[i].name) return AGENT_NODES[i];
  }
  return null;
}

function avatarColorClass(agentId) {
  return "av-titanium";
}

function renderStageCard(stageName, index, data, finalIdx, analyticsAvailable) {
  var label = PIPELINE_STAGE_LABELS[stageName] || stageName;
  var failedStage = resolveFailedStage(data);
  var isFailedHere = failedStage === stageName;
  var isGraphRag = graphRagStages.indexOf(stageName) !== -1;
  var isFeishu = stageName === "new";
  var isHuman = stageName === "decision_pending";
  var isAnalytics = stageName === "Analytics";
  var isAnalyticsReached = isAnalytics && analyticsAvailable;
  var isReached = index <= finalIdx || isAnalyticsReached;
  var isCurrent = index === finalIdx;
  var agent = agentForStage(stageName);

  var cls = "pipeline-card";
  if (isFailedHere) cls += " is-failed";
  else if (isCurrent) cls += " is-active";
  else if (!isReached) cls += " is-pending";
  cls += " anim-tab-" + index;

  var html = '<div class="' + cls + '" data-stage="' + esc(stageName) + '">';

  // Top row: number + label
  html += '<div class="pipeline-card-head">';
  html += '<span class="pipeline-card-num">' + esc(String(index + 1).padStart(2, "0")) + '</span>';
  html += '<span class="pipeline-card-label">' + esc(label) + '</span>';
  html += '</div>';

  // Agent line (if has agent)
  if (agent) {
    html += '<div class="pipeline-card-agent" data-agent-id="' + esc(agent.id) + '" data-agent-name="' + esc(agent.name) + '">';
    html += '<span class="pipeline-card-agent-avatar ' + avatarColorClass(agent.id) + '">' + esc(agent.avatarInitial) + '</span>';
    html += '<span class="pipeline-card-agent-name">' + esc(agent.name) + '</span>';
    html += '</div>';
  } else if (isFeishu) {
    html += '<div class="pipeline-card-source">Feishu Base 数据源</div>';
  } else if (isHuman) {
    html += '<div class="pipeline-card-source" style="color:var(--accent-orange)">人类操作员确认</div>';
  }

  // Status indicator
  html += '<div class="pipeline-card-status">';
  html += '<span class="pipeline-card-dot ' + (isFailedHere ? 'dot-failed' : isCurrent ? 'dot-current' : isReached ? 'dot-reached' : 'dot-pending') + '"></span>';
  if (isFailedHere) html += '<span class="pipeline-card-status-text failed">执行失败</span>';
  else if (isAnalyticsReached) html += '<span class="pipeline-card-status-text reached">已有快照</span>';
  else if (isCurrent && data.completed) html += '<span class="pipeline-card-status-text done">已完成</span>';
  else if (isCurrent) html += '<span class="pipeline-card-status-text active">进行中</span>';
  else if (isReached) html += '<span class="pipeline-card-status-text reached">已到达</span>';
  else html += '<span class="pipeline-card-status-text pending">待执行</span>';
  html += '</div>';

  // Tech badge
  if (isReached) {
    if (isFailedHere) {
      html += '<span class="pipeline-card-badge badge-failed">执行失败</span>';
    } else if (isFeishu) {
      html += '<span class="pipeline-card-badge badge-feishu">真实飞书读取</span>';
    } else if (isGraphRag) {
      html += '<span class="pipeline-card-badge badge-graphrag">Competition Graph RAG</span>';
    } else if (isHuman) {
      html += '<span class="pipeline-card-badge badge-human">等待人工操作</span>';
    } else if (isAnalytics) {
      html += '<span class="pipeline-card-badge badge-plan">持续优化分析</span>';
    } else {
      html += '<span class="pipeline-card-badge badge-plan">运行快照已到达</span>';
    }
  }

  html += '</div>';
  return html;
}

export function renderPipeline(data, orgData) {
  var container = document.getElementById("pipeline-tabs");
  if (!container) return;

  var fullOrder = PIPELINE_ROW1.concat(PIPELINE_ROW2);
  var finalIdx = resolveFinalIdx(data);
  var analyticsAvailable = hasAnalyticsData(orgData);

  // Build stage counts from orgData
  var stageCounts = {};
  var pipeline = (orgData && orgData.pipeline) || {};
  var sc = Array.isArray(pipeline.stage_counts) ? pipeline.stage_counts : [];
  for (var si = 0; si < sc.length; si++) {
    stageCounts[sc[si].label] = sc[si].count;
  }

  var html = '<div class="pipeline-grid">';

  // Row 1
  html += '<div class="pipeline-row">';
  for (var i = 0; i < PIPELINE_ROW1.length; i++) {
    html += renderStageCard(PIPELINE_ROW1[i], i, data, finalIdx, analyticsAvailable);
  }
  html += '</div>';

  // Row 2
  html += '<div class="pipeline-row">';
  for (var j = 0; j < PIPELINE_ROW2.length; j++) {
    html += renderStageCard(PIPELINE_ROW2[j], PIPELINE_ROW1.length + j, data, finalIdx, analyticsAvailable);
  }
  html += '</div>';

  html += '</div>'; // pipeline-grid

  // Meta footer
  html += '<div class="pipeline-meta">';
  html += '<div class="pipeline-meta-chip"><span class="pipeline-meta-label">完成</span><span class="pipeline-meta-value ' + (data.completed ? 'success' : 'error') + '">' + (data.completed ? '是' : '否') + '</span></div>';
  html += '<div class="pipeline-meta-chip"><span class="pipeline-meta-label">最终状态</span><span class="pipeline-meta-value">' + esc(data.finalStatus || "—") + '</span></div>';
  if (data.failedAgent) {
    html += '<div class="pipeline-meta-chip"><span class="pipeline-meta-label">失败节点</span><span class="pipeline-meta-value error">' + esc(data.failedAgent) + '</span></div>';
  }
  html += '<div class="pipeline-meta-chip"><span class="pipeline-meta-label">写入计划</span><span class="pipeline-meta-value">' + (data.commandCount != null ? data.commandCount : "—") + ' 条</span></div>';
  // Show stage_counts from org overview
  for (var si2 = 0; si2 < sc.length; si2++) {
    html += '<div class="pipeline-meta-chip"><span class="pipeline-meta-label">' + esc(sc[si2].label) + '</span><span class="pipeline-meta-value">' + sc[si2].count + '</span></div>';
  }
  html += '</div>';

  container.innerHTML = html;

  // Click handler: open agent drawer
  var agentEls = container.querySelectorAll(".pipeline-card-agent");
  for (var a = 0; a < agentEls.length; a++) {
    agentEls[a].addEventListener("click", function (ev) {
      ev.stopPropagation();
      var agentId = ev.currentTarget.getAttribute("data-agent-id");
      if (window._hireloopOpenAgentDrawer) window._hireloopOpenAgentDrawer(agentId);
    });
  }

  // Meta footer element (for backward compat)
  var metaEl = document.getElementById("pipeline-meta-container");
  if (metaEl) metaEl.innerHTML = "";
}
