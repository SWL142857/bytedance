import {
  AVAILABILITY_LABELS,
  ICON_PLAY,
  ICON_CHECK_CIRCLE,
  ICON_CHART,
} from "./constants.js";
import { esc, errorHtml } from "./helpers.js";

function taskCategoryIcon(category) {
  if (category === "dry_run") return ICON_PLAY;
  if (category === "report") return ICON_CHART;
  return ICON_CHECK_CIRCLE;
}

function availabilityClass(av) {
  if (av === "available_readonly") return "avail-readonly";
  if (av === "disabled_phase_pending") return "avail-pending";
  return "";
}

export function renderOperatorTasks(data) {
  const el = document.getElementById("operator-tasks-container");
  if (!el) return;
  if (!data || !Array.isArray(data.tasks)) {
    el.innerHTML = errorHtml();
    return;
  }

  let html = "";
  html += '<div class="operator-notice">';
  html += '<svg class="operator-notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>';
  html += '<span>' + esc(data.notice || "操作员控制台尚处于准备阶段，仅展示只读任务清单。") + '</span>';
  html += '</div>';

  html += '<div class="section-source-hint">静态只读清单，不来自运行快照</div>';

  html += '<div class="tasks-grid">';
  for (let i = 0; i < data.tasks.length; i++) {
    const t = data.tasks[i];
    const iconCls = "task-icon-" + (t.category || "readiness");
    const availCls = "task-card-availability " + availabilityClass(t.availability);

    html += '<div class="task-card">';
    html += '<div class="task-card-head">';
    html += '<div class="task-card-icon ' + iconCls + '">' + taskCategoryIcon(t.category) + '</div>';
    html += '<div class="task-card-title">' + esc(t.display_name) + '</div>';
    html += '<span class="' + availCls + '">' +
      esc(AVAILABILITY_LABELS[t.availability] || t.availability) + '</span>';
    html += '</div>';
    html += '<div class="task-card-desc">' + esc(t.description) + '</div>';
    html += '<div class="task-card-guard">' + esc(t.guard_summary || "") + '</div>';
    html += '</div>';
  }
  html += '</div>';

  el.innerHTML = html;
}
