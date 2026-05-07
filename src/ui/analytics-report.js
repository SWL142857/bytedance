import { SAFE_ERROR_MSG } from "./constants.js";
import { esc, badgeHtml, errorHtml } from "./helpers.js";

function renderReportPlanResult(data, container) {
  if (!data) {
    container.innerHTML = errorHtml();
    return;
  }

  var html = "";

  // Status badge
  html += '<div class="analytics-plan-status">' + badgeHtml(data.status) + '</div>';

  // Metrics row
  html += '<div class="analytics-plan-metrics">';
  html += '<div class="analytics-plan-metric"><span class="analytics-plan-metric-label">周期</span><span class="analytics-plan-metric-value">' + esc(data.periodStart || "—") + ' ~ ' + esc(data.periodEnd || "—") + '</span></div>';
  html += '<div class="analytics-plan-metric"><span class="analytics-plan-metric-label">候选人</span><span class="analytics-plan-metric-value">' + (data.candidateCount != null ? data.candidateCount : "—") + '</span></div>';
  html += '<div class="analytics-plan-metric"><span class="analytics-plan-metric-label">评估</span><span class="analytics-plan-metric-value">' + (data.evaluationCount != null ? data.evaluationCount : "—") + '</span></div>';
  html += '<div class="analytics-plan-metric"><span class="analytics-plan-metric-label">Agent 运行</span><span class="analytics-plan-metric-value">' + (data.agentRunCount != null ? data.agentRunCount : "—") + '</span></div>';
  html += '<div class="analytics-plan-metric"><span class="analytics-plan-metric-label">命令数</span><span class="analytics-plan-metric-value">' + (data.commandCount != null ? data.commandCount : "—") + '</span></div>';
  html += '</div>';

  // Plan nonce
  html += '<div class="analytics-plan-nonce">';
  html += '<span class="analytics-plan-nonce-label">计划指纹 (planNonce)</span>';
  html += '<span class="analytics-plan-nonce-value">' + esc(data.planNonce || "—") + '</span>';
  html += '</div>';

  // Blocked reasons
  if (data.blockedReasons && data.blockedReasons.length) {
    html += '<div class="analytics-plan-blocked">';
    for (var i = 0; i < data.blockedReasons.length; i++) {
      html += '<div class="analytics-plan-blocked-item">' + esc(String(data.blockedReasons[i])) + '</div>';
    }
    html += '</div>';
  }

  // Commands list
  if (data.commands && data.commands.length) {
    html += '<div class="analytics-plan-commands">';
    html += '<div class="analytics-plan-commands-title">写入计划命令列表（只读）</div>';
    for (var j = 0; j < data.commands.length; j++) {
      var cmd = data.commands[j];
      html += '<div class="analytics-plan-cmd">';
      html += '<span class="analytics-plan-cmd-desc">' + esc(cmd.description || "—") + '</span>';
      html += '<span class="analytics-plan-cmd-table">' + esc(cmd.targetTable || "—") + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  // Safe summary
  html += '<div class="analytics-plan-summary">' + esc(data.safeSummary || "") + '</div>';

  container.innerHTML = html;
}

function appendCompetitionFallback(container) {
  fetch("/api/competition/overview")
    .then(function (res) {
      if (!res.ok) throw new Error(SAFE_ERROR_MSG);
      return res.json();
    })
    .then(function (overview) {
      if (!overview || overview.status !== "ready") return;
      var candidateCount = overview.candidateCount != null ? overview.candidateCount : "—";
      var evidenceCount = overview.evidenceCount != null ? overview.evidenceCount : "—";
      var roleCount = overview.roleCount != null ? overview.roleCount : "—";
      var html = "";
      html += '<div class="analytics-plan-summary">';
      html += '<strong>服务器镜像分析预览（只读降级）</strong>';
      html += '<div>当前真实飞书周报写入计划未生成；已切换为 competition 服务器镜像预览，不执行写入。</div>';
      html += '<div>' + esc(String(candidateCount)) + ' 位候选人 · ' + esc(String(evidenceCount)) + ' 条图谱证据 · ' + esc(String(roleCount)) + ' 个岗位</div>';
      html += '</div>';
      container.insertAdjacentHTML("beforeend", html);
    })
    .catch(function () {
      // Keep the original blocked plan visible; the fallback is best-effort only.
    });
}

function generateReportPlan(btnEl, containerEl) {
  var startInput = document.getElementById("analytics-period-start");
  var endInput = document.getElementById("analytics-period-end");

  btnEl.disabled = true;
  btnEl.textContent = "生成中...";
  containerEl.innerHTML = '<div class="detail-zone-loading">正在生成 Analytics 周报计划...</div>';

  var body = {};
  var periodStart = startInput && startInput.value.trim();
  var periodEnd = endInput && endInput.value.trim();
  if (periodStart) body.periodStart = periodStart;
  if (periodEnd) body.periodEnd = periodEnd;

  fetch("/api/live/analytics/generate-report-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      renderReportPlanResult(data, containerEl);
      if (data && data.status === "blocked") {
        appendCompetitionFallback(containerEl);
      }
    })
    .catch(function () {
      containerEl.innerHTML = errorHtml();
    })
    .finally(function () {
      btnEl.disabled = false;
      btnEl.textContent = "生成报告计划";
    });
}

export function initAnalyticsReportPanel() {
  var section = document.getElementById("analytics-report-section");
  if (!section) return;

  var bodyEl = document.getElementById("analytics-report-body");
  if (!bodyEl) return;

  var btn = document.getElementById("analytics-generate-btn");
  if (!btn) return;

  btn.addEventListener("click", function () {
    generateReportPlan(btn, bodyEl);
  });
}
