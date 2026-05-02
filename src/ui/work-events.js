import {
  STATE_LABELS,
  EVENT_TYPE_LABELS,
  EXECUTION_MODE_LABELS,
  GUARD_STATUS_LABELS,
  TOOL_TYPE_LABELS,
  EVENT_VERB_BY_TYPE,
  RETIRED_AGENT_NAMES,
  ICON_ACTIVITY,
  ICON_BOLT,
  ICON_CHECK_CIRCLE,
  ICON_PLAY,
  ICON_SHIELD,
  ICON_FLAG
} from "./constants.js";
import { esc, relativeTime, targetTableLabel, errorHtml } from "./helpers.js";

function getEventIcon(eventType) {
  if (eventType === "tool_call") return ICON_BOLT;
  if (eventType === "status_transition") return ICON_CHECK_CIRCLE;
  if (eventType === "guard_check") return ICON_SHIELD;
  if (eventType === "error" || eventType === "blocked") return ICON_FLAG;
  if (eventType === "human_action") return ICON_PLAY;
  return ICON_ACTIVITY;
}

function isRetiredName(name) {
  if (!name) return false;
  for (var i = 0; i < RETIRED_AGENT_NAMES.length; i++) {
    if (name === RETIRED_AGENT_NAMES[i]) return true;
  }
  return false;
}

export function renderWorkEvents(events) {
  var el = document.getElementById("work-events-container");
  if (!el) return;
  if (!Array.isArray(events) || !events.length) {
    el.innerHTML = '<div class="relay-empty">暂无协作事件 — 等待 Agent 运行快照</div>';
    return;
  }

  // Filter out events with retired agent names
  var filtered = [];
  for (var f = 0; f < events.length; f++) {
    if (!isRetiredName(events[f].agent_name)) {
      filtered.push(events[f]);
    }
  }

  var html = '<div class="relay-timeline">';
  for (var i = 0; i < filtered.length; i++) {
    var e = filtered[i];
    var verb = EVENT_VERB_BY_TYPE[e.event_type] || "执行操作";
    var target = targetTableLabel(e.target_table);
    var agentName = e.agent_name;

    // Status transition text
    var statusTransition = "";
    if (e.event_type === "status_transition" && e.status_after) {
      var afterLbl = STATE_LABELS[e.status_after] || e.status_after;
      var beforeLbl = e.status_before ? (STATE_LABELS[e.status_before] || e.status_before) : null;
      statusTransition = beforeLbl ? (beforeLbl + " → " + afterLbl) : ("推进到 " + afterLbl);
    }

    // Execution mode label
    var modeLabel = EXECUTION_MODE_LABELS[e.execution_mode] || "";
    var modeCls = "relay-mode-badge";
    if (e.execution_mode === "dry_run") modeCls += " mode-dry";
    else if (e.execution_mode === "live_read") modeCls += " mode-read";
    else if (e.execution_mode === "live_write") modeCls += " mode-write";
    else if (e.execution_mode === "blocked") modeCls += " mode-blocked";

    var iconSvg = getEventIcon(e.event_type);

    var isLast = i === filtered.length - 1;

    html += '<div class="relay-entry">';

    // Timeline connector column
    html += '<div class="relay-connector">';
    html += '<div class="relay-avatar" aria-hidden="true">' + iconSvg + '</div>';
    if (!isLast) html += '<div class="relay-line"></div>';
    html += '</div>';

    // Content
    html += '<div class="relay-body">';
    html += '<div class="relay-headline">';
    html += '<span class="relay-seq">#' + esc(String(i + 1)) + '</span>';
    html += '<span class="relay-agent-name">' + esc(agentName) + '</span>';
    html += '<span class="relay-action">' + esc(verb) + '</span>';
    if (target) html += '<span class="relay-target">' + esc(target) + '</span>';
    html += '</div>';

    // Status transition line
    if (statusTransition) {
      html += '<div class="relay-transition">' + esc(statusTransition) + '</div>';
    }

    // Event summary
    html += '<div class="relay-summary">' + esc(e.safe_summary || "") + '</div>';

    // Tags row
    html += '<div class="relay-tags">';
    html += '<span class="relay-tag tag-type-' + esc(e.event_type) + '">' + esc(EVENT_TYPE_LABELS[e.event_type] || e.event_type) + '</span>';
    if (e.tool_type) html += '<span class="relay-tag">' + esc(TOOL_TYPE_LABELS[e.tool_type] || e.tool_type) + '</span>';
    if (modeLabel) html += '<span class="' + modeCls + '">' + esc(modeLabel) + '</span>';
    if (e.guard_status) html += '<span class="relay-tag tag-guard-' + esc(e.guard_status) + '">守卫 ' + esc(GUARD_STATUS_LABELS[e.guard_status] || e.guard_status) + '</span>';
    if (e.duration_ms != null) html += '<span class="relay-tag">' + e.duration_ms + ' ms</span>';
    html += '</div>';
    html += '</div>';

    // Aside: time + link
    html += '<div class="relay-aside">';
    html += '<span class="relay-time">' + esc(relativeTime(e.created_at)) + '</span>';
    if (e.link) {
      if (e.link.available) {
        html += '<button class="relay-link-btn" data-link-id="' + esc(e.link.link_id) + '">' + esc(e.link.link_label || "打开记录") + '</button>';
      } else {
        html += '<span class="event-link-unavailable relay-link-unavailable">' + esc(e.link.unavailable_label || "飞书记录未接入") + '</span>';
      }
    }
    html += '</div>';

    html += '</div>'; // relay-entry
  }
  html += '</div>'; // relay-timeline

  el.innerHTML = html;

  var buttons = el.querySelectorAll(".relay-link-btn");
  for (var b = 0; b < buttons.length; b++) {
    buttons[b].addEventListener("click", function (ev) {
      var linkId = ev.currentTarget.getAttribute("data-link-id");
      openSafeLink(linkId);
    });
  }
}

function openSafeLink(linkId) {
  var msgEl = document.getElementById("work-events-message");
  if (!linkId) {
    if (msgEl) { msgEl.hidden = false; msgEl.textContent = "无可用的跳转。"; }
    return;
  }
  fetch("/go/" + encodeURIComponent(linkId))
    .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
    .then(function (r) {
      if (!msgEl) return;
      msgEl.hidden = false;
      if (r.ok && r.data && r.data.message) msgEl.textContent = String(r.data.message);
      else msgEl.textContent = "暂不可跳转。";
    })
    .catch(function () {
      if (msgEl) { msgEl.hidden = false; msgEl.textContent = "暂不可跳转。"; }
    });
}

export function mountLiveCapsule(events) {
  var capsule = document.getElementById("live-capsule");
  if (!capsule) return;
  var safeEvents = (Array.isArray(events) ? events : []).filter(function (e) { return e && e.safe_summary; }).slice(0, 6);
  if (!safeEvents.length) { capsule.hidden = true; return; }

  var textEl = capsule.querySelector(".live-capsule-text");
  var fillEl = capsule.querySelector(".live-capsule-progress-fill");
  if (!textEl || !fillEl) return;

  var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function buildText(e) {
    var name = e.agent_name || "虚拟员工";
    if (isRetiredName(name)) return null;
    return name + " · " + (EVENT_VERB_BY_TYPE[e.event_type] || "执行操作") + " · " + e.safe_summary;
  }

  capsule.hidden = false;
  var firstText = buildText(safeEvents[0]);
  if (firstText) textEl.textContent = firstText;

  if (prefersReduced) { fillEl.style.transition = "none"; fillEl.style.width = "100%"; return; }

  var idx = 0, SLOT_MS = 2800;
  function startSlot() {
    fillEl.style.transition = "none"; fillEl.style.width = "0%";
    requestAnimationFrame(function () {
      fillEl.style.transition = "width " + (SLOT_MS - 80) + "ms linear";
      fillEl.style.width = "100%";
    });
    setTimeout(function () {
      idx = (idx + 1) % safeEvents.length;
      var t = buildText(safeEvents[idx]);
      if (t) textEl.textContent = t;
      startSlot();
    }, SLOT_MS);
  }
  startSlot();
}
