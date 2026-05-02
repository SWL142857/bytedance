import { esc } from "./helpers.js";

// ── Graph RAG: Candidate Grid + Deep Analysis Zone ──

var selectedCandidateId = null;

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

function clearGraphMeta() {
  var existingMeta = document.getElementById("graph-rag-meta-container");
  if (existingMeta) existingMeta.remove();
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

  if (!candidates.length) {
    grid.innerHTML = '<div class="graph-canvas-empty" style="grid-column:1/-1">无搜索结果</div>';
    selectedCandidateId = null;
    clearGraphMeta();
    var canvas = document.getElementById("graph-canvas");
    if (canvas) canvas.innerHTML = '<div class="graph-canvas-empty">当前查询没有可复核候选人</div>';
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
  if (subtitle) subtitle.textContent = "来自 Competition Graph RAG 检索结果 · 点击卡片进入深度图谱分析";

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

// ── Graph RAG Deep Analysis (from /api/competition/review) ──

export function loadGraphReview(candidateId) {
  var canvas = document.getElementById("graph-canvas");
  if (!canvas) return;
  clearGraphMeta();
  canvas.innerHTML = '<div class="loading-pulse">正在加载图谱分析...</div>';

  fetch("/api/competition/review?candidateId=" + encodeURIComponent(candidateId))
    .then(function (r) { return r.json(); })
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
  metaHtml += '<div class="graph-rag-meta" id="graph-rag-meta-cards">';

  // Role memory (Chinese-friendly)
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">岗位历史记忆</div>';
  metaHtml += '<div class="graph-rag-meta-content">' + esc(summarizeRoleMemory(reviewData.roleMemory)) + '</div>';
  metaHtml += '</div>';

  // Matched features summary (Chinese-friendly)
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">命中的关键特征（共 ' + matchedFeatures.length + ' 项）</div>';
  metaHtml += '<div class="graph-rag-meta-content">';
  if (matchedFeatures.length > 0) {
    for (var i = 0; i < Math.min(matchedFeatures.length, 5); i++) {
      var f = featureLabel(matchedFeatures[i]);
      metaHtml += '<div style="margin-bottom:3px">· ' + esc(f) + '</div>';
    }
    if (matchedFeatures.length > 5) metaHtml += '<div style="color:var(--text-tertiary)">...及其他 ' + (matchedFeatures.length - 5) + ' 项</div>';
  } else {
    metaHtml += '暂无命中特征数据';
  }
  metaHtml += '</div>';
  metaHtml += '</div>';

  // Similar candidates (Chinese-friendly)
  metaHtml += '<div class="graph-rag-meta-card">';
  metaHtml += '<div class="graph-rag-meta-label">相似候选人参考网络（共 ' + similarCandidates.length + ' 位）</div>';
  metaHtml += '<div class="graph-rag-meta-content">';
  if (similarCandidates.length > 0) {
    for (var j = 0; j < Math.min(similarCandidates.length, 5); j++) {
      var sc = similarCandidates[j];
      var scId = typeof sc === "string" ? sc : (sc.candidateId || sc.id || "");
      var reason = typeof sc === "string" ? "" : summarizeEdgeReason(sc.edgeReason);
      metaHtml += '<div style="margin-bottom:3px;font-size:11px">· <span style="font-family:var(--font-num)">' + esc(scId) + '</span>：' + esc(reason) + '</div>';
    }
    if (similarCandidates.length > 5) metaHtml += '<div style="color:var(--text-tertiary)">...及其他 ' + (similarCandidates.length - 5) + ' 位参考候选人</div>';
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

  // Disclaimer
  metaHtml += '<div class="graph-rag-disclaimer">Graph RAG 仅提供参考证据辅助人工判断，不做最终录用/淘汰决策。Competition 证据不进入 Agent prompt。所有录用/淘汰操作必须由人类操作员确认执行。</div>';
  metaHtml += '</div>';

  zone.insertAdjacentHTML("beforeend", metaHtml);
}

// ── Search initialisation ──

export function initGraphRagSearch(initialQuery) {
  var input = document.getElementById("candidate-search-input");
  if (!input) return;

  if (initialQuery) {
    input.value = initialQuery;
    doGraphSearch(initialQuery);
  } else {
    // Default: fetch initial data
    doGraphSearch("Python");
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var q = input.value.trim();
      if (q) doGraphSearch(q);
    }
  });
}

function doGraphSearch(query) {
  var grid = document.getElementById("candidate-grid");
  if (grid) grid.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1">正在检索 Graph RAG...</div>';

  fetch("/api/competition/search?q=" + encodeURIComponent(query))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      renderCandidateGrid(data);
    })
    .catch(function () {
      if (grid) grid.innerHTML = '<div class="graph-canvas-empty" style="grid-column:1/-1">Graph RAG 检索失败</div>';
      selectedCandidateId = null;
      clearGraphMeta();
      var canvas = document.getElementById("graph-canvas");
      if (canvas) canvas.innerHTML = '<div class="graph-canvas-empty">Graph RAG 检索失败</div>';
    });
}
