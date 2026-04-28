import {
  SAFE_ERROR_MSG,
  STATUS_ICONS,
  STATUS_LABELS_DISPLAY,
  TEXT_LABELS_DISPLAY,
  TARGET_TABLE_LABELS,
  AVATAR_CLASS_BY_AGENT,
  AVATAR_INITIALS,
} from "./constants.js";

export function esc(str) {
  if (str == null) return "";
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
}

export function fetchJson(path) {
  return fetch(path).then(function (res) {
    if (!res.ok) throw new Error(SAFE_ERROR_MSG);
    return res.json();
  }).catch(function () {
    throw new Error(SAFE_ERROR_MSG);
  });
}

export function avatarHtml(agentName, sizeClass) {
  const cls = AVATAR_CLASS_BY_AGENT[agentName] || "avatar-hr";
  const initial = AVATAR_INITIALS[agentName] || (agentName ? agentName.charAt(0) : "·");
  const extra = sizeClass ? (" " + sizeClass) : "";
  return '<div class="agent-avatar ' + cls + extra + '" aria-hidden="true">' + esc(initial) + '</div>';
}

export function eventAvatarHtml(agentName) {
  const cls = AVATAR_CLASS_BY_AGENT[agentName] || "avatar-hr";
  const initial = AVATAR_INITIALS[agentName] || (agentName ? agentName.charAt(0) : "·");
  return '<div class="event-avatar ' + cls + '" aria-hidden="true">' + esc(initial) + '</div>';
}

export function relativeTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 0) return "刚刚";
  if (sec < 60) return sec + " 秒前";
  const min = Math.round(sec / 60);
  if (min < 60) return min + " 分钟前";
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + " 小时前";
  const day = Math.round(hr / 24);
  if (day < 30) return day + " 天前";
  return d.toLocaleDateString("zh-CN");
}

export function formatDateTime(d) {
  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export function setHeaderTime() {
  const el = document.getElementById("header-time");
  if (!el) return;
  el.textContent = formatDateTime(new Date());
}

export function targetTableLabel(t) { return TARGET_TABLE_LABELS[t] || t || ""; }

export function displayStatus(status) {
  return STATUS_LABELS_DISPLAY[status] || status || "";
}

export function displayText(text) {
  if (text == null) return "";
  const str = String(text);
  return TEXT_LABELS_DISPLAY[str] || str;
}

export function badgeHtml(status) {
  if (!status) return "";
  const cls = String(status).toLowerCase().replace(/\s+/g, "_");
  return '<div class="status-badge ' + cls + '">' +
    '<span class="badge-dot"></span>' + esc(displayStatus(String(status))) + '</div>';
}

export function indicatorHtml(label, value) {
  const on = value === true || value === "true";
  const off = value === false || value === "false";
  const cls = on ? "on" : off ? "off" : "";
  const text = on ? "开启" : off ? "关闭" : esc(displayText(value));
  return '<div class="indicator-row">' +
    '<span class="indicator-label">' + esc(label) + '</span>' +
    '<span class="indicator-value ' + cls + '">' + text + '</span>' +
    '</div>';
}

export function checkListHtml(checks) {
  if (!checks || !checks.length) return "";
  let html = '<div class="check-list">';
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const icon = STATUS_ICONS[c.status] || "·";
    html += '<div class="check-row">' +
      '<span class="check-icon ' + esc(c.status) + '">' + icon + '</span>' +
      '<span class="check-name">' + esc(displayText(c.name)) + '</span>' +
      '<span class="check-summary">' + esc(displayText(c.summary)) + '</span>' +
      '</div>';
  }
  html += '</div>';
  return html;
}

export function codeListHtml(items) {
  if (!items || !items.length) return "";
  let html = '<div class="code-list">';
  for (let i = 0; i < items.length; i++) {
    html += '<code>' + esc(items[i]) + '</code>';
  }
  html += '</div>';
  return html;
}

export function noteHtml(text) {
  if (!text) return "";
  return '<div class="note-block">' + esc(displayText(text)) + '</div>';
}

export function changesHtml(allowed, blocked) {
  let html = "";
  if (allowed && allowed.length) {
    html += '<div class="changes-section changes-allowed">';
    html += '<div class="changes-title">允许的变更</div>';
    html += '<div class="changes-list">';
    for (let i = 0; i < allowed.length; i++) {
      html += '<div class="changes-item">' + esc(displayText(allowed[i])) + '</div>';
    }
    html += '</div></div>';
  }
  if (blocked && blocked.length) {
    html += '<div class="changes-section changes-blocked">';
    html += '<div class="changes-title">禁止的变更</div>';
    html += '<div class="changes-list">';
    for (let i = 0; i < blocked.length; i++) {
      html += '<div class="changes-item">' + esc(displayText(blocked[i])) + '</div>';
    }
    html += '</div></div>';
  }
  return html;
}

export function errorHtml() {
  return '<div class="error-msg">' + esc(SAFE_ERROR_MSG) + '</div>';
}
