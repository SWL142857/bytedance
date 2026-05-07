import { esc, errorHtml, relativeTime } from "./helpers.js";

const KIND_LABELS = {
  search_query: "历史查询",
  operator_request: "需求",
  candidate_graph_refresh: "延迟建图",
  candidate_intake: "候选人暂存",
};

const STATUS_LABELS = {
  pending: "待处理",
  processed: "已处理",
  failed: "失败",
};

function postJson(path, body) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(function (res) {
    return res.json().then(function (data) {
      if (!res.ok) {
        throw new Error((data && data.error) || "请求失败");
      }
      return data;
    });
  });
}

function badgeCls(status) {
  if (status === "processed") return "queue-badge processed";
  if (status === "failed") return "queue-badge failed";
  return "queue-badge pending";
}

function renderQueueSummary(data) {
  var el = document.getElementById("deferred-queue-summary");
  if (!el) return;
  if (!data) {
    el.innerHTML = errorHtml();
    return;
  }

  var pending = data.pending || 0;
  var queryCount = (data.items || []).filter(function (item) { return item.kind === "search_query"; }).length;
  var syncableCount = (data.items || []).filter(function (item) {
    return item.kind !== "search_query" && item.status === "pending";
  }).length;

  el.innerHTML =
    '<div class="deferred-summary-grid">' +
    '<div class="deferred-summary-card"><span class="deferred-summary-value">' + esc(String(queryCount)) + '</span><span class="deferred-summary-label">历史查询</span></div>' +
    '<div class="deferred-summary-card"><span class="deferred-summary-value">' + esc(String(syncableCount)) + '</span><span class="deferred-summary-label">待处理暂存</span></div>' +
    '<div class="deferred-summary-card"><span class="deferred-summary-value">' + esc(String(pending)) + '</span><span class="deferred-summary-label">总待处理</span></div>' +
    '<div class="deferred-summary-card"><span class="deferred-summary-value">' + esc(String(data.processed || 0)) + '</span><span class="deferred-summary-label">已处理</span></div>' +
    "</div>";
}

function renderQueryHistory(data) {
  var el = document.getElementById("deferred-query-history");
  if (!el) return;
  if (!data || !Array.isArray(data.items)) {
    el.innerHTML = errorHtml();
    return;
  }
  var queries = data.items.filter(function (item) { return item.kind === "search_query"; }).slice(0, 8);
  if (!queries.length) {
    el.innerHTML = '<div class="live-card-empty">还没有历史查询。你在上方搜索后会自动保存到这里。</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < queries.length; i++) {
    var item = queries[i];
    html += '<div class="deferred-item query-history">';
    html += '<div class="deferred-item-head">';
    html += '<span class="' + badgeCls(item.status) + '">' + esc(STATUS_LABELS[item.status] || item.status) + '</span>';
    html += '<span class="deferred-item-kind">' + esc(KIND_LABELS[item.kind] || item.kind) + '</span>';
    html += '<span class="deferred-item-time">' + esc(relativeTime(item.created_at)) + '</span>';
    html += '</div>';
    html += '<div class="deferred-item-title">' + esc(item.safe_label || "未命名查询") + '</div>';
    html += '<div class="deferred-item-summary">' + esc(item.safe_summary || "") + '</div>';
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderSyncList(data) {
  var el = document.getElementById("deferred-queue-list");
  if (!el) return;
  if (!data || !Array.isArray(data.items)) {
    el.innerHTML = errorHtml();
    return;
  }
  var syncable = data.items.filter(function (item) { return item.kind !== "search_query"; }).slice(0, 6);
  if (!syncable.length) {
    el.innerHTML = '<div class="live-card-empty">当前没有需要处理的暂存数据项。</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < syncable.length; i++) {
    var item = syncable[i];
    html += '<div class="deferred-item">';
    html += '<div class="deferred-item-head">';
    html += '<span class="' + badgeCls(item.status) + '">' + esc(STATUS_LABELS[item.status] || item.status) + '</span>';
    html += '<span class="deferred-item-kind">' + esc(KIND_LABELS[item.kind] || item.kind) + '</span>';
    html += '<span class="deferred-item-time">' + esc(relativeTime(item.created_at)) + '</span>';
    html += '</div>';
    html += '<div class="deferred-item-title">' + esc(item.safe_label || "未命名项") + '</div>';
    html += '<div class="deferred-item-summary">' + esc(item.safe_summary || "") + '</div>';
    if (item.result_summary) {
      html += '<div class="deferred-item-result">' + esc(item.result_summary) + '</div>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
}

export function loadDeferredQueue() {
  return fetch("/api/deferred-queue")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      renderQueueSummary(data);
      renderQueryHistory(data);
      renderSyncList(data);
      return data;
    })
    .catch(function () {
      renderQueueSummary(null);
      renderQueryHistory(null);
      renderSyncList(null);
      return null;
    });
}

function bindProcessButton() {
  var btn = document.getElementById("deferred-process-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var resultEl = document.getElementById("deferred-process-result");
    btn.disabled = true;
    btn.textContent = "处理中...";
    if (resultEl) {
      resultEl.innerHTML = '<div class="detail-zone-loading">正在处理本地暂存数据...</div>';
    }
    postJson("/api/deferred-queue/process", {})
      .then(function (data) {
        if (resultEl) {
          var extra = data.snapshotUpdated
            ? '<div class="detail-result-note">最新本地运行快照已更新，主面板将自动刷新；未写入飞书 Base。</div>'
            : "";
          resultEl.innerHTML = '<div class="detail-result-ok">' + esc(data.safeSummary || "处理完成。") + "</div>" + extra;
        }
        loadDeferredQueue().then(function () {
          if (window._hireloopReloadAfterRun && data.snapshotUpdated) {
            window._hireloopReloadAfterRun();
          }
        });
      })
      .catch(function (err) {
        if (resultEl) {
          resultEl.innerHTML = '<div class="detail-result-error">' + esc(err.message || "处理失败") + "</div>";
        }
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "处理本地暂存";
      });
  });
}

export function saveSearchHistory(query, searchData) {
  var trimmed = (query || "").trim();
  if (!trimmed) {
    return Promise.resolve(null);
  }
  var topCandidateIds = Array.isArray(searchData && searchData.candidates)
    ? searchData.candidates.slice(0, 5).map(function (item) { return item.candidateId; }).filter(Boolean)
    : [];
  return postJson("/api/deferred-queue/search-query", {
    query: trimmed,
    resultSummary: searchData && searchData.safeSummary ? searchData.safeSummary : "",
    topCandidateIds: topCandidateIds,
  }).then(function (data) {
    return loadDeferredQueue().then(function () { return data; });
  }).catch(function () {
    return null;
  });
}

export function initDeferredQueueUi() {
  bindProcessButton();
  loadDeferredQueue();
}

if (typeof window !== "undefined") {
  window._hireloopReloadDeferredQueue = loadDeferredQueue;
}
