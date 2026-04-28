import { esc, formatDateTime } from "./helpers.js";

export function buildSafetySubText(data) {
  const ds = data.data_source;
  const safety = data.safety;
  if (ds && ds.mode === "runtime_snapshot" && ds.snapshot_source === "provider") {
    return "当前展示模型运行快照；外部模型调用状态以安全标记为准，界面仍只读，真实写入仍需人工授权。";
  }
  if (ds && ds.mode === "runtime_snapshot") {
    return "当前展示本地运行快照；界面只读，真实写入仍需人工授权。";
  }
  return "当前展示演示样本；界面只读，所有真实写入需要人工授权。";
}

export function safetyRow(label, value) {
  const on = value === true;
  return '<div class="safety-row">' +
    '<span class="safety-row-label">' + esc(label) + '</span>' +
    '<span class="safety-row-value ' + (on ? 'on' : 'off') + '">' + (on ? '开启' : '关闭') + '</span>' +
    '</div>';
}

export function updateModePill(orgData) {
  const el = document.getElementById("mode-pill");
  if (!el) return;
  const ds = orgData && orgData.data_source;
  if (!ds) { el.textContent = "只读"; return; }
  if (ds.mode === "runtime_snapshot") {
    el.textContent = (ds.label || "运行快照") + " · 只读";
  } else {
    el.textContent = "演示模式 · 只读";
  }
}

export function updateFooterMeta(orgData) {
  const el = document.getElementById("footer-meta");
  if (!el) return;
  const ds = orgData && orgData.data_source;
  const redactionLabel = (ds && ds.mode === "runtime_snapshot") ? "运行快照已脱敏" : "演示样本已脱敏";
  let suffix = " · 二〇二六";
  if (ds && ds.mode === "runtime_snapshot" && ds.generated_at) {
    suffix = " · 生成 " + formatDateTime(new Date(ds.generated_at)) + suffix;
  }
  el.textContent = "职链 HireLoop · " + redactionLabel + suffix;
}

export function renderDataSource(orgData) {
  updateModePill(orgData);
  updateFooterMeta(orgData);
}

export function renderSafetySection(safety) {
  if (!safety) return "";
  let html = '<div class="org-safety">';
  html += '<div class="org-safety-title">安全状态</div>';
  html += '<div class="safety-rows">';
  html += safetyRow("只读模式", safety.read_only);
  html += safetyRow("真实写入", safety.real_writes);
  html += safetyRow("外部模型调用", safety.external_model_calls);
  html += safetyRow("演示模式", safety.demo_mode);
  html += '</div>';
  html += '</div>';
  return html;
}
