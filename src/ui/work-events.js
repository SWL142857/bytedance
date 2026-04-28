import {
  STATE_LABELS,
  EVENT_TYPE_LABELS,
  EXECUTION_MODE_LABELS,
  GUARD_STATUS_LABELS,
  TOOL_TYPE_LABELS,
  EVENT_VERB_BY_TYPE,
  SAFE_ERROR_MSG,
} from "./constants.js";
import {
  esc,
  eventAvatarHtml,
  relativeTime,
  targetTableLabel,
  errorHtml,
} from "./helpers.js";

export function renderWorkEvents(events) {
  const el = document.getElementById("work-events-container");
  if (!el) return;
  if (!Array.isArray(events) || !events.length) {
    el.innerHTML = errorHtml();
    return;
  }

  let html = '<div class="events-list">';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const verb = EVENT_VERB_BY_TYPE[e.event_type] || "执行操作";
    const target = targetTableLabel(e.target_table);
    let statusTransition = "";
    if (e.event_type === "status_transition" && e.status_after) {
      const afterLbl = STATE_LABELS[e.status_after] || e.status_after;
      const beforeLbl = e.status_before ? (STATE_LABELS[e.status_before] || e.status_before) : null;
      statusTransition = beforeLbl ? (beforeLbl + " → " + afterLbl) : ("推进到 " + afterLbl);
    }

    html += '<div class="event-row">';
    html += eventAvatarHtml(e.agent_name);
    html += '<div class="event-body">';
    html += '<div class="event-headline">';
    html += '<span class="event-headline-agent">' + esc(e.agent_name) + '</span>';
    html += '<span class="event-headline-action">' + esc(verb) + '</span>';
    if (target) {
      html += '<span class="event-headline-target">' + esc(target) + '</span>';
    }
    if (statusTransition) {
      html += '<span class="event-headline-action">·</span>';
      html += '<span class="event-headline-target">' + esc(statusTransition) + '</span>';
    }
    html += '</div>';

    html += '<div class="event-tag-row">';
    html += '<span class="event-tag tag-type-' + esc(e.event_type) + '">' +
      esc(EVENT_TYPE_LABELS[e.event_type] || e.event_type) + '</span>';
    if (e.tool_type) {
      html += '<span class="event-tag">' + esc(TOOL_TYPE_LABELS[e.tool_type] || e.tool_type) + '</span>';
    }
    html += '<span class="event-tag tag-mode-' + esc(e.execution_mode) + '">' +
      esc(EXECUTION_MODE_LABELS[e.execution_mode] || e.execution_mode) + '</span>';
    if (e.guard_status) {
      html += '<span class="event-tag tag-guard-' + esc(e.guard_status) + '">守卫·' +
        esc(GUARD_STATUS_LABELS[e.guard_status] || e.guard_status) + '</span>';
    }
    if (e.duration_ms != null) {
      html += '<span class="event-tag">耗时 ' + e.duration_ms + ' ms</span>';
    }
    html += '</div>';

    html += '<div class="event-summary">' + esc(e.safe_summary || "") + '</div>';
    html += '</div>';

    html += '<div class="event-aside">';
    html += '<span class="event-time">' + esc(relativeTime(e.created_at)) + '</span>';
    if (e.link) {
      if (e.link.available) {
        html += '<button type="button" class="event-link-btn" data-link-id="' +
          esc(e.link.link_id) + '">' + esc(e.link.link_label || "打开记录") + '</button>';
      } else {
        html += '<span class="event-link-unavailable">' + esc(e.link.unavailable_label || "飞书记录未接入") + '</span>';
      }
    }
    html += '</div>';

    html += '</div>';
  }
  html += '</div>';
  el.innerHTML = html;

  const buttons = el.querySelectorAll(".event-link-btn");
  for (let b = 0; b < buttons.length; b++) {
    buttons[b].addEventListener("click", function (ev) {
      const linkId = ev.currentTarget.getAttribute("data-link-id");
      openSafeLink(linkId);
    });
  }
}

export function openSafeLink(linkId) {
  const msgEl = document.getElementById("work-events-message");
  if (!linkId) {
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.textContent = "无可用的演示跳转。";
    }
    return;
  }
  fetch("/go/" + encodeURIComponent(linkId))
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (!msgEl) return;
      msgEl.hidden = false;
      if (result.ok && result.data && result.data.message) {
        msgEl.textContent = String(result.data.message);
      } else {
        msgEl.textContent = "暂不可跳转。";
      }
    })
    .catch(function () {
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.textContent = "暂不可跳转。";
      }
    });
}

export function mountLiveCapsule(events) {
  const capsule = document.getElementById("live-capsule");
  if (!capsule) return;
  const safeEvents = (Array.isArray(events) ? events : [])
    .filter(function (e) { return e && e.safe_summary; })
    .slice(0, 6);
  if (!safeEvents.length) {
    capsule.hidden = true;
    return;
  }

  const textEl = capsule.querySelector(".live-capsule-text");
  const fillEl = capsule.querySelector(".live-capsule-progress-fill");
  if (!textEl || !fillEl) return;

  const prefersReduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function buildText(e) {
    const name = e.agent_name || "虚拟员工";
    const verb = EVENT_VERB_BY_TYPE[e.event_type] || "执行操作";
    return name + " · " + verb + " · " + e.safe_summary;
  }

  capsule.hidden = false;
  textEl.textContent = buildText(safeEvents[0]);

  if (prefersReduced) {
    fillEl.style.transition = "none";
    fillEl.style.width = "100%";
    return;
  }

  let idx = 0;
  const SLOT_MS = 2800;
  const TICK_MS = 80;

  function startSlot() {
    fillEl.style.transition = "none";
    fillEl.style.width = "0%";
    requestAnimationFrame(function () {
      fillEl.style.transition = "width " + (SLOT_MS - TICK_MS) + "ms linear";
      fillEl.style.width = "100%";
    });
    setTimeout(function () {
      idx = (idx + 1) % safeEvents.length;
      textEl.textContent = buildText(safeEvents[idx]);
      startSlot();
    }, SLOT_MS);
  }
  startSlot();
}
