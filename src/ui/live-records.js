import { esc, fetchJson, errorHtml } from "./helpers.js";

export function renderLiveBaseStatus(data) {
  const el = document.getElementById("live-base-status");
  if (!el) return;
  const hint = document.getElementById("live-data-hint");

  if (data && data.readEnabled && data.blockedReasons && data.blockedReasons.length === 0) {
    el.innerHTML =
      '<div class="live-status-ok">' +
      '<span class="live-status-icon ok">&#10003;</span>' +
      '<span class="live-status-text"><strong>飞书已连接</strong> &middot; 实时只读模式，所有写入已禁用</span>' +
      "</div>";
    if (hint) hint.textContent = "飞书 Base 实时数据 · 只读模式";
  } else {
    const reasons = (data && data.blockedReasons) ? data.blockedReasons : ["飞书连接未配置"];
    const reasonItems = reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("");
    el.innerHTML =
      '<div class="live-status-blocked">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<span class="live-status-icon blocked">&#10007;</span>' +
      '<span class="live-status-text"><strong>飞书未连接</strong> &middot; 只读未启用</span>' +
      "</div>" +
      '<ul class="live-status-reasons">' + reasonItems + "</ul>" +
      "</div>";
    if (hint) hint.textContent = "请配置 LARK_APP_ID / LARK_APP_SECRET / BASE_APP_TOKEN 并设置 HIRELOOP_ALLOW_LARK_READ=1";
  }
}

export function renderLiveRecords(containerId, records, title, colName, colMeta, colExtra, options) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const onRowClick = options && typeof options.onRowClick === "function" ? options.onRowClick : null;
  if (!records || records.length === 0) {
    el.innerHTML = '<div class="live-card-empty">暂无数据</div>';
    return;
  }
  const head =
    '<div class="live-card-head">' +
    '<span class="live-card-head-title">' + esc(title) + "</span>" +
    '<span class="live-card-head-count">' + esc(String(records.length)) + "</span>" +
    "</div>";
  let rows = "";
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const rawName = String(r[colName] || "");
    const name = esc(rawName);
    const meta = (colMeta || []).map(function (k) {
      const v = r[k];
      if (v === null || v === undefined || v === "") return "";
      return '<span class="live-record-meta-item">' + esc(String(v)) + "</span>";
    }).filter(Boolean).join(" &middot; ");
    const extra = colExtra ? colExtra(r) : "";
    let btns = "";
    if (r.link && r.link.available && r.link.link_id) {
      btns +=
        '<button type="button" class="live-open-btn" data-link-id="' +
        esc(String(r.link.link_id)) +
        '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> 打开飞书</button>';
    }
    rows +=
      '<div class="live-record-row" data-link-id="' + esc(String(r.link && r.link.link_id || "")) + '">' +
      '<div class="live-record-info">' +
      '<span class="live-record-name">' + name + "</span>" +
      '<span class="live-record-meta">' + meta + extra + "</span>" +
      "</div>" +
      '<div class="live-record-actions">' + btns + "</div>" +
      "</div>";
  }
  el.innerHTML =
    '<div class="live-card-panel">' + head + '<div class="live-card-body">' + rows + "</div></div>";

  const openBtns = el.querySelectorAll(".live-open-btn");
  for (let b = 0; b < openBtns.length; b++) {
    openBtns[b].addEventListener("click", function (ev) {
      ev.stopPropagation();
      const linkId = ev.currentTarget.getAttribute("data-link-id");
      window._hireloopOpenFeishu(linkId);
    });
  }

  if (!onRowClick) return;

  const rows_all = el.querySelectorAll(".live-record-row");
  for (let r2 = 0; r2 < rows_all.length; r2++) {
    rows_all[r2].addEventListener("click", function (ev) {
      if (ev.target.closest("button")) return; // don't intercept button clicks
      const linkId = ev.currentTarget.getAttribute("data-link-id");
      const candidateData = records.find(function (rec) {
        return rec.link && rec.link.link_id === linkId;
      });
      if (linkId && candidateData) {
        onRowClick(linkId, candidateData);
      }
    });
  }
}

export function loadLiveData() {
  fetchJson("/api/live/base-status")
    .then(function (status) {
      renderLiveBaseStatus(status);
      if (status && status.readEnabled && status.blockedReasons && status.blockedReasons.length === 0) {
        Promise.all([
          fetchJson("/api/live/records?table=candidates"),
          fetchJson("/api/live/records?table=jobs"),
        ]).then(function (results) {
          const candData = results[0];
          const jobData = results[1];
          renderLiveRecords(
            "live-candidates",
            (candData && candData.records) || [],
            "候选人",
            "display_name",
            ["status", "job_display"],
            function (r) {
              let tags = "";
              if (r.resume_available) tags += '<span class="live-record-tag resume">有简历</span>';
              if (r.screening_recommendation) tags += '<span class="live-record-tag">' + esc(r.screening_recommendation) + "</span>";
              return tags;
            },
            {
              onRowClick: function (linkId, candidateData) {
                if (window._hireloopOpenCandidateDetail) {
                  window._hireloopOpenCandidateDetail(linkId, candidateData);
                }
              },
            },
          );
          renderLiveRecords(
            "live-jobs",
            (jobData && jobData.records) || [],
            "岗位",
            "title",
            ["department", "level", "status", "owner"],
            null,
          );
        }).catch(function () {
          const grid = document.getElementById("live-grid");
          if (grid) grid.innerHTML = errorHtml();
        });
      } else {
        const grid = document.getElementById("live-grid");
        if (grid) grid.innerHTML =
          '<div class="live-card-empty" style="grid-column:1/-1">飞书连接未就绪，实时数据暂不可用</div>';
      }
    })
    .catch(function () {
      renderLiveBaseStatus(null);
      const grid = document.getElementById("live-grid");
      if (grid) grid.innerHTML =
        '<div class="live-card-empty" style="grid-column:1/-1">飞书连接未就绪，实时数据暂不可用</div>';
    });
}

// Expose live Feishu open for dynamically rendered buttons and backward compat with tests.
window._hireloopOpenFeishu = function (linkId) {
  if (!linkId) return;
  window.open("/go/" + encodeURIComponent(linkId), "_blank", "noopener");
};
