import { esc } from "./helpers.js";
import { AGENT_NODES, RETIRED_AGENT_NAMES, PIPELINE_STAGE_LABELS } from "./constants.js";

// ── Agent Relay Player ──
// Replays the most recent /api/work-events safety snapshot as a sequential
// pipeline highlight. No fake data, no writes, no provider calls.

var AGENT_ORDER = [
  "简历录入", "信息抽取", "图谱构建", "面试准备",
  "图谱复核", "HR 协调", "数据分析"
];

var isPlaying = false;
var replayTimer = null;
var currentStep = -1;
var replaySteps = [];
var STEP_MS = 1800;

function filterEvents(events) {
  if (!Array.isArray(events)) return [];
  var filtered = [];
  for (var i = 0; i < events.length; i++) {
    var name = events[i].agent_name;
    if (!name) continue;
    if (RETIRED_AGENT_NAMES.indexOf(name) !== -1) continue;
    filtered.push(events[i]);
  }
  return filtered;
}

function buildReplaySteps(events) {
  var agentEvents = {};
  for (var i = 0; i < events.length; i++) {
    var name = events[i].agent_name;
    if (!agentEvents[name]) agentEvents[name] = [];
    agentEvents[name].push(events[i]);
  }

  var steps = [];
  for (var j = 0; j < AGENT_ORDER.length; j++) {
    var agentName = AGENT_ORDER[j];
    var evts = agentEvents[agentName] || [];
    if (evts.length > 0) {
      steps.push({
        agentName: agentName,
        event: evts[0],
        eventCount: evts.length
      });
    } else {
      steps.push({
        agentName: agentName,
        event: null,
        eventCount: 0
      });
    }
  }
  return steps;
}

function clearAllHighlights() {
  // Pipeline cards
  var cards = document.querySelectorAll(".pipeline-card.is-relay-active");
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.remove("is-relay-active");
  }
  // Relay timeline entries
  var entries = document.querySelectorAll(".relay-entry.is-current");
  for (var j = 0; j < entries.length; j++) {
    entries[j].classList.remove("is-current");
  }
  // Org relay nodes
  var nodes = document.querySelectorAll(".org-relay-node.is-relay-active");
  for (var k = 0; k < nodes.length; k++) {
    nodes[k].classList.remove("is-relay-active");
  }
}

function highlightStep(step) {
  clearAllHighlights();

  if (!step) return;

  // Highlight pipeline card (find by data-agent-name)
  var cards = document.querySelectorAll(".pipeline-card-agent[data-agent-name]");
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    if (card.getAttribute("data-agent-name") === step.agentName) {
      var pipelineCard = card.closest(".pipeline-card");
      if (pipelineCard) pipelineCard.classList.add("is-relay-active");
      break;
    }
  }

  // Highlight relay timeline entry
  var entries = document.querySelectorAll(".relay-entry");
  for (var j = 0; j < entries.length; j++) {
    var entry = entries[j];
    var nameEl = entry.querySelector(".relay-agent-name");
    if (nameEl && nameEl.textContent === step.agentName) {
      entry.classList.add("is-current");
      break;
    }
  }

  // Highlight org relay node
  var nodes = document.querySelectorAll(".org-relay-node");
  for (var k = 0; k < nodes.length; k++) {
    var node = nodes[k];
    var nameEl = node.querySelector(".org-relay-node-name");
    if (nameEl && nameEl.textContent === step.agentName) {
      node.classList.add("is-relay-active");
      break;
    }
  }

  // Update player bar
  updatePlayerBar(step);
}

function updatePlayerBar(step) {
  var bar = document.getElementById("relay-player-bar");
  if (!bar) return;

  var agentEl = bar.querySelector(".relay-player-agent");
  var actionEl = bar.querySelector(".relay-player-action");
  var stepEl = bar.querySelector(".relay-player-step");
  var countEl = bar.querySelector(".relay-player-count");

  if (agentEl) agentEl.textContent = step.agentName;
  if (actionEl && step.event) {
    actionEl.textContent = step.event.safe_summary || "";
  } else if (actionEl) {
    actionEl.textContent = "等待运行快照 — 暂无该 Agent 的安全事件";
  }
  if (stepEl) stepEl.textContent = String(currentStep + 1) + " / " + replaySteps.length;
  if (countEl && step.eventCount > 0) {
    countEl.textContent = step.eventCount + " 次事件";
  } else if (countEl) {
    countEl.textContent = "无事件";
  }
}

function stopReplay() {
  if (replayTimer) {
    clearTimeout(replayTimer);
    replayTimer = null;
  }
  isPlaying = false;
  currentStep = -1;
  clearAllHighlights();
  updatePlayButton("重放接力");
  resetPlayerBar();
}

function finishReplay() {
  if (replayTimer) {
    clearTimeout(replayTimer);
    replayTimer = null;
  }
  isPlaying = false;
  updatePlayButton("重放接力");
  var bar = document.getElementById("relay-player-bar");
  if (bar) {
    var actionEl = bar.querySelector(".relay-player-action");
    if (actionEl) actionEl.textContent = "接力回放完成。高亮保留在最后一个有安全事件的 Agent，可点击重放再次查看。";
  }
}

function playStep(index) {
  if (index >= replaySteps.length) {
    finishReplay();
    return;
  }
  currentStep = index;
  highlightStep(replaySteps[index]);
  replayTimer = setTimeout(function () {
    playStep(index + 1);
  }, STEP_MS);
}

function startReplay() {
  if (isPlaying) {
    stopReplay();
    return;
  }

  // Reload events to get fresh data
  fetch("/api/work-events")
    .then(function (r) { return r.json(); })
    .then(function (events) {
      var filtered = filterEvents(events);
      replaySteps = buildReplaySteps(filtered);

      if (!replaySteps.length) {
        updatePlayerBar({ agentName: "—", event: null, eventCount: 0 });
        return;
      }

      isPlaying = true;
      updatePlayButton("停止");
      currentStep = -1;
      playStep(0);
    })
    .catch(function () {
      updatePlayerBar({ agentName: "错误", event: { safe_summary: "无法加载 /api/work-events" }, eventCount: 0 });
    });
}

function updatePlayButton(text) {
  var btn = document.getElementById("relay-play-btn");
  if (btn) btn.textContent = text;
}

function resetPlayerBar() {
  var bar = document.getElementById("relay-player-bar");
  if (!bar) return;
  var agentEl = bar.querySelector(".relay-player-agent");
  var actionEl = bar.querySelector(".relay-player-action");
  var stepEl = bar.querySelector(".relay-player-step");
  var countEl = bar.querySelector(".relay-player-count");
  if (agentEl) agentEl.textContent = "就绪";
  if (actionEl) actionEl.textContent = "点击「重放接力」回放最近一次 /api/work-events 安全运行快照";
  if (stepEl) stepEl.textContent = "—";
  if (countEl) countEl.textContent = "";
}

export function mountRelayPlayer() {
  // Create player bar if it doesn't exist
  var existing = document.getElementById("relay-player-bar");
  if (existing) return;

  var html = '<div id="relay-player-bar" class="relay-player-bar">';
  html += '<div class="relay-player-bar-inner" style="padding: 16px 24px; justify-content: space-between;">';
  html += '<div class="relay-player-label" style="display:flex; align-items:center; gap:12px; margin:0;">';
  html += '<span class="relay-player-dot" style="width:10px; height:10px; background:var(--accent-red);"></span>';
  html += '<span class="relay-player-agent" style="font-size:20px; font-weight:800; color:var(--text-primary);">就绪</span>';
  html += '</div>';
  html += '<div class="relay-player-info" style="flex:1; margin-left:24px;">';
  html += '<span class="relay-player-action" style="font-size:15px; color:var(--text-secondary);">点击「重放接力」回放最近一次 /api/work-events 安全运行快照</span>';
  html += '</div>';
  html += '<div class="relay-player-meta" style="gap:16px; align-items:center;">';
  html += '<span class="relay-player-step" style="font-size:16px; font-family:var(--font-num); color:var(--text-tertiary); background:none; padding:0;">—</span>';
  html += '<button id="relay-play-btn" class="relay-play-btn" style="padding:8px 24px; font-size:14px; border-radius:100px; background:var(--bg-white); color:var(--text-primary); border:1px solid var(--border-medium);">重放接力</button>';
  html += '</div>';
  html += '</div>';
  html += '<div class="relay-player-disclaimer">回放最近一次安全运行快照 · 非实时执行 · 不调用写接口 · 不触发 provider 模型调用</div>';
  html += '</div>';

  // Insert after pipeline section
  var pipelineSection = document.getElementById("pipeline-tabs");
  if (pipelineSection && pipelineSection.parentElement) {
    pipelineSection.parentElement.insertAdjacentHTML("afterend", html);
  } else {
    // Fallback: insert at top of main
    var main = document.querySelector("main");
    if (main) main.insertAdjacentHTML("afterbegin", html);
  }

  // Wire up button
  var btn = document.getElementById("relay-play-btn");
  if (btn) {
    btn.addEventListener("click", startReplay);
  }

  // Auto-start replay after each page load. This is UI playback of the latest
  // safe snapshot only; it does not execute agents, writes, or provider calls.
  setTimeout(function () {
    if (!isPlaying) startReplay();
  }, 1800);
}
