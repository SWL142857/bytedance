import { SAFE_ERROR_MSG, UI_MESSAGES } from "./constants.js";
import { esc, badgeHtml, errorHtml } from "./helpers.js";

let _currentLinkId = null;
let _currentCandidate = null;
let _panelEl = null;
let _backdropEl = null;
let _prevFocusEl = null;

// ── DOM setup ──

function ensureDom() {
  if (_backdropEl && _panelEl) return;

  _backdropEl = document.createElement("div");
  _backdropEl.className = "candidate-detail-backdrop";
  _backdropEl.hidden = true;
  _backdropEl.addEventListener("click", closeCandidateDetail);
  document.body.appendChild(_backdropEl);

  _panelEl = document.createElement("aside");
  _panelEl.className = "candidate-detail-panel";
  _panelEl.setAttribute("role", "dialog");
  _panelEl.setAttribute("aria-modal", "true");
  _panelEl.setAttribute("aria-label", "候选人详情");
  _panelEl.hidden = true;
  document.body.appendChild(_panelEl);
}

// ── Zone renderers ──

function renderProfileZone(container) {
  const c = _currentCandidate;
  if (!c) {
    container.innerHTML = '<div class="detail-zone-loading">暂无候选人数据</div>';
    return;
  }
  const status = c.status || "—";
  const recommendation = c.screening_recommendation || "—";
  const jobDisplay = c.job_display || "—";
  const resumeLabel = c.resume_available ? "有简历" : "无简历";
  const openAction = _currentLinkId
    ? '<button type="button" class="detail-action-btn detail-open-feishu-btn" id="detail-open-feishu-btn">打开飞书记录</button>'
    : "";

  container.innerHTML =
    '<div class="detail-zone profile-zone">' +
    '<div class="detail-zone-header-row">' +
    '<div class="detail-zone-title">候选人信息（飞书安全摘要）</div>' +
    openAction +
    '</div>' +
    '<div class="detail-profile-grid">' +
    '<div class="detail-profile-field"><span class="detail-field-label">姓名</span><span class="detail-field-value">' + esc(c.display_name || "—") + '</span></div>' +
    '<div class="detail-profile-field"><span class="detail-field-label">状态</span><span class="detail-field-value">' + badgeHtml(status) + '</span></div>' +
    '<div class="detail-profile-field"><span class="detail-field-label">筛选建议</span><span class="detail-field-value">' + esc(recommendation) + '</span></div>' +
    '<div class="detail-profile-field"><span class="detail-field-label">岗位</span><span class="detail-field-value">' + esc(jobDisplay) + '</span></div>' +
    '<div class="detail-profile-field"><span class="detail-field-label">简历</span><span class="detail-field-value">' + esc(resumeLabel) + '</span></div>' +
    '</div>' +
    '</div>';

  const openBtn = container.querySelector("#detail-open-feishu-btn");
  if (openBtn) {
    openBtn.addEventListener("click", function () {
      window._hireloopOpenFeishu(_currentLinkId);
    });
  }
}

function renderDryRunZone(container) {
  container.innerHTML =
    '<div class="detail-zone dryrun-zone">' +
    '<div class="detail-zone-title">确定性 Agent 预演</div>' +
    '<div class="detail-zone-desc">使用内置确定性模型运行完整 pipeline，不调用外部模型，不写飞书。<br><span style="color:var(--accent-orange)">' + UI_MESSAGES.BOUNDARY_NO_AUTO_HIRE + '</span></div>' +
    '<div class="detail-zone-result" id="detail-dryrun-result"></div>' +
    '<button type="button" class="detail-action-btn" id="detail-dryrun-btn">运行 Agent 预演</button>' +
    '</div>';

  const btn = container.querySelector("#detail-dryrun-btn");
  btn.addEventListener("click", function () {
    runDryRunFromDetail(btn);
  });
}

function renderProviderPreviewZone(container) {
  container.innerHTML =
    '<div class="detail-zone provider-zone">' +
    '<div class="detail-zone-title">Provider Agent 预览</div>' +
    '<div class="detail-zone-desc">使用外部模型运行完整 P3 Provider Pipeline（简历录入 → 信息抽取 → 图谱构建 → 图谱复核 → 面试准备 → HR 协调），需输入确认短语。不写飞书。<br><span style="color:var(--accent-orange)">' + UI_MESSAGES.BOUNDARY_NO_AUTO_HIRE + '</span></div>' +
    '<div class="detail-zone-result" id="detail-provider-result"></div>' +
    '<div class="detail-confirm-row">' +
    '<input type="text" class="detail-confirm-input" id="detail-provider-confirm" placeholder="输入确认短语..." autocomplete="off">' +
    '<button type="button" class="detail-action-btn detail-action-btn-warn" id="detail-provider-btn" disabled>执行 Provider 预览</button>' +
    '</div>' +
    '</div>';

  const input = container.querySelector("#detail-provider-confirm");
  const btn = container.querySelector("#detail-provider-btn");

  input.addEventListener("input", function () {
    btn.disabled = input.value.trim() === "";
  });

  btn.addEventListener("click", function () {
    runProviderPreviewFromDetail(input.value.trim(), btn, input);
  });
}

function renderWritePlanZone(container) {
  container.innerHTML =
    '<div class="detail-zone writeplan-zone">' +
    '<div class="detail-zone-title">写回计划摘要（只读）</div>' +
    '<div class="detail-zone-desc">生成确定性 pipeline 的写入计划，不执行真实写入；需要后端双确认接口才会真正写回到飞书 Candidates / Evaluations / Interview Kits / Agent Runs。<br><span style="color:var(--accent-orange)">' + UI_MESSAGES.BOUNDARY_NO_AUTO_HIRE + '</span></div>' +
    '<div class="detail-zone-result" id="detail-writeplan-result"></div>' +
    '<button type="button" class="detail-action-btn" id="detail-writeplan-btn">生成写回计划摘要</button>' +
    '</div>';

  const btn = container.querySelector("#detail-writeplan-btn");
  btn.addEventListener("click", function () {
    generateWritePlanFromDetail(btn);
  });
}

function renderDeferredQueueZone(container) {
  container.innerHTML =
    '<div class="detail-zone writeplan-zone">' +
    '<div class="detail-zone-title">异步图更新</div>' +
    '<div class="detail-zone-desc">先保存，不立即更新图。该候选人会加入异步队列，后续再按时间窗口集中处理。</div>' +
    '<div class="detail-zone-result" id="detail-deferred-result"></div>' +
    '<button type="button" class="detail-action-btn" id="detail-deferred-btn">加入异步图更新队列</button>' +
    '</div>';

  const btn = container.querySelector("#detail-deferred-btn");
  btn.addEventListener("click", function () {
    enqueueDeferredGraphRefresh(btn);
  });
}

function renderWritePlanResult(data) {
  if (!data) return errorHtml();

  let html = "";
  html += badgeHtml(data.status);
  html += '<div class="writeplan-metrics">';
  html += '<div class="writeplan-metric"><span class="writeplan-metric-label">命令数</span><span class="writeplan-metric-value">' + (data.commandCount != null ? data.commandCount : "—") + '</span></div>';
  html += '<div class="writeplan-metric"><span class="writeplan-metric-label">计划指纹</span><span class="writeplan-metric-value writeplan-nonce">' + esc(data.planNonce || "—") + '</span></div>';
  html += '</div>';

  if (data.blockedReasons && data.blockedReasons.length) {
    html += '<div class="writeplan-blocked">';
    for (let i = 0; i < data.blockedReasons.length; i++) {
      html += '<div class="writeplan-blocked-item">' + esc(String(data.blockedReasons[i])) + '</div>';
    }
    html += '</div>';
  }

  if (data.commands && data.commands.length) {
    html += '<div class="writeplan-commands">';
    html += '<div class="writeplan-commands-title">写入命令列表</div>';
    for (let j = 0; j < data.commands.length; j++) {
      const cmd = data.commands[j];
      html += '<div class="writeplan-cmd">';
      html += '<span class="writeplan-cmd-action">' + esc(cmd.action || "—") + '</span>';
      html += '<span class="writeplan-cmd-table">' + esc(cmd.targetTable || "—") + '</span>';
      html += '<span class="writeplan-cmd-desc">' + esc(cmd.description || "—") + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '<div class="writeplan-summary">' + esc(data.safeSummary || "") + '</div>';
  return html;
}

// ── Actions ──

function runDryRunFromDetail(btnEl) {
  if (!_currentLinkId) return;
  btnEl.disabled = true;
  btnEl.textContent = "运行中...";
  const resultEl = document.getElementById("detail-dryrun-result");
  if (resultEl) resultEl.innerHTML = '<div class="detail-zone-loading">正在运行...</div>';

  fetch("/api/live/candidates/" + encodeURIComponent(_currentLinkId) + "/run-dry-run", { method: "POST" })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      const d = result.data;
      let msg = "";
      if (d && d.status === "success") {
        msg = '<div class="detail-result-ok">Agent 预演完成：' + esc(d.safeSummary || "") + '</div>';
        if (d.snapshotUpdated) msg += '<div class="detail-result-note">运行快照已更新，主面板将自动刷新。</div>';
      } else if (d && d.status === "blocked") {
        msg = '<div class="detail-result-blocked">预演未执行：' + esc(d.safeSummary || "条件不满足。") + '</div>';
      } else {
        msg = '<div class="detail-result-error">预演失败：' + esc((d && d.safeSummary) || "未知错误。") + '</div>';
      }
      if (resultEl) resultEl.innerHTML = msg;
      if (d && d.status === "success" && d.snapshotUpdated) {
        setTimeout(function () { if (window._hireloopReloadAfterRun) window._hireloopReloadAfterRun(); }, 500);
      }
    })
    .catch(function () {
      if (resultEl) resultEl.innerHTML = errorHtml();
    })
    .finally(function () {
      btnEl.disabled = false;
      btnEl.textContent = "运行 Agent 预演";
    });
}

function runProviderPreviewFromDetail(confirmText, btnEl, inputEl) {
  if (!_currentLinkId || !confirmText) return;
  btnEl.disabled = true;
  btnEl.textContent = "执行中...";
  const resultEl = document.getElementById("detail-provider-result");
  if (resultEl) resultEl.innerHTML = '<div class="detail-zone-loading">正在调用外部模型...</div>';

  fetch("/api/live/candidates/" + encodeURIComponent(_currentLinkId) + "/run-provider-agent-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: confirmText }),
  })
    .then(function (res) {
      if (res.status === 403) throw new Error("确认短语错误，拒绝执行。");
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.safeSummary) || SAFE_ERROR_MSG);
        return data;
      });
    })
    .then(function (data) {
      let msg = "";
      if (data.status === "success") {
        msg = '<div class="detail-result-ok">Provider 预览完成：' + esc(data.safeSummary || "") + '</div>';
        if (data.failedAgent) {
          msg += '<div class="detail-result-error">失败节点：' + esc(data.failedAgent) + '</div>';
        }
      } else if (data.status === "blocked") {
        msg = '<div class="detail-result-blocked">预览未执行：' + esc(data.safeSummary || "") + '</div>';
        if (data.blockedReasons && data.blockedReasons.length) {
          msg += '<div class="writeplan-blocked">';
          for (let i = 0; i < data.blockedReasons.length; i++) {
            msg += '<div class="writeplan-blocked-item">' + esc(String(data.blockedReasons[i])) + '</div>';
          }
          msg += '</div>';
        }
      } else {
        msg = '<div class="detail-result-error">预览失败：' + esc((data && data.safeSummary) || SAFE_ERROR_MSG) + '</div>';
        if (data && data.failedAgent) {
          msg += '<div class="detail-result-error">失败节点：' + esc(data.failedAgent) + '</div>';
        }
      }
      if (resultEl) resultEl.innerHTML = msg;
    })
    .catch(function (err) {
      if (resultEl) resultEl.innerHTML = '<div class="detail-result-error">' + esc(err.message || SAFE_ERROR_MSG) + '</div>';
    })
    .finally(function () {
      btnEl.disabled = true;
      btnEl.textContent = "执行 Provider 预览";
      if (inputEl) { inputEl.value = ""; inputEl.dispatchEvent(new Event("input")); }
    });
}

function generateWritePlanFromDetail(btnEl) {
  if (!_currentLinkId) return;
  btnEl.disabled = true;
  btnEl.textContent = "生成中...";
  const resultEl = document.getElementById("detail-writeplan-result");
  if (resultEl) resultEl.innerHTML = '<div class="detail-zone-loading">正在生成写入计划...</div>';

  fetch("/api/live/candidates/" + encodeURIComponent(_currentLinkId) + "/generate-write-plan", { method: "POST" })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (resultEl) resultEl.innerHTML = renderWritePlanResult(data);
    })
    .catch(function () {
      if (resultEl) resultEl.innerHTML = errorHtml();
    })
    .finally(function () {
      btnEl.disabled = false;
      btnEl.textContent = "生成写回计划摘要";
    });
}

function enqueueDeferredGraphRefresh(btnEl) {
  if (!_currentLinkId) return;
  btnEl.disabled = true;
  btnEl.textContent = "暂存中...";
  const resultEl = document.getElementById("detail-deferred-result");
  if (resultEl) resultEl.innerHTML = '<div class="detail-zone-loading">正在加入异步队列...</div>';

  fetch("/api/deferred-queue/candidates/" + encodeURIComponent(_currentLinkId) + "/enqueue-graph-refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: _currentCandidate && _currentCandidate.display_name ? _currentCandidate.display_name : "",
    }),
  })
    .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
    .then(function (result) {
      if (!result.ok) {
        throw new Error((result.data && result.data.error) || SAFE_ERROR_MSG);
      }
      if (resultEl) {
        resultEl.innerHTML = '<div class="detail-result-ok">' + esc(result.data.safeSummary || "已加入异步队列。") + "</div>";
      }
      if (window._hireloopReloadDeferredQueue) {
        window._hireloopReloadDeferredQueue();
      }
    })
    .catch(function (err) {
      if (resultEl) resultEl.innerHTML = '<div class="detail-result-error">' + esc(err.message || SAFE_ERROR_MSG) + "</div>";
    })
    .finally(function () {
      btnEl.disabled = false;
      btnEl.textContent = "加入异步图更新队列";
    });
}

// ── Panel lifecycle ──

export function initCandidateDetail() {
  // noop — panel is created lazily on first open
}

export function openCandidateDetail(linkId, candidateData) {
  ensureDom();
  _currentLinkId = linkId;
  _currentCandidate = candidateData;

  _prevFocusEl = document.activeElement;

  const html =
    '<div class="candidate-detail-header">' +
    '<div class="candidate-detail-title">候选人详情</div>' +
    '<button type="button" class="candidate-detail-close" id="cand-detail-close" aria-label="关闭">&times;</button>' +
    '</div>' +
    '<div class="candidate-detail-body">' +
    '<div id="detail-zone-profile"></div>' +
    '<div id="detail-zone-dryrun"></div>' +
    '<div id="detail-zone-provider"></div>' +
    '<div id="detail-zone-writeplan"></div>' +
    '<div id="detail-zone-deferred"></div>' +
    '</div>';

  _panelEl.innerHTML = html;
  _panelEl.hidden = false;
  _backdropEl.hidden = false;

  requestAnimationFrame(function () {
    _panelEl.classList.add("candidate-detail-open");
    _backdropEl.classList.add("candidate-detail-backdrop-visible");
  });

  // Render zones
  renderProfileZone(document.getElementById("detail-zone-profile"));
  renderDryRunZone(document.getElementById("detail-zone-dryrun"));
  renderProviderPreviewZone(document.getElementById("detail-zone-provider"));
  renderWritePlanZone(document.getElementById("detail-zone-writeplan"));
  renderDeferredQueueZone(document.getElementById("detail-zone-deferred"));

  // Close button
  const closeBtn = document.getElementById("cand-detail-close");
  if (closeBtn) closeBtn.addEventListener("click", closeCandidateDetail);
}

export function closeCandidateDetail() {
  if (!_panelEl || !_backdropEl) return;
  _panelEl.classList.remove("candidate-detail-open");
  _backdropEl.classList.remove("candidate-detail-backdrop-visible");
  setTimeout(function () {
    _panelEl.hidden = true;
    _backdropEl.hidden = true;
    if (_prevFocusEl && _prevFocusEl.focus) _prevFocusEl.focus();
    _prevFocusEl = null;
    _currentLinkId = null;
    _currentCandidate = null;
  }, 240);
}

// Expose for live-records.js click delegation
window._hireloopOpenCandidateDetail = openCandidateDetail;
