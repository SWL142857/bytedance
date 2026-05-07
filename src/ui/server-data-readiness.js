import { esc } from "./helpers.js";

function renderReadiness(competitionData, baseStatus) {
  var container = document.getElementById("server-readiness-body");
  if (!container) return;

  // ── Data source determination ──
  var candidateCount = competitionData ? (competitionData.candidateCount ?? competitionData.totalCandidates ?? 0) : 0;
  var evidenceCount = competitionData ? (competitionData.evidenceCount ?? competitionData.totalEvidence ?? 0) : 0;
  var roleCount = competitionData ? (competitionData.roleCount ?? competitionData.totalRoles ?? 0) : 0;
  var isMirror = competitionData && candidateCount > 100;
  var sourceLabel = isMirror ? "服务器镜像数据" : "演示样本";

  // ── Feishu status ──
  var feishuReadOk = baseStatus ? (baseStatus.readEnabled === true && baseStatus.blockedReasons.length === 0) : false;
  var feishuLabel = feishuReadOk ? "飞书只读已配置" : "飞书只读未配置";
  var feishuCls = feishuReadOk ? "sr-indicator-on" : "sr-indicator-off";

  // ── Write boundary ──
  var writeDisabled = baseStatus ? (baseStatus.writeDisabled !== false) : true;
  var writeLabel = writeDisabled ? "写入关闭，需后端双确认" : "后端写入开关已打开，前端无执行入口";
  var writeCls = writeDisabled ? "sr-indicator-off" : "sr-indicator-warn";

  // ── Graph RAG readiness ──
  var graphReady = candidateCount > 0 && evidenceCount > 0 && roleCount > 0;
  var graphLabel = graphReady ? "Graph RAG 已就绪" : "Graph RAG 数据不足";
  var graphCls = graphReady ? "sr-indicator-on" : "sr-indicator-off";

  // ── Build HTML ──
  var html = "";

  // Top row: source label + three readiness dots
  html += '<div class="sr-top-row">';
  html += '<div class="sr-source-badge">' + esc(sourceLabel) + '</div>';
  html += '<div class="sr-indicators">';
  html += '<span class="sr-indicator ' + graphCls + '"><span class="sr-dot"></span>' + esc(graphLabel) + '</span>';
  html += '<span class="sr-indicator ' + feishuCls + '"><span class="sr-dot"></span>' + esc(feishuLabel) + '</span>';
  html += '<span class="sr-indicator ' + writeCls + '"><span class="sr-dot"></span>' + esc(writeLabel) + '</span>';
  html += '</div>';
  html += '</div>';

  // Metric row
  html += '<div class="sr-metrics">';
  html += '<div class="sr-metric"><span class="sr-metric-value">' + esc(String(candidateCount)) + '</span><span class="sr-metric-label">候选人</span></div>';
  html += '<div class="sr-metric"><span class="sr-metric-value">' + esc(String(evidenceCount)) + '</span><span class="sr-metric-label">证据</span></div>';
  html += '<div class="sr-metric"><span class="sr-metric-value">' + esc(String(roleCount)) + '</span><span class="sr-metric-label">岗位</span></div>';
  html += '<div class="sr-metric"><span class="sr-metric-value">' + (feishuReadOk ? "已连接" : "未连接") + '</span><span class="sr-metric-label">飞书 Base</span></div>';
  html += '</div>';

  // Bottom row: data flow relationship + next action
  html += '<div class="sr-bottom-row">';
  html += '<span class="sr-flow-text">Graph RAG 数据 → Agent 工具轨迹 → Analytics 周报</span>';
  html += '<span class="sr-next-action">下一步：<a href="#analytics-report-section" class="sr-next-link">生成 Analytics 周报计划</a></span>';
  html += '</div>';

  container.innerHTML = html;
}

export function initServerDataReadiness() {
  var section = document.getElementById("server-data-readiness-section");
  if (!section) return;

  var bodyEl = document.getElementById("server-readiness-body");
  if (!bodyEl) return;

  Promise.all([
    fetch("/api/competition/overview").then(function (r) { return r.json(); }).catch(function () { return null; }),
    fetch("/api/live/base-status").then(function (r) { return r.json(); }).catch(function () { return null; }),
  ]).then(function (results) {
    renderReadiness(results[0], results[1]);
  }).catch(function () {
    if (bodyEl) bodyEl.innerHTML = '<div class="sr-loading">数据暂不可用</div>';
  });
}
