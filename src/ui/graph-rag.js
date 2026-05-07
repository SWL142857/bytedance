import { esc } from "./helpers.js";
import { saveSearchHistory } from "./async-queue.js";

// ── Graph RAG: Candidate Grid + Deep Analysis Zone ──

var selectedCandidateId = null;
var latestSearchTrace = null;
var currentGraphScene = "search";
var currentReviewerMode = "existing";
var hasGraphSearchResults = false;

// Chinese-friendly label mappings
var RECOMMENDATION_CN = {
  "强烈推荐": "推荐推进",
  "strong_match": "推荐推进",
  "待复核": "建议谨慎复核",
  "review_needed": "建议谨慎复核",
  "likely_reject": "建议谨慎复核",
  "weak_match": "需要人工判断",
};

var ROLE_CN = {
  "data analyst": "数据分析师",
  "data engineer": "数据工程师",
  "data scientist": "数据科学家",
  "machine learning engineer": "机器学习工程师",
  "robotics engineer": "机器人工程师",
  "software engineer": "软件工程师",
  "product manager": "产品经理",
};

var FEATURE_TYPE_CN = {
  "skill": "技能",
  "experience": "经验",
  "education": "教育背景",
  "risk": "风险信号",
  "role_requirement": "岗位要求",
};

function cnRecommendation(label) {
  if (!label) return "";
  return RECOMMENDATION_CN[label] || label;
}

function cnRole(role) {
  if (!role) return "未知岗位";
  var key = String(role).toLowerCase();
  return ROLE_CN[key] || role;
}

function graphProjectionLabel(label) {
  if (!label) return "等待人工判断";
  if (label === "likely_select" || label === "select" || label === "strong_match") return "推荐推进";
  if (label === "likely_reject" || label === "reject" || label === "weak_match") return "建议谨慎复核";
  if (label === "review_needed" || label === "needs_review") return "需要人工判断";
  return label;
}

function candidateHeadline(c) {
  var parts = [];
  if (c.role) parts.push("目标岗位：" + cnRole(c.role));
  if (c.evidenceCount != null) parts.push("图谱证据 " + c.evidenceCount + " 条");
  if (c.similarCandidateCount != null) parts.push("相似候选 " + c.similarCandidateCount + " 位");
  return parts.length ? parts.join(" · ") : "已从 Competition Graph RAG 读取候选人摘要";
}

function featureLabel(feature) {
  if (typeof feature === "string") return feature;
  if (!feature || typeof feature !== "object") return "";
  var name = feature.canonicalName || feature.label || feature.name || "未命名特征";
  var value = feature.featureValue || feature.value || "";
  var confidence = feature.confidence != null ? " · 置信度 " + Math.round(Number(feature.confidence) * 100) + "%" : "";
  var type = feature.featureType && FEATURE_TYPE_CN[feature.featureType] ? FEATURE_TYPE_CN[feature.featureType] + " · " : "";
  return value ? type + name + "：" + value + confidence : type + name + confidence;
}

function summarizeEdgeReason(reason) {
  if (!reason) return "相似原因未展开";
  var text = String(reason);
  var shared = /shared_features=([^;]+)/i.exec(text);
  var source = shared ? shared[1] : text;
  var items = source.split(",").map(function (item) {
    var parts = item.trim().split(":");
    if (parts.length >= 2) {
      var type = FEATURE_TYPE_CN[parts[0]] || parts[0];
      return type + "「" + parts.slice(1).join("：").replace(/:present$/i, "").trim() + "」";
    }
    return item.trim();
  }).filter(Boolean).slice(0, 3);
  return items.length ? "共享 " + items.join("、") : "相似原因已脱敏";
}

function summarizeRoleMemory(text) {
  if (!text) return "暂无可用岗位历史记忆";
  var roleMatch = /岗位记忆：(.+?) currently has (\d+) candidates in memory/i.exec(text);
  var signalMatch = /Common extracted signals:\s*([^。]+?)(?:\.|。)/i.exec(text);
  var countMatch = /Select vs reject count is (\d+) to (\d+)/i.exec(text);
  if (roleMatch) {
    var role = cnRole(roleMatch[1]);
    var total = roleMatch[2];
    var signals = signalMatch && signalMatch[1] ? signalMatch[1].split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 5).join("、") : "";
    var selectReject = countMatch ? "历史推进/淘汰样本约 " + countMatch[1] + " / " + countMatch[2] + "。" : "";
    return role + " 岗位历史库包含 " + total + " 位候选人。" + (signals ? "常见信号包括：" + signals + "。" : "") + selectReject;
  }
  return text;
}

function renderMiniTag(text, cls) {
  return '<span class="info-chip ' + esc(cls || "") + '">' + esc(text || "") + '</span>';
}

function renderSignalCard(title, subtitle, badges, tone) {
  var html = '<div class="signal-card ' + esc(tone || "default") + '">';
  html += '<div class="signal-card-title">' + esc(title || "") + '</div>';
  if (subtitle) {
    html += '<div class="signal-card-subtitle">' + esc(subtitle) + '</div>';
  }
  if (badges && badges.length) {
    html += '<div class="signal-card-tags">';
    for (var i = 0; i < badges.length; i++) {
      html += renderMiniTag(badges[i], "tone-" + (tone || "default"));
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderBulletedPills(items, tone) {
  if (!items || !items.length) return '<div class="empty-inline">暂无数据</div>';
  var html = '<div class="pill-list">';
  for (var i = 0; i < items.length; i++) {
    html += '<div class="pill-item ' + esc(tone || "default") + '"><span class="pill-dot"></span><span class="pill-text">' + esc(items[i]) + '</span></div>';
  }
  html += '</div>';
  return html;
}

function renderNeighborCards(items) {
  if (!items || !items.length) return '<div class="empty-inline">暂无邻居证据</div>';
  var html = '<div class="neighbor-card-list">';
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    html += '<div class="neighbor-card">';
    html += '<div class="neighbor-card-top">';
    html += '<div class="neighbor-card-id">' + esc(item.id || "") + '</div>';
    html += '<div class="neighbor-card-score">' + esc(item.score || "") + '</div>';
    html += '</div>';
    if (item.status) {
      html += '<div class="neighbor-card-status">' + esc(item.status) + '</div>';
    }
    if (item.summary) {
      html += '<div class="neighbor-card-summary">' + esc(item.summary) + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function clearGraphMeta() {
  var existingMeta = document.getElementById("graph-rag-meta-container");
  if (existingMeta) existingMeta.remove();
}

function escapeAttr(value) {
  return esc(value == null ? "" : String(value)).replace(/"/g, "&quot;");
}

// ── Candidate Grid (from /api/competition/search) ──

function renderCandidateCard(c, isSelected) {
  var cls = "candidate-card";
  if (isSelected) cls += " is-selected";

  var recommendationCn = cnRecommendation(c.recommendationLabel);
  var badgeHtml = "";
  if (recommendationCn) {
    var bCls = "candidate-card-badge";
    if (recommendationCn === "推荐推进") bCls += " recommend";
    else if (recommendationCn === "建议谨慎复核") bCls += " review";
    else bCls += " weak";
    badgeHtml = '<span class="' + bCls + '">' + esc(recommendationCn) + '</span>';
  }

  var evidenceCount = c.evidenceCount != null ? c.evidenceCount : 0;
  var similarCount = c.similarCandidateCount != null ? c.similarCandidateCount : 0;

  var html = '<div class="' + cls + '" data-candidate-id="' + esc(c.candidateId || "") + '">';
  html += '<div class="candidate-card-head">';
  html += '<span class="candidate-card-id">' + esc(c.candidateId || "—") + '</span>';
  html += '<span class="candidate-card-score">' + (c.matchScore != null ? Math.round(Number(c.matchScore) * 100) + '%' : "—") + '</span>';
  html += '</div>';
  html += '<div class="candidate-card-role">' + esc(cnRole(c.role)) + '</div>';
  html += '<div class="candidate-card-headline">' + esc(candidateHeadline(c)) + '</div>';
  html += '<div class="candidate-card-meta">';
  if (evidenceCount > 0) html += '<span class="candidate-card-meta-item">证据 ' + evidenceCount + '</span>';
  if (similarCount > 0) html += '<span class="candidate-card-meta-item">相似候选 ' + similarCount + '</span>';
  if (c.topReasons && c.topReasons.length) {
    html += '<span class="candidate-card-meta-item">' + esc(c.topReasons[0]) + '</span>';
  }
  html += '</div>';
  if (badgeHtml) html += badgeHtml;
  html += '</div>';
  return html;
}

export function renderCandidateGrid(searchData) {
  var grid = document.getElementById("candidate-grid");
  if (!grid) return;

  var candidates = (searchData && Array.isArray(searchData.candidates)) ? searchData.candidates : [];
  latestSearchTrace = searchData && searchData.trace ? searchData.trace : null;
  setGraphSearchActiveState(candidates.length > 0);
  renderSearchTrace(searchData);

  if (!candidates.length) {
    grid.innerHTML = '<div class="graph-canvas-empty" style="grid-column:1/-1">' +
      '<div class="graph-search-empty-title">未命中当前查询</div>' +
      '<div class="graph-search-empty-text">当前查询未在 Competition Graph RAG 全量镜像中命中候选人。可尝试调整关键词，或点击上方 Demo 查询预设。</div>' +
      '<div class="graph-search-empty-source">已搜索 5991 位候选人，未匹配到与 "' + esc(searchData && searchData.query ? searchData.query : "") + '" 相关的结果</div>' +
      '</div>';
    selectedCandidateId = null;
    clearGraphMeta();
    var canvas = document.getElementById("graph-canvas");
    if (canvas) canvas.innerHTML = '<div class="graph-canvas-empty">当前查询没有可复核候选人</div>';
    var emptyTitle = document.getElementById("queue-title");
    var emptySubtitle = document.getElementById("queue-subtitle");
    if (emptyTitle) emptyTitle.textContent = "Graph RAG 查询 · 未命中";
    if (emptySubtitle) emptySubtitle.textContent = "当前查询没有命中候选人，可调整关键词或使用 Demo 预设重试";
    return;
  }

  var hasSelectedCandidate = false;
  for (var k = 0; k < candidates.length; k++) {
    if (candidates[k].candidateId === selectedCandidateId) {
      hasSelectedCandidate = true;
      break;
    }
  }
  if (!hasSelectedCandidate) {
    selectedCandidateId = candidates[0].candidateId || null;
  }

  var html = "";
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var isSelected = selectedCandidateId === c.candidateId;
    html += renderCandidateCard(c, isSelected);
  }
  grid.innerHTML = html;

  // Click delegation
  var cards = grid.querySelectorAll(".candidate-card");
  for (var j = 0; j < cards.length; j++) {
    cards[j].addEventListener("click", function () {
      var cid = this.getAttribute("data-candidate-id");
      selectCandidate(cid, candidates);
    });
  }

  // Update queue title
  var title = document.getElementById("queue-title");
  var subtitle = document.getElementById("queue-subtitle");
  if (title) title.textContent = "Graph RAG 候选人队列 (" + candidates.length + ")";
  if (subtitle) subtitle.textContent = "来自本地 Competition Graph RAG 数据集 · 点击卡片进入深度图谱分析";

  if (selectedCandidateId) {
    loadGraphReview(selectedCandidateId);
  }
}

function selectCandidate(candidateId, candidates) {
  selectedCandidateId = candidateId;

  // Re-render grid to show selection
  var grid = document.getElementById("candidate-grid");
  if (grid) {
    var html = "";
    for (var i = 0; i < candidates.length; i++) {
      html += renderCandidateCard(candidates[i], candidates[i].candidateId === candidateId);
    }
    grid.innerHTML = html;
    var cards = grid.querySelectorAll(".candidate-card");
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener("click", function () {
        var cid = this.getAttribute("data-candidate-id");
        selectCandidate(cid, candidates);
      });
    }
  }

  // Load deep analysis
  loadGraphReview(candidateId);
}

function switchGraphScene(scene) {
  currentGraphScene = scene === "reviewer" ? "reviewer" : "search";
  var buttons = document.querySelectorAll("[data-graph-scene]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle("active", buttons[i].getAttribute("data-graph-scene") === currentGraphScene);
  }
  var searchSections = document.querySelectorAll("#graph-scene-search, #graph-rag-zone");
  for (var s = 0; s < searchSections.length; s++) {
    if (searchSections[s].id === "graph-rag-zone") {
      searchSections[s].hidden = currentGraphScene !== "search" || !hasGraphSearchResults;
    } else {
      searchSections[s].hidden = currentGraphScene !== "search";
    }
  }
  var reviewerSection = document.getElementById("graph-scene-reviewer");
  if (reviewerSection) reviewerSection.hidden = currentGraphScene !== "reviewer";
  var searchOnlySections = document.querySelectorAll("#deferred-queue-section");
  for (var so = 0; so < searchOnlySections.length; so++) {
    searchOnlySections[so].hidden = true;
  }
  var clutterSections = document.querySelectorAll("#live-data-section, #audit-log-section, #operator-tasks-section");
  for (var c = 0; c < clutterSections.length; c++) {
    clutterSections[c].hidden = true;
  }
  var body = document.body;
  if (body) {
    body.setAttribute("data-graph-scene", currentGraphScene);
  }
}

function initGraphSceneSwitcher() {
  var buttons = document.querySelectorAll("[data-graph-scene]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function (ev) {
      switchGraphScene(ev.currentTarget.getAttribute("data-graph-scene"));
    });
  }
  var loadSelectedBtn = document.getElementById("reviewer-load-selected-btn");
  if (loadSelectedBtn) {
    loadSelectedBtn.addEventListener("click", function () {
      var input = document.getElementById("reviewer-candidate-id");
      if (input && selectedCandidateId) {
        input.value = selectedCandidateId;
      }
    });
  }
  var runBtn = document.getElementById("reviewer-run-btn");
  if (runBtn) {
    runBtn.addEventListener("click", function () {
      var input = document.getElementById("reviewer-candidate-id");
      var candidateId = input ? input.value.trim() : "";
      if (candidateId) {
        loadReviewerScenario(candidateId);
      }
    });
  }
  initReviewerModeSwitcher();
  switchGraphScene("search");
}

function initReviewerModeSwitcher() {
  var buttons = document.querySelectorAll("[data-reviewer-mode]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function (ev) {
      switchReviewerMode(ev.currentTarget.getAttribute("data-reviewer-mode"));
    });
  }
  var form = document.getElementById("reviewer-ad-hoc-form");
  if (form) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      loadReviewerAdHocScenario();
    });
  }
  switchReviewerMode("existing");
}

function switchReviewerMode(mode) {
  currentReviewerMode = mode === "new" ? "new" : "existing";
  var buttons = document.querySelectorAll("[data-reviewer-mode]");
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle("active", buttons[i].getAttribute("data-reviewer-mode") === currentReviewerMode);
  }
  var existingEl = document.getElementById("reviewer-existing-mode");
  var newEl = document.getElementById("reviewer-ad-hoc-form");
  if (existingEl) existingEl.hidden = currentReviewerMode !== "existing";
  if (newEl) newEl.hidden = currentReviewerMode !== "new";
}

// ── Graph RAG Deep Analysis (from /api/competition/review) ──

export function loadGraphReview(candidateId) {
  var canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  clearGraphMeta();
  canvas.innerHTML = '<div class="loading-pulse">正在加载图谱分析...</div>';
  var queryInput = document.getElementById("candidate-search-input");
  var activeQuery = queryInput ? queryInput.value.trim() : "";

  fetch("/api/competition/review?candidateId=" + encodeURIComponent(candidateId) + "&q=" + encodeURIComponent(activeQuery))
    .then(function (r) {
      if (!r.ok) throw new Error("Graph RAG review returned " + r.status);
      return r.json();
    })
    .then(function (reviewData) {
      if (reviewData.error) {
        canvas.innerHTML = '<div class="graph-canvas-empty">' + esc(reviewData.error) + '</div>';
        return;
      }
      renderGraphCanvas(canvas, reviewData, candidateId);
    })
    .catch(function () {
      canvas.innerHTML = '<div class="graph-canvas-empty">图谱分析加载失败</div>';
    });
}

function renderGraphCanvas(canvas, reviewData, candidateId) {
  var gp = reviewData.graphProjection || {};
  var matchedFeatures = Array.isArray(reviewData.matchedFeatures) ? reviewData.matchedFeatures : [];
  var similarCandidates = Array.isArray(reviewData.similarCandidates) ? reviewData.similarCandidates : [];

  var confidence = Math.round(Number(gp.confidence || 0) * 100);
  var graphScore = Number(gp.graphScore || 0).toFixed(2);
  var neighborCount = Number(gp.neighborCount || 0);

  var html = '<div class="graph-canvas-center">';

  // Center node: candidate
  html += '<div class="graph-node-center">';
  html += '<div class="graph-node-center-id">' + esc(candidateId) + '</div>';
  html += '<div class="graph-node-center-role">' + esc(graphProjectionLabel(gp.label)) + '</div>';
  html += '<div class="graph-node-center-headline">图谱投影置信度 ' + confidence + '% · 图谱匹配强度 ' + graphScore + ' · 参考过 ' + neighborCount + ' 位相似候选人</div>';
  html += '</div>';

  // Ring: key metrics (Chinese-friendly labels)
  html += '<div class="graph-nodes-ring">';
  html += '<div class="graph-node-ring"><span class="graph-node-ring-label">置信度</span><span class="graph-node-ring-value num">' + confidence + '%</span></div>';
  html += '<div class="graph-node-ring"><span class="graph-node-ring-label">图谱匹配强度</span><span class="graph-node-ring-value num">' + graphScore + '</span></div>';
  html += '<div class="graph-node-ring"><span class="graph-node-ring-label">参考过的相似候选人数</span><span class="graph-node-ring-value num">' + neighborCount + '</span></div>';
  html += '<div class="graph-node-ring"><span class="graph-node-ring-label">命中的关键特征</span><span class="graph-node-ring-value num">' + matchedFeatures.length + '</span></div>';
  html += '<div class="graph-node-ring"><span class="graph-node-ring-label">相似候选人数</span><span class="graph-node-ring-value num">' + similarCandidates.length + '</span></div>';
  html += '</div>';

  // Feature badges ring
  if (matchedFeatures.length > 0) {
    html += '<div class="graph-features-ring">';
    for (var i = 0; i < matchedFeatures.length && i < 12; i++) {
      var feat = featureLabel(matchedFeatures[i]);
      html += '<span class="graph-feature-badge">' + esc(feat) + '</span>';
    }
    html += '</div>';
  }

  html += '</div>'; // graph-canvas-center

  canvas.innerHTML = html;

  // Meta cards below
  renderGraphMeta(reviewData, candidateId);
}

function renderGraphMeta(reviewData, candidateId) {
  clearGraphMeta();

  var zone = document.getElementById("graph-rag-zone");
  if (!zone) return;

  var similarCandidates = Array.isArray(reviewData.similarCandidates) ? reviewData.similarCandidates : [];
  var matchedFeatures = Array.isArray(reviewData.matchedFeatures) ? reviewData.matchedFeatures : [];

  var metaHtml = '<div id="graph-rag-meta-container">';
  metaHtml += renderThreeLayerGraph(reviewData, candidateId);
  metaHtml += '<div class="graph-rag-meta" id="graph-rag-meta-cards">';

  if (reviewData.queryContext) {
    metaHtml += '<div class="graph-rag-meta-card">';
    metaHtml += '<div class="graph-rag-meta-label">查询约束解析</div>';
    metaHtml += '<div class="graph-rag-meta-content">';
    metaHtml += renderSignalCard(
      reviewData.queryContext.query || "未提供查询",
      reviewData.queryContext.missingRequirements && reviewData.queryContext.missingRequirements.length
        ? "存在未完全满足的约束"
        : "当前候选人满足关键约束",
      reviewData.queryContext.normalizedTokens || [],
      reviewData.queryContext.missingRequirements && reviewData.queryContext.missingRequirements.length ? "warning" : "success",
    );
    if (reviewData.queryContext.missingRequirements && reviewData.queryContext.missingRequirements.length) {
      metaHtml += '<div class="section-mini-label">缺失约束</div>';
      metaHtml += renderBulletedPills(reviewData.queryContext.missingRequirements, "warning");
    }
    metaHtml += '</div>';
    metaHtml += '</div>';
  }

  // Role memory (Chinese-friendly)
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">岗位历史记忆</div>';
  metaHtml += '<div class="graph-rag-meta-content">';
  metaHtml += renderSignalCard("岗位历史库", summarizeRoleMemory(reviewData.roleMemory), [], "job");
  metaHtml += '</div>';
  metaHtml += '</div>';

  // Matched features summary (Chinese-friendly)
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">命中的关键特征（共 ' + matchedFeatures.length + ' 项）</div>';
  metaHtml += '<div class="graph-rag-meta-content">';
  if (matchedFeatures.length > 0) {
    for (var i = 0; i < Math.min(matchedFeatures.length, 5); i++) {
      var featureSummary = featureLabel(matchedFeatures[i]);
      metaHtml += renderSignalCard(
        matchedFeatures[i].canonicalName || ("特征 " + (i + 1)),
        featureSummary,
        matchedFeatures[i].featureType ? [FEATURE_TYPE_CN[matchedFeatures[i].featureType] || matchedFeatures[i].featureType] : [],
        "feature",
      );
    }
    if (matchedFeatures.length > 5) metaHtml += '<div class="section-mini-label">其余特征：' + esc(String(matchedFeatures.length - 5)) + ' 项</div>';
  } else {
    metaHtml += '暂无命中特征数据';
  }
  metaHtml += '</div>';
  metaHtml += '</div>';

  if (reviewData.queryContext && reviewData.queryContext.matchedFeatureNodes && reviewData.queryContext.matchedFeatureNodes.length) {
    metaHtml += '<div class="graph-rag-meta-card">';
    metaHtml += '<div class="graph-rag-meta-label">命中的特征节点列表</div>';
    metaHtml += '<div class="graph-rag-meta-content">' + renderBulletedPills(reviewData.queryContext.matchedFeatureNodes, "feature") + '</div>';
    metaHtml += '</div>';
  }

  // Similar candidates (Chinese-friendly)
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">相似候选人参考网络（共 ' + similarCandidates.length + ' 位）</div>';
  metaHtml += '<div class="graph-rag-meta-content">';
  if (similarCandidates.length > 0) {
    var neighborCards = [];
    for (var j = 0; j < Math.min(similarCandidates.length, 5); j++) {
      var sc = similarCandidates[j];
      neighborCards.push({
        id: typeof sc === "string" ? sc : (sc.candidateId || sc.id || ""),
        score: typeof sc === "string" ? "" : String(sc.similarityScore || ""),
        summary: typeof sc === "string" ? "" : summarizeEdgeReason(sc.edgeReason),
      });
    }
    metaHtml += renderNeighborCards(neighborCards);
    if (similarCandidates.length > 5) metaHtml += '<div class="section-mini-label">其余相似候选：' + esc(String(similarCandidates.length - 5)) + ' 位</div>';
  } else {
    metaHtml += '暂无相似候选人参考数据';
  }
  metaHtml += '</div>';
  metaHtml += '</div>';

  // Human decision checkpoint
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">人类决策检查点</div>';
  metaHtml += '<div class="graph-rag-meta-content">' + esc(String(reviewData.humanDecisionCheckpoint || "待人工确认")) + '</div>';
  metaHtml += '</div>';

  metaHtml += '</div>';

  if (reviewData.walkTrace && reviewData.walkTrace.steps && reviewData.walkTrace.steps.length) {
    metaHtml += '<div class="graph-walk-trace">';
    metaHtml += '<div class="graph-walk-trace-head">';
    metaHtml += '<div class="graph-rag-meta-label">图游走过程</div>';
    metaHtml += '<div class="graph-walk-trace-summary">' + esc(reviewData.walkTrace.safeSummary || "") + '</div>';
    metaHtml += '</div>';
    for (var w = 0; w < reviewData.walkTrace.steps.length; w++) {
      var step = reviewData.walkTrace.steps[w];
      metaHtml += '<div class="graph-walk-step">';
      metaHtml += '<div class="graph-walk-step-order">' + esc(String(step.order || (w + 1))) + '</div>';
      metaHtml += '<div class="graph-walk-step-body">';
      metaHtml += '<div class="graph-walk-step-title">' + esc(step.title || "图游走步骤") + '</div>';
      metaHtml += '<div class="graph-walk-step-summary">' + esc(step.summary || "") + '</div>';
      if (step.metricLabel && step.metricValue) {
        metaHtml += '<div class="graph-walk-step-metric">' + esc(step.metricLabel) + '：' + esc(step.metricValue) + '</div>';
      }
      metaHtml += '</div>';
      metaHtml += '</div>';
    }
    metaHtml += '</div>';
  }

  if (reviewData.queryContext && reviewData.queryContext.scoreBreakdown && reviewData.queryContext.scoreBreakdown.length) {
    metaHtml += '<div class="graph-walk-trace">';
    metaHtml += '<div class="graph-walk-trace-head">';
    metaHtml += '<div class="graph-rag-meta-label">每一步为什么加分 / 减分</div>';
    metaHtml += '<div class="graph-walk-trace-summary">按查询约束对当前候选人做结构化打分</div>';
    metaHtml += '</div>';
    for (var s = 0; s < reviewData.queryContext.scoreBreakdown.length; s++) {
      var scoreStep = reviewData.queryContext.scoreBreakdown[s];
      metaHtml += '<div class="graph-score-step ' + (scoreStep.score >= 0 ? "positive" : "negative") + '">';
      metaHtml += '<div class="graph-score-step-label">' + esc(scoreStep.label) + '</div>';
      metaHtml += '<div class="graph-score-step-reason">' + esc(scoreStep.reason) + '</div>';
      metaHtml += '<div class="graph-score-step-value">' + (scoreStep.score >= 0 ? "+" : "") + esc(String(scoreStep.score)) + '</div>';
      metaHtml += '</div>';
    }
    metaHtml += '</div>';
  }

  if (reviewData.queryContext && reviewData.queryContext.neighborExpansionOrder && reviewData.queryContext.neighborExpansionOrder.length) {
    metaHtml += '<div class="graph-walk-trace">';
    metaHtml += '<div class="graph-walk-trace-head">';
    metaHtml += '<div class="graph-rag-meta-label">邻居扩散顺序</div>';
    metaHtml += '<div class="graph-walk-trace-summary">按当前查询上下文查看从种子候选人向邻居扩展的顺序</div>';
    metaHtml += '</div>';
    for (var n = 0; n < reviewData.queryContext.neighborExpansionOrder.length; n++) {
      var neighbor = reviewData.queryContext.neighborExpansionOrder[n];
      metaHtml += '<div class="graph-walk-step">';
      metaHtml += '<div class="graph-walk-step-order">' + esc(String(n + 1)) + '</div>';
      metaHtml += '<div class="graph-walk-step-body">';
      metaHtml += '<div class="graph-walk-step-title">' + esc(neighbor.candidateId) + '</div>';
      metaHtml += '<div class="graph-walk-step-summary">' + esc(neighbor.reason) + '</div>';
      metaHtml += '<div class="graph-walk-step-metric">相似度：' + esc(String(neighbor.similarityScore)) + (neighbor.queryOverlap && neighbor.queryOverlap.length ? ' · 共享查询信号：' + esc(neighbor.queryOverlap.join("、")) : '') + '</div>';
      metaHtml += '</div>';
      metaHtml += '</div>';
    }
    metaHtml += '</div>';
  }

  if (reviewData.queryContext && reviewData.queryContext.subgraph) {
    metaHtml += renderQueryAwareSubgraph(reviewData.queryContext.subgraph);
  }

  // Disclaimer
  metaHtml += '<div class="graph-rag-disclaimer">Graph RAG 仅提供参考证据辅助人工判断，不做最终录用/淘汰决策。Competition 证据不进入 Agent prompt。所有录用/淘汰操作必须由人类操作员确认执行。</div>';
  metaHtml += '</div>';

  zone.insertAdjacentHTML("beforeend", metaHtml);
  requestAnimationFrame(function () {
    mountThreeLayerGraph();
  });
}

// ── Search initialisation ──

export function initGraphRagSearch(initialQuery) {
  initGraphSceneSwitcher();
  var input = document.getElementById("candidate-search-input");
  if (!input) return;

  if (typeof initialQuery === "string" && initialQuery.length > 0) {
    input.value = initialQuery;
    doGraphSearch(initialQuery);
  } else {
    setGraphSearchIdleState();
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      doGraphSearch(input.value.trim());
    }
  });
  input.addEventListener("input", function () {
    if (!input.value.trim()) {
      setGraphSearchIdleState();
    }
  });

  // Wire preset buttons
  var presetBtns = document.querySelectorAll(".graph-search-preset-btn");
  for (var p = 0; p < presetBtns.length; p++) {
    presetBtns[p].addEventListener("click", function () {
      var query = this.getAttribute("data-preset") || "";
      if (input && query) {
        input.value = query;
        doGraphSearch(query);
      }
    });
  }
}

function loadReviewerScenario(candidateId) {
  switchGraphScene("reviewer");
  switchReviewerMode("existing");
  var panel = document.getElementById("reviewer-result-panel");
  if (!panel) return;
  panel.innerHTML = '<div class="loading-pulse">正在运行 Reviewer RAG...</div>';
  fetch("/api/competition/reviewer-live?candidateId=" + encodeURIComponent(candidateId))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) {
        panel.innerHTML = '<div class="graph-canvas-empty">' + esc(data.error) + '</div>';
        return;
      }
      renderReviewerScenario(panel, data, candidateId);
    })
    .catch(function () {
      panel.innerHTML = '<div class="graph-canvas-empty">Reviewer RAG 加载失败</div>';
    });
}

function loadReviewerAdHocScenario() {
  switchGraphScene("reviewer");
  switchReviewerMode("new");
  var panel = document.getElementById("reviewer-result-panel");
  if (!panel) return;
  panel.innerHTML = '<div class="loading-pulse">正在抽取简历、检索邻居并运行 Reviewer RAG...</div>';
  var candidateLabel = document.getElementById("reviewer-ad-hoc-label");
  var role = document.getElementById("reviewer-ad-hoc-role");
  var jobDescription = document.getElementById("reviewer-ad-hoc-job-description");
  var resume = document.getElementById("reviewer-ad-hoc-resume");
  fetch("/api/competition/reviewer-ad-hoc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidateLabel: candidateLabel ? candidateLabel.value.trim() : "",
      role: role ? role.value.trim() : "",
      jobDescription: jobDescription ? jobDescription.value.trim() : "",
      resumeText: resume ? resume.value.trim() : "",
    }),
  })
    .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
    .then(function (result) {
      if (!result.ok) {
        throw new Error((result.data && result.data.error) || "临时简历复核失败");
      }
      renderReviewerScenario(panel, result.data, result.data.candidate && result.data.candidate.candidateId ? result.data.candidate.candidateId : "CAN-ADHOC-000001");
    })
    .catch(function (err) {
      panel.innerHTML = '<div class="graph-canvas-empty">' + esc(err.message || "临时简历复核失败") + '</div>';
    });
}

function doGraphSearch(query) {
  if (!query || !query.trim()) {
    setGraphSearchIdleState();
    return;
  }
  var grid = document.getElementById("candidate-grid");
  var trace = document.getElementById("graph-search-trace");
  var empty = document.getElementById("graph-search-empty");
  var zone = document.getElementById("graph-rag-zone");
  if (empty) empty.hidden = true;
  if (trace) trace.hidden = false;
  if (grid) grid.hidden = false;
  if (zone) zone.hidden = false;
  if (grid) grid.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1">正在检索 Graph RAG...</div>';

  fetch("/api/competition/search?q=" + encodeURIComponent(query))
    .then(function (r) {
      if (!r.ok) throw new Error("Graph RAG search returned " + r.status);
      return r.json();
    })
    .then(function (data) {
      renderCandidateGrid(data);
      saveSearchHistory(query, data);
    })
    .catch(function () {
      if (grid) grid.innerHTML = '<div class="graph-canvas-empty" style="grid-column:1/-1">' +
        '<div class="graph-search-empty-title">Graph RAG 全量镜像暂不可用</div>' +
        '<div class="graph-search-empty-text">Competition Graph RAG 服务暂时不可用。Feishu Base 演示样本不受影响，但全量智能检索需等待 Competition 数据恢复。</div>' +
        '<div class="graph-search-empty-source">已降级：可尝试点击 Demo 查询预设，或稍后重试</div>' +
        '</div>';
      selectedCandidateId = null;
      clearGraphMeta();
      var canvas = document.getElementById("graph-canvas");
      if (canvas) canvas.innerHTML = '<div class="graph-canvas-empty">Graph RAG 检索失败，已降级到只读演示面板</div>';
    });
}

function setGraphSearchIdleState() {
  hasGraphSearchResults = false;
  selectedCandidateId = null;
  latestSearchTrace = null;
  clearGraphMeta();
  var title = document.getElementById("queue-title");
  var subtitle = document.getElementById("queue-subtitle");
  var trace = document.getElementById("graph-search-trace");
  var grid = document.getElementById("candidate-grid");
  var empty = document.getElementById("graph-search-empty");
  var zone = document.getElementById("graph-rag-zone");
  var canvas = document.getElementById("graph-canvas");
  if (title) title.textContent = "Graph RAG 查询 · Competition 全量镜像";
  if (subtitle) subtitle.textContent = "输入自然语言查询或点击上方 Demo 预设 · 5991 candidates / 23961 evidence / 38 roles";
  if (trace) {
    trace.hidden = true;
    trace.innerHTML = "";
  }
  if (grid) {
    grid.hidden = true;
    grid.innerHTML = "";
  }
  if (empty) {
    empty.hidden = false;
    empty.innerHTML = '<div class="graph-search-empty-title">等待查询</div>' +
      '<div class="graph-search-empty-text">输入岗位、技能、学历或其他自然语言条件后按回车，或点击上方 Demo 查询预设按钮。</div>' +
      '<div class="graph-search-empty-source">数据源：Competition Graph RAG 全量镜像（5991 candidates / 23961 evidence / 38 roles）<br>Feishu Base 仅承载业务演示样本，Graph RAG 负责全量智能检索</div>';
  }
  if (zone) zone.hidden = true;
  if (canvas) canvas.innerHTML = '<div class="graph-canvas-empty">← 点击上方候选人卡片以查看图谱深度分析</div>';
}

function setGraphSearchActiveState(hasCandidates) {
  hasGraphSearchResults = Boolean(hasCandidates);
  var trace = document.getElementById("graph-search-trace");
  var grid = document.getElementById("candidate-grid");
  var empty = document.getElementById("graph-search-empty");
  var zone = document.getElementById("graph-rag-zone");
  if (trace) trace.hidden = false;
  if (grid) grid.hidden = false;
  if (empty) empty.hidden = true;
  if (zone) zone.hidden = currentGraphScene !== "search" || !hasGraphSearchResults;
}

function renderSearchTrace(searchData) {
  var host = document.getElementById("graph-search-trace");
  if (!host) return;
  var trace = searchData && searchData.trace ? searchData.trace : null;
  if (!trace) {
    host.innerHTML = "";
    return;
  }

  var html = '<div class="graph-search-trace-panel">';
  html += '<div class="graph-search-trace-head">';
  html += '<div class="graph-rag-meta-label">检索过程</div>';
  html += '<div class="graph-search-trace-summary">' + esc(searchData.safeSummary || "") + '</div>';
  html += '</div>';
  html += '<div class="graph-search-trace-stats">';
  html += '<span class="graph-search-chip">数据源：Competition Graph RAG 全量镜像（5991 candidates）</span>';
  html += '<span class="graph-search-chip">模式：' + esc(trace.mode === "query_search" ? "查询检索" : "默认推荐") + '</span>';
  html += '<span class="graph-search-chip">候选人池：' + esc(String(trace.candidateCountBeforeFilter || 0)) + '</span>';
  html += '<span class="graph-search-chip">返回：' + esc(String(trace.candidateCountAfterFilter || 0)) + '</span>';
  if (trace.normalizedTokens && trace.normalizedTokens.length) {
    html += '<span class="graph-search-chip">Token：' + esc(trace.normalizedTokens.join(" / ")) + '</span>';
  }
  html += '</div>';

  if (trace.candidates && trace.candidates.length) {
    html += '<div class="graph-search-trace-list">';
    for (var i = 0; i < trace.candidates.length && i < 6; i++) {
      var candidate = trace.candidates[i];
      html += '<div class="graph-search-trace-item">';
      html += '<div class="graph-search-trace-item-top">';
      html += '<span class="graph-search-trace-id">' + esc(candidate.candidateId || "") + '</span>';
      html += '<span class="graph-search-trace-score">最终分 ' + esc(String(candidate.finalScore)) + "</span>";
      html += '</div>';
      html += '<div class="graph-search-trace-role">' + esc(cnRole(candidate.role || "")) + '</div>';
      html += '<div class="graph-search-trace-breakdown">基础分 ' + esc(String(candidate.baseScore)) + ' + 检索增益 ' + esc(String(candidate.boostScore)) + '</div>';
      if (candidate.matchedTokens && candidate.matchedTokens.length) {
        html += '<div class="graph-search-trace-tokens">命中 Token：' + esc(candidate.matchedTokens.join("、")) + '</div>';
      }
      if (candidate.contributions && candidate.contributions.length) {
        html += '<div class="graph-search-trace-contribs">';
        for (var j = 0; j < candidate.contributions.length; j++) {
          var contrib = candidate.contributions[j];
          html += '<span class="graph-search-chip">' + esc(contrib.reason || contrib.source) + " " + (contrib.score >= 0 ? "+" : "") + esc(String(contrib.score)) + "</span>";
        }
        html += "</div>";
      }
      if (candidate.matchedFeatureNodes && candidate.matchedFeatureNodes.length) {
        html += '<div class="graph-search-trace-tokens">命中特征节点：' + esc(candidate.matchedFeatureNodes.join("、")) + '</div>';
      }
      if (candidate.missingRequirements && candidate.missingRequirements.length) {
        html += '<div class="graph-search-trace-tokens">缺失约束：' + esc(candidate.missingRequirements.join("、")) + '</div>';
      }
      html += "</div>";
    }
    html += "</div>";
  }

  if (trace.topSeedFeatures && trace.topSeedFeatures.length) {
    html += '<div class="graph-search-trace-extra">';
    html += '<div class="graph-rag-meta-label">种子特征节点</div>';
    html += '<div class="graph-search-trace-contribs">';
    for (var sf = 0; sf < trace.topSeedFeatures.length; sf++) {
      html += '<span class="graph-search-chip">' + esc(trace.topSeedFeatures[sf]) + '</span>';
    }
    html += '</div>';
    html += '</div>';
  }

  if (trace.topExpandedFeatures && trace.topExpandedFeatures.length) {
    html += '<div class="graph-search-trace-extra">';
    html += '<div class="graph-rag-meta-label">扩散后的关键特征节点</div>';
    html += '<div class="graph-search-trace-contribs">';
    for (var ef = 0; ef < trace.topExpandedFeatures.length; ef++) {
      html += '<span class="graph-search-chip">' + esc(trace.topExpandedFeatures[ef]) + '</span>';
    }
    html += '</div>';
    html += '</div>';
  }

  if (trace.llmSummary) {
    html += '<div class="graph-search-trace-extra">';
    html += '<div class="graph-rag-meta-label">LLM 检索结论</div>';
    html += '<div class="graph-search-trace-summary">' + esc(trace.llmSummary) + '</div>';
    if (trace.followUpQuestion) {
      html += '<div class="graph-search-trace-followup">' + esc(trace.followUpQuestion) + '</div>';
    }
    html += '</div>';
  }

  html += "</div>";
  host.innerHTML = html;
}

function renderQueryAwareSubgraph(subgraph) {
  var nodes = Array.isArray(subgraph.nodes) ? subgraph.nodes : [];
  var edges = Array.isArray(subgraph.edges) ? subgraph.edges : [];
  var stages = [0, 1, 2, 3, 4];
  var html = '<div class="graph-subgraph-panel">';
  html += '<div class="graph-walk-trace-head">';
  html += '<div class="graph-rag-meta-label">Query-aware Subgraph 路径图</div>';
  html += '<div class="graph-walk-trace-summary">从查询条件出发，经过特征节点、候选人节点、邻居节点，最后进入人工检查点</div>';
  html += '</div>';
  html += '<div class="graph-subgraph-flow">';
  for (var i = 0; i < stages.length; i++) {
    var stage = stages[i];
    var stageNodes = nodes.filter(function (node) { return node.stage === stage; });
    html += '<div class="graph-subgraph-column">';
    for (var j = 0; j < stageNodes.length; j++) {
      var node = stageNodes[j];
      html += '<div class="graph-subgraph-node kind-' + esc(node.kind) + '">';
      html += '<div class="graph-subgraph-node-label">' + esc(node.label) + '</div>';
      var outgoing = edges.filter(function (edge) { return edge.source === node.id; });
      if (outgoing.length) {
        html += '<div class="graph-subgraph-node-meta">' + esc(outgoing.map(function (edge) { return edge.label; }).join(" · ")) + '</div>';
      }
      html += '</div>';
    }
    if (i < stages.length - 1) {
      html += '<div class="graph-subgraph-arrow">&#8594;</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function renderReviewerScenario(panel, data, candidateId) {
  var decision = data.reviewerDecision || {};
  var candidate = data.candidate || {};
  var gnnSignal = data.gnnSignal || {};
  var projection = data.graphProjection || {};
  var topSignals = data.reviewerSignals && Array.isArray(data.reviewerSignals.topGeneralSignals) ? data.reviewerSignals.topGeneralSignals : [];
  var topNeighbors = data.reviewerSignals && Array.isArray(data.reviewerSignals.topNeighbors) ? data.reviewerSignals.topNeighbors : [];
  var matchedFeatures = Array.isArray(data.matchedFeatures) ? data.matchedFeatures : [];

  var decisionLabel = decision.decision === "select" ? "建议录取" : decision.decision === "reject" ? "建议不录取" : "待人工判断";
  var confidence = decision.confidence != null ? Math.round(Number(decision.confidence) * 100) + "%" : "—";

  var html = '<div class="reviewer-hero">';
  html += '<div class="reviewer-hero-main">';
  html += '<div class="reviewer-hero-kicker">Reviewer RAG · 单简历复核</div>';
  html += '<div class="reviewer-hero-title">' + esc(candidateId) + " · " + esc(cnRole(candidate.role || "")) + '</div>';
  html += '<div class="reviewer-hero-decision ' + (decision.decision === "select" ? "positive" : decision.decision === "reject" ? "negative" : "neutral") + '">' + esc(decisionLabel) + '</div>';
  html += '<div class="reviewer-hero-summary">' + esc(decision.reviewSummary || "当前为图谱静态复核视图，未拿到最终 LLM 判定。") + '</div>';
  html += '</div>';
  html += '<div class="reviewer-hero-metrics">';
  html += '<div class="reviewer-metric"><span class="reviewer-metric-label">置信度</span><span class="reviewer-metric-value">' + esc(confidence) + '</span></div>';
  html += '<div class="reviewer-metric"><span class="reviewer-metric-label">图投影</span><span class="reviewer-metric-value">' + esc(graphProjectionLabel(projection.label)) + '</span></div>';
  html += '<div class="reviewer-metric"><span class="reviewer-metric-label">GNN</span><span class="reviewer-metric-value">' + esc(gnnSignal.prediction || "—") + '</span></div>';
  html += '</div>';
  html += '</div>';

  html += renderThreeLayerGraph(data, candidateId);

  html += '<div class="reviewer-grid">';
  html += '<div class="reviewer-card"><div class="graph-rag-meta-label">岗位与候选人判断依据</div><div class="reviewer-card-body">';
  html += renderSignalCard(
    decision.reasonLabel || "待补充",
    decision.reviewSummary || data.humanDecisionCheckpoint || "图谱给出证据，人类做最终决策。",
    [decision.reasonGroup || "待补充分组"],
    decision.decision === "select" ? "success" : decision.decision === "reject" ? "danger" : "warning",
  );
  html += '</div></div>';

  html += '<div class="reviewer-card"><div class="graph-rag-meta-label">个人信息与关键特征</div><div class="reviewer-card-body">';
  for (var i = 0; i < Math.min(matchedFeatures.length, 6); i++) {
    html += renderSignalCard(
      matchedFeatures[i].canonicalName || ("特征 " + (i + 1)),
      featureLabel(matchedFeatures[i]),
      matchedFeatures[i].featureType ? [FEATURE_TYPE_CN[matchedFeatures[i].featureType] || matchedFeatures[i].featureType] : [],
      "feature",
    );
  }
  if (!matchedFeatures.length) html += '<div class="reviewer-line">暂无结构化特征</div>';
  html += '</div></div>';

  html += '<div class="reviewer-card"><div class="graph-rag-meta-label">Top General Signals</div><div class="reviewer-card-body">';
  for (var j = 0; j < Math.min(topSignals.length, 6); j++) {
    var signal = topSignals[j];
    html += renderSignalCard(
      signal.canonical_name || signal.feature_type || "signal",
      signal.feature_value || "通用信号",
      signal.feature_type ? [FEATURE_TYPE_CN[signal.feature_type] || signal.feature_type] : [],
      "info",
    );
  }
  if (!topSignals.length) html += '<div class="reviewer-line">暂无 general signals</div>';
  html += '</div></div>';

  html += '<div class="reviewer-card reviewer-card-wide"><div class="graph-rag-meta-label">邻居证据与历史判断</div><div class="reviewer-card-body">';
  var reviewNeighborCards = [];
  for (var k = 0; k < Math.min(topNeighbors.length, 5); k++) {
    var neighbor = topNeighbors[k];
    reviewNeighborCards.push({
      id: neighbor.candidate_id || "",
      score: "相似度 " + String(neighbor.similarity_score || ""),
      status: (neighbor.decision_gt || "unknown") + " · " + (neighbor.reason_label || "unknown"),
      summary: neighbor.edge_reason || "",
    });
  }
  html += renderNeighborCards(reviewNeighborCards);
  if (!topNeighbors.length) html += '<div class="reviewer-line">暂无邻居证据</div>';
  html += '</div></div>';
  html += '</div>';

  if (data.walkTrace && data.walkTrace.steps && data.walkTrace.steps.length) {
    html += '<div class="graph-walk-trace">';
    html += '<div class="graph-walk-trace-head">';
    html += '<div class="graph-rag-meta-label">复核游走过程</div>';
    html += '<div class="graph-walk-trace-summary">' + esc(data.walkTrace.safeSummary || "") + '</div>';
    html += '</div>';
    for (var w = 0; w < data.walkTrace.steps.length; w++) {
      var step = data.walkTrace.steps[w];
      html += '<div class="graph-walk-step">';
      html += '<div class="graph-walk-step-order">' + esc(String(step.order || (w + 1))) + '</div>';
      html += '<div class="graph-walk-step-body">';
      html += '<div class="graph-walk-step-title">' + esc(step.title || "复核步骤") + '</div>';
      html += '<div class="graph-walk-step-summary">' + esc(step.summary || "") + '</div>';
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
  }

  panel.innerHTML = html;
  requestAnimationFrame(function () {
    mountThreeLayerGraph();
  });
}

function renderThreeLayerGraph(reviewData, candidateId) {
  var queryContext = reviewData.queryContext || null;
  var matchedFeatures = Array.isArray(reviewData.matchedFeatures) ? reviewData.matchedFeatures.slice(0, 8) : [];
  var similarCandidates = Array.isArray(reviewData.similarCandidates) ? reviewData.similarCandidates.slice(0, 5) : [];
  var searchTrace = latestSearchTrace || null;
  var featureFeaturePaths = searchTrace && Array.isArray(searchTrace.featureFeaturePaths) ? searchTrace.featureFeaturePaths : [];
  var topNodes = [];
  var selectedNodes = [];
  var neighborNodes = [];
  var bottomNodes = [];
  var edges = [];

  topNodes.push({
    id: "job-query",
    kind: "job-query",
    shortLabel: "岗位需求",
    detailTitle: "岗位与查询总览",
    detailBody:
      "岗位信息：" + (reviewData.roleMemory ? summarizeRoleMemory(reviewData.roleMemory) : "暂无岗位记忆") +
      "\n查询：" + (queryContext && queryContext.query ? queryContext.query : "默认推荐"),
  });
  topNodes.push({
    id: "job-memory",
    kind: "job-memory",
    shortLabel: "岗位记忆",
    detailTitle: "岗位历史记忆",
    detailBody: summarizeRoleMemory(reviewData.roleMemory || ""),
  });
  if (reviewData.graphProjection) {
    topNodes.push({
      id: "job-projection",
      kind: "job-projection",
      shortLabel: "图投影",
      detailTitle: "图投影先验",
      detailBody:
        "标签：" + graphProjectionLabel(reviewData.graphProjection.label) +
        "\n置信度：" + Math.round(Number(reviewData.graphProjection.confidence || 0) * 100) + "%" +
        "\n图分：" + String(reviewData.graphProjection.graphScore || "") +
        "\n说明：" + (reviewData.graphProjection.signalSummary || ""),
    });
  }

  selectedNodes.push({
    id: "resume-main",
    kind: "resume-main",
    shortLabel: candidateId,
    detailTitle: "当前简历节点",
    detailBody:
      "候选人：" + candidateId +
      "\n判断：" + graphProjectionLabel(reviewData.graphProjection && reviewData.graphProjection.label) +
      "\n说明：" + (reviewData.humanDecisionCheckpoint || "待人工确认"),
  });

  for (var j = 0; j < similarCandidates.length; j++) {
    var neighbor = similarCandidates[j];
    neighborNodes.push({
      id: "resume-neighbor-" + j,
      kind: "resume-neighbor",
      shortLabel: neighbor.candidateId || ("邻居 " + (j + 1)),
      detailTitle: neighbor.candidateId || "相似简历节点",
      detailBody:
        "相似度：" + String(neighbor.similarityScore || "") +
        "\n原因：" + summarizeEdgeReason(neighbor.edgeReason || ""),
    });
  }

  var featureMap = {};
  for (var i = 0; i < matchedFeatures.length; i++) {
    var feature = matchedFeatures[i];
    featureMap[feature.canonicalName] = {
      canonicalName: feature.canonicalName,
      featureType: feature.featureType,
      featureValue: feature.featureValue,
      sourceSnippet: feature.sourceSnippet,
      confidence: feature.confidence,
    };
  }
  for (var fp = 0; fp < featureFeaturePaths.length; fp++) {
    var pathMeta = featureFeaturePaths[fp];
    var sourceName = featureKeyLabel(pathMeta.source_feature_key);
    var targetName = featureKeyLabel(pathMeta.target_feature_key);
    if (sourceName && !featureMap[sourceName]) {
      featureMap[sourceName] = {
        canonicalName: sourceName,
        featureType: featureKeyType(pathMeta.source_feature_key),
        featureValue: null,
        sourceSnippet: "来自 feature walk 扩散",
        confidence: Math.max(0.35, Number(pathMeta.propagated_activation || 0.35)),
      };
    }
    if (targetName && !featureMap[targetName]) {
      featureMap[targetName] = {
        canonicalName: targetName,
        featureType: featureKeyType(pathMeta.target_feature_key),
        featureValue: null,
        sourceSnippet: "来自 feature walk 扩散",
        confidence: Math.max(0.35, Number(pathMeta.propagated_activation || 0.35)),
      };
    }
  }

  var featureList = Object.keys(featureMap).map(function (key) { return featureMap[key]; }).slice(0, 10);
  for (var i = 0; i < featureList.length; i++) {
    var feature = featureList[i];
    bottomNodes.push({
      id: "skill-" + i,
      kind: "skill",
      shortLabel: feature.canonicalName || ("技能 " + (i + 1)),
      detailTitle: feature.canonicalName || "技能节点",
      detailBody:
        "类型：" + (FEATURE_TYPE_CN[feature.featureType] || feature.featureType || "特征") +
        (feature.featureValue ? "\n值：" + feature.featureValue : "") +
        (feature.sourceSnippet ? "\n证据：" + feature.sourceSnippet : ""),
      weight: Number(feature.confidence || 0.6),
    });
  }

  edges.push({ source: "job-query", target: "resume-main", label: "查询约束", weight: 0.95, kind: "job-link" });
  edges.push({ source: "job-memory", target: "resume-main", label: "岗位记忆", weight: 0.72, kind: "job-link" });
  if (reviewData.graphProjection) {
    edges.push({
      source: "job-projection",
      target: "resume-main",
      label: "图投影",
      weight: Number(reviewData.graphProjection.confidence || 0.7),
      kind: "job-link",
    });
  }

  for (var m = 0; m < neighborNodes.length; m++) {
    var resumeNode = neighborNodes[m];
    var neighborData = similarCandidates[m];
    edges.push({
      source: "resume-main",
      target: resumeNode.id,
      label: "相似",
      weight: Number(neighborData && neighborData.similarityScore ? neighborData.similarityScore : 0.45),
      kind: "neighbor-link",
    });
  }

  for (var b = 0; b < bottomNodes.length; b++) {
    var bottomNode = bottomNodes[b];
    edges.push({
      source: "resume-main",
      target: bottomNode.id,
      label: "技能命中",
      weight: Number(bottomNode.weight || 0.6),
      kind: "skill-link",
    });
    for (var n = 0; n < similarCandidates.length; n++) {
      var neighborId = "resume-neighbor-" + n;
      if (neighborSharesFeature(similarCandidates[n], bottomNode.shortLabel)) {
        edges.push({
          source: neighborId,
          target: bottomNode.id,
          label: "共享技能",
          weight: Math.max(0.3, Number(similarCandidates[n].similarityScore || 0.4) * 0.7),
          kind: "skill-link-secondary",
        });
      }
    }
  }

  for (var p = 0; p < featureFeaturePaths.length; p++) {
    var featurePath = featureFeaturePaths[p];
    var sourceLabel = featureKeyLabel(featurePath.source_feature_key);
    var targetLabel = featureKeyLabel(featurePath.target_feature_key);
    var sourceNode = findBottomNodeIdByLabel(bottomNodes, sourceLabel);
    var targetNode = findBottomNodeIdByLabel(bottomNodes, targetLabel);
    if (!sourceNode || !targetNode || sourceNode === targetNode) continue;
    edges.push({
      source: sourceNode,
      target: targetNode,
      label: "特征扩散",
      weight: Math.max(Number(featurePath.normalized_weight || 0.25), Number(featurePath.propagated_activation || 0.25)),
      kind: "feature-link",
      extra:
        "特征关联权重：" + formatEdgeWeight(featurePath.normalized_weight) +
        "\n扩散激活：" + formatEdgeWeight(featurePath.propagated_activation),
    });
  }

  var html = '<div class="graph-hierarchy-panel" data-edges="' + escapeAttr(JSON.stringify(edges)) + '">';
  html += '<div class="graph-walk-trace-head">';
  html += '<div class="graph-rag-meta-label">三层图谱总览</div>';
  html += '<div class="graph-walk-trace-summary">最上层是岗位信息，第二层是当前简历，第三层是邻居简历，最下层是技能节点。边粗细表示游走权重，线条流动表示激活方向。</div>';
  html += '</div>';
  html += '<div class="graph-hierarchy-viewport">';
  html += '<svg class="graph-hierarchy-svg" aria-hidden="true"></svg>';
  html += '<div class="graph-hierarchy-layer layer-top"><div class="graph-hierarchy-layer-title">岗位信息层</div>' + renderHierarchyRow(topNodes) + '</div>';
  html += '<div class="graph-hierarchy-layer layer-selected"><div class="graph-hierarchy-layer-title">当前简历层</div>' + renderHierarchyRow(selectedNodes) + '</div>';
  html += '<div class="graph-hierarchy-layer layer-neighbors"><div class="graph-hierarchy-layer-title">邻居简历层</div>' + renderHierarchyRow(neighborNodes) + '</div>';
  html += '<div class="graph-hierarchy-layer layer-bottom"><div class="graph-hierarchy-layer-title">技能节点层</div>' + renderHierarchyRow(bottomNodes) + '</div>';
  html += '<div class="graph-hierarchy-tooltip" hidden></div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderHierarchyRow(nodes) {
  var html = '<div class="graph-hierarchy-row">';
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    html += '<button type="button" class="graph-hierarchy-node kind-' + escapeAttr(node.kind) + '" data-node-id="' + escapeAttr(node.id) + '" data-tooltip-title="' + escapeAttr(node.detailTitle) + '" data-tooltip-body="' + escapeAttr(node.detailBody) + '">';
    html += '<span class="graph-hierarchy-node-dot"></span>';
    html += '<span class="graph-hierarchy-node-label">' + esc(node.shortLabel) + '</span>';
    html += '</button>';
  }
  html += '</div>';
  return html;
}

function neighborSharesFeature(neighbor, featureLabelText) {
  if (!neighbor || !featureLabelText) return false;
  var reason = String(neighbor.edgeReason || "").toLowerCase();
  var label = String(featureLabelText || "").toLowerCase();
  return reason.indexOf(label) !== -1;
}

function featureKeyLabel(featureKey) {
  var parts = String(featureKey || "").split("::");
  return parts[1] || parts[0] || "";
}

function featureKeyType(featureKey) {
  var parts = String(featureKey || "").split("::");
  return parts[0] || "skill";
}

function findBottomNodeIdByLabel(nodes, label) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].shortLabel === label) return nodes[i].id;
  }
  return null;
}

function mountThreeLayerGraph() {
  var panels = document.querySelectorAll(".graph-hierarchy-panel");
  for (var i = 0; i < panels.length; i++) {
    drawThreeLayerEdges(panels[i]);
    bindThreeLayerTooltips(panels[i]);
  }
}

function drawThreeLayerEdges(panel) {
  var svg = panel.querySelector(".graph-hierarchy-svg");
  if (!svg) return;
  var viewport = panel.querySelector(".graph-hierarchy-viewport");
  var tooltip = panel.querySelector(".graph-hierarchy-tooltip");
  if (!viewport) return;
  var rect = viewport.getBoundingClientRect();
  var edgesRaw = panel.getAttribute("data-edges");
  var edges = [];
  try {
    edges = JSON.parse(edgesRaw || "[]");
  } catch (err) {
    edges = [];
  }
  svg.setAttribute("viewBox", "0 0 " + rect.width + " " + rect.height);
  svg.innerHTML = "";
  for (var i = 0; i < edges.length; i++) {
    var edge = edges[i];
    var source = panel.querySelector('[data-node-id="' + edge.source + '"]');
    var target = panel.querySelector('[data-node-id="' + edge.target + '"]');
    if (!source || !target) continue;
    var sourceRect = source.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();
    var sourcePoint = edgeAnchor(sourceRect, targetRect, rect);
    var targetPoint = edgeAnchor(targetRect, sourceRect, rect);
    var x1 = sourcePoint.x;
    var y1 = sourcePoint.y;
    var x2 = targetPoint.x;
    var y2 = targetPoint.y;
    var d = buildCurvedEdgePath(x1, y1, x2, y2, edge.kind);
    var width = 1.2 + (Number(edge.weight || 0.5) * 5);
    var base = document.createElementNS("http://www.w3.org/2000/svg", "path");
    base.setAttribute("d", d);
    base.setAttribute("class", "graph-hierarchy-edge " + (edge.kind || ""));
    base.setAttribute("style", "stroke-width:" + width + "px");
    svg.appendChild(base);
    var flow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    flow.setAttribute("d", d);
    flow.setAttribute("class", "graph-hierarchy-edge-flow " + (edge.kind || ""));
    flow.setAttribute("style", "stroke-width:" + Math.max(1, width - 1.2) + "px");
    svg.appendChild(flow);

    var hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d);
    hit.setAttribute("class", "graph-hierarchy-edge-hit");
    hit.setAttribute("style", "stroke-width:" + Math.max(14, width + 10) + "px");
    svg.appendChild(hit);

    if (tooltip) {
      attachEdgeTooltip(hit, tooltip, viewport, edge, source, target);
    }
  }
}

function bindThreeLayerTooltips(panel) {
  var tooltip = panel.querySelector(".graph-hierarchy-tooltip");
  if (!tooltip) return;
  var nodes = panel.querySelectorAll(".graph-hierarchy-node");
  var viewport = panel.querySelector(".graph-hierarchy-viewport");
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].addEventListener("mouseenter", function (ev) {
      var node = ev.currentTarget;
      showGraphTooltip(
        tooltip,
        viewport,
        node.getBoundingClientRect(),
        node.getAttribute("data-tooltip-title") || "",
        node.getAttribute("data-tooltip-body") || "",
      );
    });
    nodes[i].addEventListener("mouseleave", function () {
      tooltip.hidden = true;
    });
  }
}

function attachEdgeTooltip(hit, tooltip, viewport, edge, source, target) {
  hit.addEventListener("mouseenter", function () {
    var totalLength = hit.getTotalLength();
    var point = hit.getPointAtLength(totalLength / 2);
    var hostRect = viewport.getBoundingClientRect();
    var virtualRect = {
      left: hostRect.left + point.x - 6,
      top: hostRect.top + point.y - 6,
      width: 12,
      height: 12,
    };
    var sourceLabel = source.querySelector(".graph-hierarchy-node-label");
    var targetLabel = target.querySelector(".graph-hierarchy-node-label");
    var title = (edge.label || "连接边") + " · 权重 " + formatEdgeWeight(edge.weight);
    var body = "方向：" +
      ((sourceLabel ? sourceLabel.textContent : edge.source) || "") +
      " → " +
      ((targetLabel ? targetLabel.textContent : edge.target) || "") +
      "\n类型：" + edgeKindLabel(edge.kind) +
      "\n说明：" + edgeMeaning(edge);
    showGraphTooltip(tooltip, viewport, virtualRect, title, body);
  });
  hit.addEventListener("mouseleave", function () {
    tooltip.hidden = true;
  });
}

function showGraphTooltip(tooltip, viewport, rect, title, body) {
  var hostRect = viewport.getBoundingClientRect();
  tooltip.innerHTML =
    '<div class="graph-hierarchy-tooltip-title">' + esc(title || "") + '</div>' +
    '<div class="graph-hierarchy-tooltip-body">' + esc(body || "").replace(/\n/g, "<br>") + '</div>';
  tooltip.hidden = false;
  var left = rect.left - hostRect.left + rect.width + 12;
  var top = rect.top - hostRect.top - 4;
  tooltip.style.left = Math.min(left, hostRect.width - 260) + "px";
  tooltip.style.top = Math.max(8, top) + "px";
}

function formatEdgeWeight(weight) {
  var value = Number(weight || 0);
  if (!isFinite(value)) return "—";
  return value.toFixed(2);
}

function edgeKindLabel(kind) {
  if (kind === "job-link") return "岗位约束边";
  if (kind === "neighbor-link") return "邻居相似边";
  if (kind === "skill-link") return "主技能命中边";
  if (kind === "skill-link-secondary") return "邻居共享技能边";
  return "图谱连接边";
}

function edgeMeaning(edge) {
  if (edge.kind === "job-link") return "岗位要求、岗位记忆或图投影对当前简历节点的约束强度。";
  if (edge.kind === "neighbor-link") return "当前简历与相似简历之间的相似度连接，权重越粗表示越相近。";
  if (edge.kind === "skill-link") return "当前简历命中该技能/特征节点的激活强度。";
  if (edge.kind === "skill-link-secondary") return "相似简历与该技能节点共享证据的强度。";
  if (edge.kind === "feature-link") return "技能/特征节点之间的关联边，来自 competition 的 feature walk 扩散路径。";
  return "图谱节点之间的连接关系。";
}

function edgeAnchor(fromRect, toRect, hostRect) {
  var fromCx = fromRect.left + fromRect.width / 2 - hostRect.left;
  var fromCy = fromRect.top + fromRect.height / 2 - hostRect.top;
  var toCx = toRect.left + toRect.width / 2 - hostRect.left;
  var toCy = toRect.top + toRect.height / 2 - hostRect.top;
  var dx = toCx - fromCx;
  var dy = toCy - fromCy;
  var halfW = Math.max(10, fromRect.width / 2 - 10);
  var halfH = Math.max(10, fromRect.height / 2 - 10);
  var scale = 1 / Math.max(Math.abs(dx) / halfW || 0, Math.abs(dy) / halfH || 0, 1);
  return {
    x: fromCx + dx * scale,
    y: fromCy + dy * scale,
  };
}

function buildCurvedEdgePath(x1, y1, x2, y2, kind) {
  if (kind === "neighbor-link") {
    var midY = Math.min(y1, y2) - 34;
    return "M " + x1 + " " + y1 + " C " + x1 + " " + midY + ", " + x2 + " " + midY + ", " + x2 + " " + y2;
  }
  if (kind === "feature-link") {
    var bow = Math.max(y1, y2) + 42;
    return "M " + x1 + " " + y1 + " C " + x1 + " " + bow + ", " + x2 + " " + bow + ", " + x2 + " " + y2;
  }
  if (kind === "skill-link-secondary") {
    var sideBend = Math.abs(x2 - x1) * 0.25;
    return "M " + x1 + " " + y1 + " C " + (x1 + sideBend) + " " + y1 + ", " + (x2 - sideBend) + " " + y2 + ", " + x2 + " " + y2;
  }
  var dy = Math.max(36, Math.abs(y2 - y1) * 0.38);
  return "M " + x1 + " " + y1 + " C " + x1 + " " + (y1 + dy) + ", " + x2 + " " + (y2 - dy) + ", " + x2 + " " + y2;
}
