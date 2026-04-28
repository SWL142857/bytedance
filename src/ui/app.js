import { setHeaderTime } from "./helpers.js";
import { renderDataSource } from "./safety-badge.js";
import { mountIntroOverlay, mountDrawer } from "./drawer.js";
import { mountLiveCapsule, renderWorkEvents } from "./work-events.js";
import { renderHero, renderOrgOverview, renderPipeline } from "./pipeline.js";
import { renderOperatorTasks } from "./operator-tasks.js";
import {
  consoleHealthState,
  renderDrawerError,
  safeCatch,
  updateConsoleBadge,
  REPORT_DRAWER_MAP,
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

// Expose for backward compat with tests
window._hireloopReloadAfterRun = function () {
  fetch("/api/org/overview")
    .then(function (res) { return res.json(); })
    .then(function (org) {
      renderDataSource(org);
      renderOrgOverview(org, []);
    }).catch(function () {});
  fetch("/api/demo/pipeline")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      renderPipeline(data, null);
    }).catch(function () {});
  fetch("/api/work-events")
    .then(function (res) { return res.json(); })
    .then(function (events) {
      renderWorkEvents(events);
    }).catch(function () {});
};

function load() {
  mountIntroOverlay();
  mountDrawer();
  setHeaderTime();
  setInterval(setHeaderTime, 30000);

  // Live data fetch (fire-and-forget, non-blocking)
  loadLiveData();
  initCandidateDetail();

  Promise.all([
    fetch("/api/org/overview").then(function (r) { return r.json(); }),
    fetch("/api/work-events").then(function (r) { return r.json(); }),
  ]).then(function (results) {
    const orgData = results[0];
    const eventsData = results[1];
    renderDataSource(orgData);
    renderHero(orgData, eventsData);
    renderOrgOverview(orgData, eventsData);
    renderWorkEvents(eventsData);
    mountLiveCapsule(eventsData);

    fetch("/api/demo/pipeline")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderPipeline(data, orgData); })
      .catch(safeCatch("pipeline-container"));
  }).catch(function () {
    const grid = document.getElementById("kpi-grid");
    if (grid) grid.innerHTML = '<div class="error-msg">信息不可用，请稍后重试</div>';
    const org = document.getElementById("org-overview-container");
    if (org) org.innerHTML = '<div class="error-msg">信息不可用，请稍后重试</div>';
    const ev = document.getElementById("work-events-container");
    if (ev) ev.innerHTML = '<div class="error-msg">信息不可用，请稍后重试</div>';
    const p = document.getElementById("pipeline-container");
    if (p) p.innerHTML = '<div class="error-msg">信息不可用，请稍后重试</div>';
  });

  fetch("/api/operator/tasks")
    .then(function (res) { return res.json(); })
    .then(renderOperatorTasks)
    .catch(safeCatch("operator-tasks-container"));

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

load();
