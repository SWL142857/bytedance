import { setHeaderTime } from "./helpers.js";
import { mountIntroOverlay } from "./drawer.js";
import { mountLiveCapsule, renderWorkEvents } from "./work-events.js";
import { renderPipeline } from "./pipeline.js";
import { setupAgentDrawer } from "./agent-cards.js";
import { renderOperatorTasks } from "./operator-tasks.js";
import { initGraphRagSearch } from "./graph-rag.js";
import { renderOrgRelay } from "./org-relay.js";
import { mountRelayPlayer } from "./agent-relay-player.js";
import {
  safeCatch,
  updateConsoleBadge,
  renderReleaseGate,
  renderApiAudit,
  renderPreApiFreeze,
  renderLiveReadiness,
  renderProviderReadiness,
  renderProviderSmoke,
  renderProviderAgentDemo,
} from "./reports.js";
import { loadLiveData } from "./live-records.js";
import { initCandidateDetail } from "./candidate-detail.js";
import { initDeferredQueueUi } from "./async-queue.js";
import { initAnalyticsReportPanel } from "./analytics-report.js";
import { initServerDataReadiness } from "./server-data-readiness.js";
import { initAgentToolTrace } from "./agent-tool-trace.js";

// Expose for test backward compat + runtime snapshot refresh
window._hireloopReloadAfterRun = function () {
  fetch("/api/org/overview")
    .then(function (res) { return res.json(); })
    .then(function (org) {
      // Refresh agent drawer data
      setupAgentDrawer(org);
    }).catch(function () {});
  fetch("/api/demo/pipeline")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      fetch("/api/org/overview")
        .then(function (r) { return r.json(); })
        .then(function (org) { renderPipeline(data, org); })
        .catch(function () { renderPipeline(data, null); });
    }).catch(function () {});
  fetch("/api/work-events")
    .then(function (res) { return res.json(); })
    .then(renderWorkEvents).catch(function () {});
};

function updateFeishuHeaderStatus(status) {
  var el = document.getElementById("header-feishu-status");
  var openBtn = document.getElementById("header-open-feishu-btn");
  if (status && status.readEnabled && status.blockedReasons && status.blockedReasons.length === 0) {
    if (el) {
      el.className = "header-feishu-status online";
      el.querySelector("span:last-child").textContent = "飞书已连接";
    }
  } else if (status && status.readiness === "partial") {
    if (el) {
      el.className = "header-feishu-status offline";
      el.querySelector("span:last-child").textContent = "飞书部分配置";
    }
  } else {
    if (el) {
      el.className = "header-feishu-status offline";
      el.querySelector("span:last-child").textContent = "飞书未连接";
    }
  }

  if (openBtn) {
    var canOpen = !!(status && status.feishuWebUrlAvailable);
    openBtn.disabled = !canOpen;
    openBtn.title = canOpen
      ? "打开已配置的飞书 Base 页面"
      : "未配置 FEISHU_BASE_WEB_URL / LARK_BASE_WEB_URL，暂不能从前端直达飞书页面";
  }
}

function updateGraphRagScale(overview) {
  var el = document.getElementById("graph-rag-scale");
  if (!el || !overview) return;
  var candidates = overview.candidateCount ?? overview.totalCandidates;
  var evidence = overview.evidenceCount ?? overview.totalEvidence;
  var roles = overview.roleCount ?? overview.totalRoles;
  if (candidates != null || evidence != null || roles != null) {
    var parts = [];
    if (candidates != null) parts.push("图谱: " + candidates + " 候选人");
    if (evidence != null) parts.push(evidence + " 证据");
    if (roles != null) parts.push(roles + " 岗位");
    el.textContent = parts.join(" · ");
    el.style.display = "";
  }
}

function load() {
  mountIntroOverlay();
  setHeaderTime();
  setInterval(setHeaderTime, 30000);

  // Fire-and-forget
  loadLiveData();
  initCandidateDetail();
  initDeferredQueueUi();
  initServerDataReadiness();
  initAgentToolTrace();
  initAnalyticsReportPanel();

  // Feishu header status
  fetch("/api/live/base-status")
    .then(function (res) { return res.json(); })
    .then(updateFeishuHeaderStatus)
    .catch(function () {});

  var headerFeishuBtn = document.getElementById("header-open-feishu-btn");
  if (headerFeishuBtn) {
    headerFeishuBtn.addEventListener("click", function () {
      if (headerFeishuBtn.disabled) return;
      window.open("/go/base", "_blank", "noopener");
    });
  }

  // Graph RAG overview (for header scale)
  fetch("/api/competition/overview")
    .then(function (res) { return res.json(); })
    .then(updateGraphRagScale)
    .catch(function () {});

  var pipelineRequest = fetch("/api/demo/pipeline").then(function (res) { return res.json(); });
  pipelineRequest
    .then(function (pipelineData) {
      renderPipeline(pipelineData, null);
    })
    .catch(safeCatch("pipeline-tabs"));

  // Main data: org overview + work events + pipeline
  Promise.all([
    fetch("/api/org/overview").then(function (r) { return r.json(); }),
    fetch("/api/work-events").then(function (r) { return r.json(); }),
  ]).then(function (results) {
    var orgData = results[0];
    var eventsData = results[1];

    // Setup agent drawer
    setupAgentDrawer(orgData);

    // Render org relay status
    renderOrgRelay(orgData, eventsData);

    // Render agent relay timeline
    renderWorkEvents(eventsData);

    // Live capsule
    mountLiveCapsule(eventsData);

    // Pipeline + pipeline tabs
    pipelineRequest
      .then(function (pipelineData) {
        renderPipeline(pipelineData, orgData);
        mountRelayPlayer();
      })
      .catch(safeCatch("pipeline-tabs"));
  }).catch(function () {
    var tabs = document.getElementById("pipeline-tabs");
    if (tabs) tabs.innerHTML = '<div class="error-msg">信息不可用，请稍后重试</div>';
    var ev = document.getElementById("work-events-container");
    if (ev) ev.innerHTML = '<div class="error-msg">信息不可用，请稍后重试</div>';
  });

  // Init Graph RAG search (loads default candidate grid)
  initGraphRagSearch();

  // Operator tasks
  fetch("/api/operator/tasks")
    .then(function (res) { return res.json(); })
    .then(renderOperatorTasks)
    .catch(safeCatch("operator-tasks-container"));

  // System console drawer (reports)
  setupConsoleDrawer();

  // Report data for drawer
  fetch("/api/reports/release-gate")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderReleaseGate(d); updateConsoleBadge(); })
    .catch(safeCatch("release-gate-content"));
  fetch("/api/reports/api-boundary-audit")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderApiAudit(d); updateConsoleBadge(); })
    .catch(safeCatch("api-audit-content"));
  fetch("/api/reports/pre-api-freeze")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderPreApiFreeze(d); updateConsoleBadge(); })
    .catch(safeCatch("pre-api-freeze-content"));
  fetch("/api/reports/live-readiness")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderLiveReadiness(d); updateConsoleBadge(); })
    .catch(safeCatch("live-readiness-content"));
  fetch("/api/reports/provider-readiness")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderProviderReadiness(d); updateConsoleBadge(); })
    .catch(safeCatch("provider-readiness-content"));
  fetch("/api/reports/provider-smoke")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderProviderSmoke(d); updateConsoleBadge(); })
    .catch(safeCatch("provider-smoke-content"));
  fetch("/api/reports/provider-agent-demo")
    .then(function (res) { return res.json(); })
    .then(function (d) { renderProviderAgentDemo(d); updateConsoleBadge(); })
    .catch(safeCatch("provider-agent-demo-content"));
}

function setupConsoleDrawer() {
  // Uses existing drawer.js pattern but with new class names
  var openBtn = document.getElementById("console-open-btn");
  var closeBtn = document.getElementById("console-drawer-close-btn");
  var backdrop = document.getElementById("console-drawer-backdrop");
  var drawer = document.getElementById("console-drawer");

  function openConsole() {
    if (!drawer || !backdrop) return;
    drawer.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(function () {
      drawer.classList.add("open");
      backdrop.classList.add("visible");
    });
  }

  function closeConsole() {
    if (!drawer || !backdrop) return;
    drawer.classList.remove("open");
    backdrop.classList.remove("visible");
    setTimeout(function () {
      drawer.hidden = true;
      backdrop.hidden = true;
    }, 320);
  }

  if (openBtn) openBtn.addEventListener("click", openConsole);
  if (closeBtn) closeBtn.addEventListener("click", closeConsole);
  if (backdrop) backdrop.addEventListener("click", closeConsole);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeConsole();
  });
}

load();
