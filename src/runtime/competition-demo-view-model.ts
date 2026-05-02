import type { CompetitionRagEnvelope, CompetitionRagEnvelopeCandidate } from "./competition-rag-adapter.js";
import { buildCompetitionRagEnvelope } from "./competition-rag-adapter.js";
import { containsSensitivePattern } from "../server/redaction.js";

export interface CompetitionDemoOverview {
  status: "ready" | "partial" | "empty" | "error";
  candidateCount: number;
  evidenceCount: number;
  roleCount: number;
  roles: CompetitionRoleSummary[];
  highlights: string[];
  safety: {
    readOnly: true;
    evidenceMayEnterPrompt: false;
    writesAllowed: false;
    humanDecisionRequired: true;
  };
}

export interface CompetitionRoleSummary {
  roleId: string;
  roleLabel: string;
  candidateCount: number;
  avgScore: number;
}

export interface CompetitionSearchResult {
  query: string;
  mode: "demo_search";
  candidates: CompetitionCandidateCard[];
  safeSummary: string;
}

export interface CompetitionCandidateReview {
  candidate: CompetitionCandidateCard;
  graphProjection: CompetitionGraphProjection | null;
  gnnSignal: CompetitionGnnSignal | null;
  roleMemory: string | null;
  matchedFeatures: CompetitionFeatureEvidence[];
  similarCandidates: CompetitionNeighborEvidence[];
  humanDecisionCheckpoint: string;
}

export interface CompetitionCandidateCard {
  candidateId: string;
  role: string;
  headline: string;
  matchScore: number;
  recommendationLabel: string;
  topReasons: string[];
  riskNotes: string[];
  featureBadges: string[];
  evidenceCount: number;
  similarCandidateCount: number;
}

export interface CompetitionGraphProjection {
  label: string;
  confidence: number;
  graphScore: number;
  neighborCount: number;
  reviewMode: string;
  signalSummary: string;
}

export interface CompetitionGnnSignal {
  available: boolean;
  selectProbability: number;
  effectivePrediction: string;
  sourceRun: string | null;
}

export interface CompetitionFeatureEvidence {
  featureType: string;
  canonicalName: string;
  featureValue: string | null;
  confidence: number;
  sourceSnippet: string;
}

export interface CompetitionNeighborEvidence {
  candidateId: string;
  similarityScore: number;
  edgeReason: string;
}

const DEFAULT_COMPETITION_ROOT = "competition ";
const DEFAULT_SEARCH_LIMIT = 12;

export interface CompetitionDemoOptions {
  competitionRoot?: string;
  limit?: number;
}

const envelopeCache = new Map<string, CompetitionRagEnvelope>();

function safeGetEnvelope(options: CompetitionDemoOptions): CompetitionRagEnvelope | null {
  const root = options.competitionRoot ?? DEFAULT_COMPETITION_ROOT;
  const cacheKey = `${root}\0${options.limit ?? "all"}`;
  const cached = envelopeCache.get(cacheKey);
  if (cached) return cached;

  try {
    const result = buildCompetitionRagEnvelope({
      competitionRoot: root,
      limit: options.limit,
    });
    envelopeCache.set(cacheKey, result.envelope);
    return result.envelope;
  } catch {
    return null;
  }
}

export function buildCompetitionDemoOverview(options: CompetitionDemoOptions = {}): CompetitionDemoOverview {
  const envelope = safeGetEnvelope(options);

  if (!envelope || envelope.candidates.length === 0) {
    return {
      status: envelope ? "empty" : "error",
      candidateCount: 0,
      evidenceCount: 0,
      roleCount: 0,
      roles: [],
      highlights: [],
      safety: {
        readOnly: true,
        evidenceMayEnterPrompt: false,
        writesAllowed: false,
        humanDecisionRequired: true,
      },
    };
  }

  const roleMap = new Map<string, { count: number; scores: number[]; label: string }>();
  for (const c of envelope.candidates) {
    const roleId = c.job.jobId;
    const roleLabel = c.job.requirements.slice(0, 60);
    const entry = roleMap.get(roleId) ?? { count: 0, scores: [], label: roleLabel };
    entry.count += 1;
    const score = computeCandidateScore(c);
    entry.scores.push(score);
    roleMap.set(roleId, entry);
  }

  const roles: CompetitionRoleSummary[] = [];
  for (const [roleId, data] of roleMap.entries()) {
    const avgScore = data.scores.length > 0
      ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
      : 0;
    roles.push({
      roleId,
      roleLabel: truncateText(data.label || roleId, 40),
      candidateCount: data.count,
      avgScore: roundScore(avgScore),
    });
  }

  roles.sort((a, b) => b.avgScore - a.avgScore);

  const highlights: string[] = [];
  if (roles.length > 0) {
    highlights.push(`共 ${envelope.candidates.length} 位候选人`);
    highlights.push(`${roles.length} 个岗位`);
    if (envelope.evidencePool.length > 0) {
      highlights.push(`${envelope.evidencePool.length} 条图谱证据`);
    }
  }

  return {
    status: "ready",
    candidateCount: envelope.candidates.length,
    evidenceCount: envelope.evidencePool.length,
    roleCount: roleMap.size,
    roles: roles.slice(0, 5),
    highlights,
    safety: {
      readOnly: true,
      evidenceMayEnterPrompt: false,
      writesAllowed: false,
      humanDecisionRequired: true,
    },
  };
}

export function buildCompetitionSearchResult(
  query: string,
  options: CompetitionDemoOptions = {},
): CompetitionSearchResult {
  const envelope = safeGetEnvelope(options);

  if (!envelope || envelope.candidates.length === 0) {
    return {
      query,
      mode: "demo_search",
      candidates: [],
      safeSummary: "暂无候选人数据",
    };
  }

  const normalizedQuery = query.trim();
  const candidates: CompetitionCandidateCard[] = [];

  for (const c of envelope.candidates) {
    const evidenceSnippets = c.evidenceIds
      .map((id) => envelope.evidencePool.find((e) => e.sourceRef === id)?.snippet ?? "")
      .filter((s) => s.length > 0);

    const baseScore = computeCandidateScore(c);
    const boostScore = normalizedQuery.length > 0
      ? computeQueryMatchBoost(c, normalizedQuery, evidenceSnippets)
      : 0;

    const matchScore = normalizedQuery.length > 0
      ? Math.min(baseScore + boostScore, 1.0)
      : baseScore;

    if (normalizedQuery.length > 0 && boostScore < 0.05) continue;

    candidates.push(buildCandidateCard(c, matchScore, envelope));
  }

  candidates.sort((a, b) => b.matchScore - a.matchScore);
  const limited = candidates.slice(0, DEFAULT_SEARCH_LIMIT);

  const safeSummary = normalizedQuery.length > 0
    ? `找到 ${limited.length} 位匹配"${truncateText(query, 20)}"的候选人`
    : `展示前 ${limited.length} 位推荐候选人`;

  return {
    query,
    mode: "demo_search",
    candidates: limited,
    safeSummary,
  };
}

export function buildCompetitionCandidateReview(
  candidateId: string,
  options: CompetitionDemoOptions = {},
): CompetitionCandidateReview | null {
  const envelope = safeGetEnvelope(options);

  if (!envelope) {
    return null;
  }

  const candidate = envelope.candidates.find(
    (c) => c.candidate.candidateId === candidateId,
  );

  if (!candidate) {
    return null;
  }

  const card = buildCandidateCard(candidate, computeCandidateScore(candidate), envelope);
  const evidence = getCandidateEvidence(envelope, candidate);
  const graphProjection = extractGraphProjection(evidence);
  const roleMemory = extractRoleMemory(candidate, evidence);
  const matchedFeatures = extractFeatures(evidence);
  const similarCandidates = extractNeighbors(evidence);

  return {
    candidate: card,
    graphProjection,
    gnnSignal: null,
    roleMemory,
    matchedFeatures,
    similarCandidates,
    humanDecisionCheckpoint: "图谱给出证据，人类做最终决策。请审阅以上信息后决定是否推进。",
  };
}

function computeCandidateScore(c: CompetitionRagEnvelopeCandidate): number {
  // Base quality score — kept low so query matching drives differentiation
  let score = 0.15;

  const evidenceCount = c.evidenceIds.length;
  score += Math.min(evidenceCount * 0.05, 0.15);

  const resumeLength = c.candidate.resumeText.length;
  if (resumeLength > 200) score += 0.05;
  if (resumeLength > 500) score += 0.1;
  if (resumeLength > 1000) score += 0.1;

  return Math.min(score, 0.5);
}

// Split query into normalized terms for multi-word matching (supports Chinese + English)
function normalizeTokens(query: string): string[] {
  // Split on whitespace first, then extract CJK bigrams for Chinese
  const lower = query.toLowerCase().trim();
  const tokens: string[] = [];

  // English/ASCII words (space-separated)
  const words = lower.split(/[\s,;]+/).filter((t) => t.length >= 2);
  tokens.push(...words);

  // CJK character bigrams for Chinese matching
  const cjkOnly = lower.replace(/[a-z0-9\s,;+.#()\-*/\\]+/gi, "");
  if (cjkOnly.length >= 2) {
    // Add the full CJK phrase as a single token
    if (cjkOnly.length >= 2) tokens.push(cjkOnly);
    // Add individual characters for single-char matching
    for (let i = 0; i < cjkOnly.length; i++) {
      const ch = cjkOnly[i];
      if (ch) tokens.push(ch);
    }
    // Add bigrams
    for (let i = 0; i < cjkOnly.length - 1; i++) {
      tokens.push(cjkOnly.slice(i, i + 2));
    }
  }

  return [...new Set(tokens)];
}

function computeQueryMatchBoost(
  c: CompetitionRagEnvelopeCandidate,
  query: string,
  evidenceSnippets: string[],
): number {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) return 0;

  const resumeText = c.candidate.resumeText.toLowerCase();
  const jobReqs = c.job.requirements.toLowerCase();
  const role = (c.candidate.sourceMetadata?.role ?? "").toLowerCase();
  const allEvidence = evidenceSnippets.join(" ").toLowerCase();

  let matchScore = 0;

  // 1. Role match (strongest signal — role alignment)
  for (const token of tokens) {
    if (role.includes(token)) matchScore += 0.25;
    else {
      const roleWords = role.split(/[^a-z0-9一-鿿]+/);
      for (const rw of roleWords) {
        if (rw.length >= 3 && token.includes(rw)) { matchScore += 0.12; break; }
        if (rw.length >= 3 && rw.includes(token)) { matchScore += 0.12; break; }
      }
    }
  }

  // 2. Evidence match (graph features, skills, projection) — most discriminating
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (allEvidence.match(new RegExp(escaped, "gi")) || []).length;
    matchScore += Math.min(count * 0.12, 0.35);
  }

  // 3. Resume text match
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const count = (resumeText.match(new RegExp(escaped, "gi")) || []).length;
    matchScore += Math.min(count * 0.04, 0.15);
  }

  // 4. Job requirements match
  for (const token of tokens) {
    if (jobReqs.includes(token)) matchScore += 0.1;
  }

  // 5. Exact multi-word phrase match bonus
  if (tokens.length >= 2) {
    const phrase = tokens.slice(0, 3).join(" ");
    if (resumeText.includes(phrase)) matchScore += 0.1;
    if (allEvidence.includes(phrase)) matchScore += 0.15;
    if (role.includes(phrase)) matchScore += 0.15;
  }

  return matchScore;
}

function buildCandidateCard(
  c: CompetitionRagEnvelopeCandidate,
  matchScore: number,
  envelope?: CompetitionRagEnvelope,
): CompetitionCandidateCard {
  const role = c.candidate.sourceMetadata?.role ?? c.job.requirements.slice(0, 30);
  const headline = truncateText(c.candidate.resumeText.slice(0, 100), 80);
  const score = roundScore(matchScore);

  const recommendationLabel = score >= 0.8
    ? "强烈推荐"
    : score >= 0.6
      ? "推荐复核"
      : score >= 0.4
        ? "建议关注"
        : "图谱倾向弱";

  const topReasons: string[] = [];
  const riskNotes: string[] = [];
  const featureBadges: string[] = [];

  if (c.evidenceIds.length > 0) {
    topReasons.push(`${c.evidenceIds.length} 条图谱证据`);
  }

  if (c.candidate.resumeText.length > 300) {
    topReasons.push("简历信息完整");
  }

  if (score < 0.5) {
    riskNotes.push("图谱信号较弱");
  }

  if (c.candidate.resumeText.length < 100) {
    riskNotes.push("简历信息有限");
  }

  const roleMeta = c.candidate.sourceMetadata?.role;
  if (roleMeta) {
    featureBadges.push(roleMeta);
  }

  // Use graphProjection.neighborCount when available, fallback to evidence-based count
  const similarCount = envelope
    ? countSimilarCandidatesFromEnvelope(c, envelope)
    : countNeighborEvidence(c.evidenceIds);

  return {
    candidateId: c.candidate.candidateId,
    role: truncateText(role, 40),
    headline,
    matchScore: score,
    recommendationLabel,
    topReasons,
    riskNotes,
    featureBadges,
    evidenceCount: c.evidenceIds.length,
    similarCandidateCount: similarCount,
  };
}

function extractGraphProjection(
  evidence: CompetitionEvidenceItem[],
): CompetitionGraphProjection | null {
  const projection = evidence.find((item) => item.snippet.startsWith("图投影："));
  if (!projection) return null;

  const snippet = projection.snippet;
  const label = matchText(snippet, /图投影：([^，。]+)/) ?? "graph_projection";
  const confidence = parseDisplayNumber(matchText(snippet, /置信度\s*([0-9.]+)/), projection.score ?? 0);
  const graphScore = parseDisplayNumber(matchText(snippet, /图分\s*([0-9.]+)/), projection.score ?? 0);
  const neighborCount = Math.round(parseDisplayNumber(matchText(snippet, /邻居数\s*([0-9.]+)/), 0));
  const reviewMode = matchText(snippet, /模式\s*([^。]+)/) ?? "graph_projection_review";
  const signalSummary = snippet.includes("。")
    ? truncateText(snippet.slice(snippet.indexOf("。") + 1), 180)
    : "图谱投影已生成，可作为人工复核先验。";

  return {
    label,
    confidence,
    graphScore,
    neighborCount,
    reviewMode,
    signalSummary,
  };
}

function extractRoleMemory(
  c: CompetitionRagEnvelopeCandidate,
  evidence: CompetitionEvidenceItem[],
): string | null {
  const jobEvidence = evidence.find((item) => item.kind === "job" && item.snippet.includes("岗位记忆"));
  if (jobEvidence) {
    return truncateText(jobEvidence.snippet, 220);
  }

  const reqs = c.job.requirements;
  if (reqs.length === 0) return null;
  return truncateText(reqs, 200);
}

function extractFeatures(evidence: CompetitionEvidenceItem[]): CompetitionFeatureEvidence[] {
  const featureEvidence = evidence.find((item) => item.snippet.startsWith("候选人特征："));
  if (!featureEvidence) return [];

  const raw = featureEvidence.snippet
    .replace(/^候选人特征：/, "")
    .replace(/。$/, "")
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);

  return raw.map((item) => {
    const [featureTypeRaw, restRaw = ""] = item.split(":");
    const [canonicalRaw, valueRaw] = restRaw.split("=");
    return {
      featureType: truncateText(featureTypeRaw || "feature", 24),
      canonicalName: truncateText(canonicalRaw || item, 36),
      featureValue: valueRaw ? truncateText(valueRaw, 36) : null,
      confidence: featureEvidence.score ?? 0,
      sourceSnippet: truncateText(item, 120),
    };
  });
}

function extractNeighbors(evidence: CompetitionEvidenceItem[]): CompetitionNeighborEvidence[] {
  const neighborEvidence = evidence.find((item) => item.snippet.startsWith("相似候选人："));
  if (!neighborEvidence) return [];

  return neighborEvidence.snippet
    .replace(/^相似候选人：/, "")
    .replace(/。$/, "")
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => ({
      candidateId: matchText(item, /^(CAN-[A-Za-z0-9_-]+)/) ?? "unknown",
      similarityScore: parseDisplayNumber(matchText(item, /相似度\s*([0-9.]+)/), neighborEvidence.score ?? 0),
      edgeReason: truncateText(matchText(item, /（(.+)）/) ?? item, 80),
    }));
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}

type CompetitionEvidenceItem = CompetitionRagEnvelope["evidencePool"][number] & { snippet: string };

function getCandidateEvidence(
  envelope: CompetitionRagEnvelope,
  c: CompetitionRagEnvelopeCandidate,
): CompetitionEvidenceItem[] {
  const lookup = new Map(envelope.evidencePool.map((item) => [item.sourceRef, item]));
  return c.evidenceIds
    .map((id) => lookup.get(id))
    .filter((item): item is CompetitionEvidenceItem => typeof item?.snippet === "string" && item.snippet.length > 0);
}

function countNeighborEvidence(evidenceIds: string[]): number {
  // Returns a rough estimate; the authoritative count is graphProjection.neighborCount
  // from buildCandidateCard -> buildCompetitionCandidateReview -> extractGraphProjection.
  // This is only used as a fallback before graphProjection is computed.
  return evidenceIds.length > 0 ? evidenceIds.length : 0;
}

function countSimilarCandidatesFromEnvelope(
  c: CompetitionRagEnvelopeCandidate,
  envelope: CompetitionRagEnvelope,
): number {
  // Prefer graphProjection.neighborCount (authoritative)
  const candidateEvidence = c.evidenceIds
    .map((id) => envelope.evidencePool.find((e) => e.sourceRef === id))
    .filter((item): item is typeof envelope.evidencePool[number] & { snippet: string } =>
      typeof item?.snippet === "string" && item.snippet.length > 0,
    );
  const projection = extractGraphProjection(candidateEvidence as CompetitionEvidenceItem[]);
  if (projection && projection.neighborCount > 0) {
    return projection.neighborCount;
  }

  // Fallback: count actual neighbor entries in evidence
  const neighborEvidence = candidateEvidence.find(
    (item) => typeof item.snippet === "string" && item.snippet.startsWith("相似候选人："),
  );
  if (neighborEvidence && typeof neighborEvidence.snippet === "string") {
    const parts = neighborEvidence.snippet
      .replace(/^相似候选人：/, "")
      .replace(/。$/, "")
      .split("；")
      .filter((s) => s.trim().length > 0);
    return parts.length;
  }

  // Last resort: raw evidence count
  return c.evidenceIds.length;
}

function matchText(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match?.[1]?.trim() || null;
}

function parseDisplayNumber(raw: string | null, fallback: number): number {
  if (!raw) return roundScore(fallback);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? roundScore(parsed) : roundScore(fallback);
}

export function sanitizeCompetitionText(text: string): string {
  if (containsSensitivePattern(text)) {
    return "[已脱敏]";
  }
  return text;
}
