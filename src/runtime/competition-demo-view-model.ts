import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CompetitionRagEnvelope, CompetitionRagEnvelopeCandidate } from "./competition-rag-adapter.js";
import { buildCompetitionRagEnvelope, parseCsv } from "./competition-rag-adapter.js";
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
  trace: CompetitionSearchTrace;
}

export interface CompetitionCandidateReview {
  candidate: CompetitionCandidateCard;
  graphProjection: CompetitionGraphProjection | null;
  gnnSignal: CompetitionGnnSignal | null;
  roleMemory: string | null;
  matchedFeatures: CompetitionFeatureEvidence[];
  similarCandidates: CompetitionNeighborEvidence[];
  humanDecisionCheckpoint: string;
  walkTrace: CompetitionWalkTrace;
  queryContext: CompetitionQueryContext | null;
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

export interface CompetitionSearchTrace {
  dataSource: "local_competition_dataset";
  mode: "default_toplist" | "query_search";
  normalizedTokens: string[];
  candidateCountBeforeFilter: number;
  candidateCountAfterFilter: number;
  candidates: CompetitionSearchTraceCandidate[];
}

export interface CompetitionSearchTraceCandidate {
  candidateId: string;
  role: string;
  finalScore: number;
  baseScore: number;
  boostScore: number;
  matchedTokens: string[];
  contributions: Array<{
    source: "role" | "evidence" | "resume" | "job" | "phrase";
    score: number;
    reason: string;
  }>;
  matchedFeatureNodes: string[];
  missingRequirements: string[];
  exactConstraintMatch: boolean;
}

export interface CompetitionWalkTrace {
  steps: CompetitionWalkStep[];
  safeSummary: string;
}

export interface CompetitionWalkStep {
  order: number;
  kind: "seed" | "projection" | "feature" | "neighbor" | "memory" | "checkpoint";
  title: string;
  summary: string;
  metricLabel?: string;
  metricValue?: string;
}

export interface CompetitionQueryContext {
  query: string;
  normalizedTokens: string[];
  matchedFeatureNodes: string[];
  missingRequirements: string[];
  scoreBreakdown: Array<{
    label: string;
    score: number;
    reason: string;
  }>;
  neighborExpansionOrder: Array<{
    candidateId: string;
    similarityScore: number;
    queryOverlap: string[];
    reason: string;
  }>;
  subgraph: {
    nodes: Array<{
      id: string;
      label: string;
      kind: "query" | "feature" | "candidate" | "neighbor" | "checkpoint";
      stage: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string;
    }>;
  };
}

interface CandidateFeatureRow {
  candidate_id: string;
  feature_type: string;
  canonical_name: string;
  feature_value: string;
  confidence: string;
  source_text_span: string;
}

interface CompetitionDataset {
  envelope: CompetitionRagEnvelope;
  featureRowsByCandidate: Map<string, CandidateFeatureRow[]>;
}

interface CompetitionQueryIntent {
  rawQuery: string;
  normalizedTokens: string[];
  skillTerms: string[];
  degreeRequirements: Array<"bachelor" | "master" | "phd">;
  exactRequirements: string[];
}

interface CompetitionCandidateSearchDetail {
  normalizedScore: number;
  rawScore: number;
  baseScore: number;
  boostScore: number;
  matchedTokens: string[];
  matchedFeatureNodes: string[];
  missingRequirements: string[];
  exactConstraintMatch: boolean;
  contributions: CompetitionSearchTraceCandidate["contributions"];
}

const DEFAULT_COMPETITION_ROOT = resolveCompetitionRoot();
const DEFAULT_SEARCH_LIMIT = 12;

export interface CompetitionDemoOptions {
  competitionRoot?: string;
  limit?: number;
}

const envelopeCache = new Map<string, CompetitionRagEnvelope>();
const datasetCache = new Map<string, CompetitionDataset>();
const QUERY_STOPWORDS = new Set([
  "我", "想", "找", "一个", "会", "并且", "而且", "的", "员工", "候选人", "人才", "希望",
  "需要", "最好", "以及", "和", "且", "是", "有", "懂", "熟悉", "想要",
]);
const QUERY_FILLER_PATTERNS = [
  /我想找一个/g,
  /我想找/g,
  /请帮我找/g,
  /员工/g,
  /候选人/g,
  /人才/g,
  /并且/g,
  /而且/g,
  /以及/g,
  /会/g,
  /是/g,
  /的/g,
];
const DEGREE_PATTERNS: Array<{
  degree: "bachelor" | "master" | "phd";
  patterns: RegExp[];
}> = [
  {
    degree: "bachelor",
    patterns: [/本科/, /学士/, /bachelor/i, /undergraduate/i, /\bb\.?sc\b/i, /\bb\.?a\b/i, /\bbs\b/i],
  },
  {
    degree: "master",
    patterns: [/硕士/, /master/i, /graduate degree/i, /\bm\.?sc\b/i, /\bms\b/i],
  },
  {
    degree: "phd",
    patterns: [/博士/, /phd/i, /doctorate/i],
  },
];

function safeGetEnvelope(options: CompetitionDemoOptions): CompetitionRagEnvelope | null {
  return safeGetDataset(options)?.envelope ?? null;
}

function safeGetDataset(options: CompetitionDemoOptions): CompetitionDataset | null {
  const root = options.competitionRoot ?? DEFAULT_COMPETITION_ROOT;
  const cacheKey = `${root}\0${options.limit ?? "all"}`;
  const cached = datasetCache.get(cacheKey);
  if (cached) return cached;

  try {
    const result = buildCompetitionRagEnvelope({
      competitionRoot: root,
      limit: options.limit,
    });
    envelopeCache.set(cacheKey, result.envelope);
    const dataset: CompetitionDataset = {
      envelope: result.envelope,
      featureRowsByCandidate: loadFeatureRows(root),
    };
    datasetCache.set(cacheKey, dataset);
    return dataset;
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
  const dataset = safeGetDataset(options);
  const envelope = dataset?.envelope ?? null;
  const normalizedQuery = query.trim();
  const intent = parseCompetitionQuery(normalizedQuery);
  const normalizedTokens = intent.normalizedTokens;

  if (!envelope || envelope.candidates.length === 0) {
    return {
      query,
      mode: "demo_search",
      candidates: [],
      safeSummary: "暂无候选人数据",
      trace: {
        dataSource: "local_competition_dataset",
        mode: normalizedQuery.length > 0 ? "query_search" : "default_toplist",
        normalizedTokens,
        candidateCountBeforeFilter: 0,
        candidateCountAfterFilter: 0,
        candidates: [],
      },
    };
  }

  const candidates: CompetitionCandidateCard[] = [];
  const traceCandidates: CompetitionSearchTraceCandidate[] = [];
  let exactMatchCount = 0;

  for (const c of envelope.candidates) {
    const evidenceSnippets = c.evidenceIds
      .map((id) => envelope.evidencePool.find((e) => e.sourceRef === id)?.snippet ?? "")
      .filter((s) => s.length > 0);

    const baseScore = computeCandidateScore(c);
    const structuredDetail = normalizedQuery.length > 0
      ? computeStructuredCandidateSearchDetail(
          c,
          dataset?.featureRowsByCandidate.get(c.candidate.candidateId) ?? [],
          intent,
          evidenceSnippets,
        )
      : null;
    const breakdown = normalizedQuery.length > 0
      ? computeQueryMatchBreakdown(c, normalizedQuery, evidenceSnippets)
      : emptyBreakdown();
    const boostScore = normalizedQuery.length > 0
      ? roundScore((structuredDetail?.boostScore ?? 0) + breakdown.totalBoost)
      : breakdown.totalBoost;

    const matchScore = normalizedQuery.length > 0
      ? structuredDetail?.normalizedScore ?? Math.min(baseScore + boostScore, 1.0)
      : baseScore;

    candidates.push(buildCandidateCard(c, matchScore, envelope));
    if (structuredDetail?.exactConstraintMatch) {
      exactMatchCount += 1;
    }
    traceCandidates.push({
      candidateId: c.candidate.candidateId,
      role: truncateText(c.candidate.sourceMetadata?.role ?? c.job.requirements.slice(0, 40), 40),
      finalScore: roundScore(matchScore),
      baseScore: roundScore(baseScore),
      boostScore: roundScore(boostScore),
      matchedTokens: structuredDetail?.matchedTokens ?? breakdown.matchedTokens,
      contributions: structuredDetail?.contributions ?? ([
        { source: "role", score: roundScore(breakdown.roleScore), reason: "岗位名称命中查询词" },
        { source: "evidence", score: roundScore(breakdown.evidenceScore), reason: "图证据命中查询词" },
        { source: "resume", score: roundScore(breakdown.resumeScore), reason: "简历文本命中查询词" },
        { source: "job", score: roundScore(breakdown.jobScore), reason: "岗位要求命中查询词" },
        { source: "phrase", score: roundScore(breakdown.phraseScore), reason: "多词短语命中" },
      ] satisfies CompetitionSearchTraceCandidate["contributions"]).filter((item) => item.score !== 0),
      matchedFeatureNodes: structuredDetail?.matchedFeatureNodes ?? [],
      missingRequirements: structuredDetail?.missingRequirements ?? [],
      exactConstraintMatch: structuredDetail?.exactConstraintMatch ?? false,
    });
  }

  candidates.sort((a, b) => b.matchScore - a.matchScore);
  traceCandidates.sort((a, b) => b.finalScore - a.finalScore);
  const limited = candidates.slice(0, DEFAULT_SEARCH_LIMIT);

  const safeSummary = normalizedQuery.length > 0
    ? exactMatchCount > 0
      ? `找到 ${Math.min(exactMatchCount, limited.length)} 位满足"${truncateText(query, 20)}"关键约束的候选人`
      : `没有完全命中"${truncateText(query, 20)}"，按接近度展示前 ${limited.length} 位候选人`
    : `展示前 ${limited.length} 位推荐候选人`;

  return {
    query,
    mode: "demo_search",
    candidates: limited,
    safeSummary,
    trace: {
      dataSource: "local_competition_dataset",
      mode: normalizedQuery.length > 0 ? "query_search" : "default_toplist",
      normalizedTokens,
      candidateCountBeforeFilter: envelope.candidates.length,
      candidateCountAfterFilter: limited.length,
      candidates: traceCandidates.slice(0, DEFAULT_SEARCH_LIMIT),
    },
  };
}

export function buildCompetitionCandidateReview(
  candidateId: string,
  options: CompetitionDemoOptions & { query?: string } = {},
): CompetitionCandidateReview | null {
  const dataset = safeGetDataset(options);
  const envelope = dataset?.envelope ?? null;

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
  const walkTrace = buildWalkTrace(card, graphProjection, roleMemory, matchedFeatures, similarCandidates);
  const queryContext = buildQueryContext(
    options.query ?? "",
    candidate,
    dataset?.featureRowsByCandidate.get(candidateId) ?? [],
    similarCandidates,
  );

  return {
    candidate: card,
    graphProjection,
    gnnSignal: null,
    roleMemory,
    matchedFeatures,
    similarCandidates,
    humanDecisionCheckpoint: "图谱给出证据，人类做最终决策。请审阅以上信息后决定是否推进。",
    walkTrace,
    queryContext,
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

interface QueryMatchBreakdown {
  totalBoost: number;
  roleScore: number;
  evidenceScore: number;
  resumeScore: number;
  jobScore: number;
  phraseScore: number;
  matchedTokens: string[];
}

function emptyBreakdown(): QueryMatchBreakdown {
  return {
    totalBoost: 0,
    roleScore: 0,
    evidenceScore: 0,
    resumeScore: 0,
    jobScore: 0,
    phraseScore: 0,
    matchedTokens: [],
  };
}

function computeQueryMatchBreakdown(
  c: CompetitionRagEnvelopeCandidate,
  query: string,
  evidenceSnippets: string[],
): QueryMatchBreakdown {
  const tokens = normalizeTokens(query);
  if (tokens.length === 0) return emptyBreakdown();

  const resumeText = c.candidate.resumeText.toLowerCase();
  const jobReqs = c.job.requirements.toLowerCase();
  const role = (c.candidate.sourceMetadata?.role ?? "").toLowerCase();
  const allEvidence = evidenceSnippets.join(" ").toLowerCase();

  let roleScore = 0;
  let evidenceScore = 0;
  let resumeScore = 0;
  let jobScore = 0;
  let phraseScore = 0;
  const matchedTokens = new Set<string>();

  // 1. Role match (strongest signal — role alignment)
  for (const token of tokens) {
    if (role.includes(token)) {
      roleScore += 0.25;
      matchedTokens.add(token);
    } else {
      const roleWords = role.split(/[^a-z0-9一-鿿]+/);
      for (const rw of roleWords) {
        if (rw.length >= 3 && token.includes(rw)) { roleScore += 0.12; matchedTokens.add(token); break; }
        if (rw.length >= 3 && rw.includes(token)) { roleScore += 0.12; matchedTokens.add(token); break; }
      }
    }
  }

  // 2. Evidence match (graph features, skills, projection) — most discriminating
  for (const token of tokens) {
    const count = countTokenOccurrences(allEvidence, token);
    const inc = Math.min(count * 0.12, 0.35);
    evidenceScore += inc;
    if (inc > 0) matchedTokens.add(token);
  }

  // 3. Resume text match
  for (const token of tokens) {
    const count = countTokenOccurrences(resumeText, token);
    const inc = Math.min(count * 0.04, 0.15);
    resumeScore += inc;
    if (inc > 0) matchedTokens.add(token);
  }

  // 4. Job requirements match
  for (const token of tokens) {
    if (jobReqs.includes(token)) {
      jobScore += 0.1;
      matchedTokens.add(token);
    }
  }

  // 5. Exact multi-word phrase match bonus
  if (tokens.length >= 2) {
    const phrase = tokens.slice(0, 3).join(" ");
    if (resumeText.includes(phrase)) phraseScore += 0.1;
    if (allEvidence.includes(phrase)) phraseScore += 0.15;
    if (role.includes(phrase)) phraseScore += 0.15;
  }

  const totalBoost = roleScore + evidenceScore + resumeScore + jobScore + phraseScore;
  return {
    totalBoost,
    roleScore,
    evidenceScore,
    resumeScore,
    jobScore,
    phraseScore,
    matchedTokens: [...matchedTokens],
  };
}

function computeStructuredCandidateSearchDetail(
  candidate: CompetitionRagEnvelopeCandidate,
  featureRows: CandidateFeatureRow[],
  intent: CompetitionQueryIntent,
  evidenceSnippets: string[],
): CompetitionCandidateSearchDetail {
  const baseScore = computeCandidateScore(candidate);
  const searchableText = [
    candidate.candidate.resumeText,
    candidate.candidate.sourceMetadata?.role ?? "",
    candidate.job.requirements,
    ...featureRows.map((row) => `${row.feature_type} ${row.canonical_name} ${row.feature_value} ${row.source_text_span}`),
    ...evidenceSnippets,
  ].join("\n").toLowerCase();

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  const matchedFeatureNodes: string[] = [];
  const contributions: CompetitionSearchTraceCandidate["contributions"] = [];
  let score = baseScore;

  for (const skill of intent.skillTerms) {
    const matchedRow = featureRows.find((row) => row.feature_type === "skill" && featureRowContainsTerm(row, skill));
    if (matchedRow || containsWholeTerm(searchableText, skill)) {
      matchedSkills.push(skill);
      score += 1.6;
      matchedFeatureNodes.push(matchedRow ? `${matchedRow.feature_type}·${matchedRow.canonical_name}` : `resume·${skill}`);
      contributions.push({ source: "evidence", score: 1.6, reason: `命中技能约束：${skill}` });
    } else {
      missingSkills.push(skill);
      score -= 0.9;
      contributions.push({ source: "evidence", score: -0.9, reason: `缺少技能约束：${skill}` });
    }
  }

  const matchedDegrees: Array<"bachelor" | "master" | "phd"> = [];
  const missingDegrees: Array<"bachelor" | "master" | "phd"> = [];
  for (const degree of intent.degreeRequirements) {
    const patterns = degreeSynonyms(degree);
    const degreeRow = featureRows.find((row) => row.feature_type === "education" && patterns.some((pattern) => featureRowContainsPattern(row, pattern)));
    const degreeMatched = Boolean(degreeRow) || patterns.some((pattern) => pattern.test(searchableText));
    if (degreeMatched) {
      matchedDegrees.push(degree);
      score += 1.2;
      if (degreeRow) matchedFeatureNodes.push(`${degreeRow.feature_type}·${degreeRow.canonical_name}`);
      contributions.push({ source: "resume", score: 1.2, reason: `命中学历约束：${degreeLabel(degree)}` });
    } else {
      missingDegrees.push(degree);
      score -= 0.8;
      contributions.push({ source: "resume", score: -0.8, reason: `缺少学历约束：${degreeLabel(degree)}` });
    }
  }

  const fuzzyTerms = intent.normalizedTokens.filter((token) => !intent.exactRequirements.includes(token));
  const matchedTokens = [...matchedSkills, ...matchedDegrees.map(degreeLabel)];

  // Role boost: if candidate's role contains an English term from the query,
  // weight it heavily (+1.8) so Chinese presets can discriminate by role.
  // Without this, generic English terms match many resumes equally.
  const candidateRole = (candidate.candidate.sourceMetadata?.role ?? "").toLowerCase();
  var roleBoostApplied = false;
  for (const token of fuzzyTerms) {
    if (containsWholeTerm(candidateRole, token) && token.length >= 3) {
      score += 1.8;
      matchedTokens.push(token);
      contributions.push({ source: "role", score: 1.8, reason: `岗位对齐：${token}` });
      roleBoostApplied = true;
    }
  }

  for (const token of fuzzyTerms) {
    if (containsWholeTerm(searchableText, token) && !matchedTokens.includes(token)) {
      matchedTokens.push(token);
      score += roleBoostApplied ? 0.08 : 0.15;
      contributions.push({ source: "role", score: roleBoostApplied ? 0.08 : 0.15, reason: `文本命中：${token}` });
    }
  }

  return {
    normalizedScore: normalizeSearchScore(score),
    rawScore: score,
    baseScore,
    boostScore: score - baseScore,
    matchedTokens: Array.from(new Set(matchedTokens)),
    matchedFeatureNodes: Array.from(new Set(matchedFeatureNodes)).slice(0, 8),
    missingRequirements: [...missingSkills, ...missingDegrees.map(degreeLabel)],
    exactConstraintMatch: intent.exactRequirements.length > 0 && missingSkills.length === 0 && missingDegrees.length === 0,
    contributions,
  };
}

function normalizeSearchScore(rawScore: number): number {
  const normalized = 1 / (1 + Math.exp(-(rawScore - 1.2) / 1.6));
  return roundScore(normalized);
}

function parseCompetitionQuery(query: string): CompetitionQueryIntent {
  const lowered = query.toLowerCase();
  const englishTerms = Array.from(new Set((lowered.match(/[a-z][a-z0-9+#._-]*/g) ?? []).filter((token) => token.length >= 2)));
  const cjkChunks = Array.from(new Set((query.match(/[\u4e00-\u9fff]{2,}/g) ?? []).map((chunk) => chunk.trim()).filter(Boolean)));
  const degreeRequirements = DEGREE_PATTERNS
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(query)))
    .map((entry) => entry.degree);
  const normalizedTokens = [
    ...englishTerms,
    ...cjkChunks
      .map(stripChineseFiller)
      .flatMap((chunk) => chunk.split(/和|并且|而且|以及|、|，|,|\s+/g).map((token) => token.trim()).filter((token) => token.length >= 2 && !QUERY_STOPWORDS.has(token))),
    ...degreeRequirements.map(degreeLabel),
  ];
  const skillTerms = englishTerms.filter((token) => !["and", "with", "candidate", "employee"].includes(token));
  return {
    rawQuery: query,
    normalizedTokens: Array.from(new Set(normalizedTokens)),
    skillTerms,
    degreeRequirements,
    exactRequirements: [...skillTerms, ...degreeRequirements.map(degreeLabel)],
  };
}

function degreeLabel(degree: "bachelor" | "master" | "phd"): string {
  if (degree === "bachelor") return "本科";
  if (degree === "master") return "硕士";
  return "博士";
}

function degreeSynonyms(degree: "bachelor" | "master" | "phd"): RegExp[] {
  return DEGREE_PATTERNS.find((entry) => entry.degree === degree)?.patterns ?? [];
}

function featureRowContainsTerm(row: CandidateFeatureRow, term: string): boolean {
  const haystack = `${row.canonical_name} ${row.feature_value} ${row.source_text_span}`.toLowerCase();
  return containsWholeTerm(haystack, term.toLowerCase());
}

function featureRowContainsPattern(row: CandidateFeatureRow, pattern: RegExp): boolean {
  const haystack = `${row.canonical_name} ${row.feature_value} ${row.source_text_span}`;
  return pattern.test(haystack);
}

function buildQueryContext(
  query: string,
  candidate: CompetitionRagEnvelopeCandidate,
  featureRows: CandidateFeatureRow[],
  similarCandidates: CompetitionNeighborEvidence[],
): CompetitionQueryContext | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const intent = parseCompetitionQuery(trimmed);
  const detail = computeStructuredCandidateSearchDetail(candidate, featureRows, intent, []);
  const neighborExpansionOrder = similarCandidates.slice(0, 5).map((neighbor) => ({
    candidateId: neighbor.candidateId,
    similarityScore: roundScore(neighbor.similarityScore),
    queryOverlap: detail.matchedTokens.slice(0, 3),
    reason: summarizeEdgeReason(neighbor.edgeReason),
  }));
  return {
    query: trimmed,
    normalizedTokens: intent.normalizedTokens,
    matchedFeatureNodes: detail.matchedFeatureNodes,
    missingRequirements: detail.missingRequirements,
    scoreBreakdown: detail.contributions.map((item) => ({
      label: item.source,
      score: item.score,
      reason: item.reason,
    })),
    neighborExpansionOrder,
    subgraph: buildQuerySubgraph(trimmed, detail, candidate, neighborExpansionOrder),
  };
}

function buildQuerySubgraph(
  query: string,
  detail: CompetitionCandidateSearchDetail,
  candidate: CompetitionRagEnvelopeCandidate,
  neighborExpansionOrder: CompetitionQueryContext["neighborExpansionOrder"],
): CompetitionQueryContext["subgraph"] {
  const nodes: CompetitionQueryContext["subgraph"]["nodes"] = [];
  const edges: CompetitionQueryContext["subgraph"]["edges"] = [];
  nodes.push({ id: "query", label: truncateText(query, 36), kind: "query", stage: 0 });
  for (const feature of detail.matchedFeatureNodes.slice(0, 6)) {
    const featureId = `feature:${feature}`;
    nodes.push({ id: featureId, label: feature, kind: "feature", stage: 1 });
    edges.push({ source: "query", target: featureId, label: "命中" });
    edges.push({ source: featureId, target: candidate.candidate.candidateId, label: "支持" });
  }
  nodes.push({
    id: candidate.candidate.candidateId,
    label: truncateText(candidate.candidate.sourceMetadata?.role ?? candidate.candidate.candidateId, 28),
    kind: "candidate",
    stage: 2,
  });
  for (const neighbor of neighborExpansionOrder.slice(0, 4)) {
    const nodeId = `neighbor:${neighbor.candidateId}`;
    nodes.push({ id: nodeId, label: neighbor.candidateId, kind: "neighbor", stage: 3 });
    edges.push({ source: candidate.candidate.candidateId, target: nodeId, label: `相似 ${neighbor.similarityScore}` });
  }
  nodes.push({ id: "checkpoint", label: "人工决策", kind: "checkpoint", stage: 4 });
  edges.push({ source: candidate.candidate.candidateId, target: "checkpoint", label: "复核" });
  return { nodes, edges };
}

function stripChineseFiller(value: string): string {
  let next = value;
  for (const pattern of QUERY_FILLER_PATTERNS) {
    next = next.replace(pattern, "");
  }
  return next.trim();
}

function containsWholeTerm(text: string, term: string): boolean {
  if (!term) return false;
  if (/^[a-z0-9+#._-]+$/i.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }
  return text.includes(term);
}

function countTokenOccurrences(text: string, term: string): number {
  if (!term) return 0;
  if (/^[a-z0-9+#._-]+$/i.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (text.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "gi")) || []).length;
  }
  return text.includes(term) ? 1 : 0;
}

function buildWalkTrace(
  card: CompetitionCandidateCard,
  graphProjection: CompetitionGraphProjection | null,
  roleMemory: string | null,
  matchedFeatures: CompetitionFeatureEvidence[],
  similarCandidates: CompetitionNeighborEvidence[],
): CompetitionWalkTrace {
  const steps: CompetitionWalkStep[] = [];
  steps.push({
    order: 1,
    kind: "seed",
    title: "候选人种子节点",
    summary: `${card.candidateId} 作为本次 Graph RAG 复核的起点，目标岗位为 ${card.role}。`,
    metricLabel: "基础匹配分",
    metricValue: String(card.matchScore),
  });

  if (graphProjection) {
    steps.push({
      order: steps.length + 1,
      kind: "projection",
      title: "图投影先验",
      summary: `${graphProjectionLabel(graphProjection.label)}，${graphProjection.signalSummary}`,
      metricLabel: "图投影置信度",
      metricValue: `${Math.round(graphProjection.confidence * 100)}%`,
    });
  }

  if (matchedFeatures.length > 0) {
    steps.push({
      order: steps.length + 1,
      kind: "feature",
      title: "命中特征收集",
      summary: matchedFeatures.slice(0, 4).map((feature) => featureLabelFromEvidence(feature)).join("；"),
      metricLabel: "命中特征数",
      metricValue: String(matchedFeatures.length),
    });
  }

  for (const neighbor of similarCandidates.slice(0, 4)) {
    steps.push({
      order: steps.length + 1,
      kind: "neighbor",
      title: `邻居游走：${neighbor.candidateId}`,
      summary: summarizeEdgeReason(neighbor.edgeReason),
      metricLabel: "相似度",
      metricValue: String(roundScore(neighbor.similarityScore)),
    });
  }

  if (roleMemory) {
    steps.push({
      order: steps.length + 1,
      kind: "memory",
      title: "岗位历史记忆汇总",
      summary: summarizeRoleMemory(roleMemory),
    });
  }

  steps.push({
    order: steps.length + 1,
    kind: "checkpoint",
    title: "人工决策检查点",
    summary: "图谱给出的是参考证据，不自动做录用/淘汰结论，最终仍由人工确认。",
  });

  return {
    steps,
    safeSummary: `共执行 ${steps.length} 个图游走步骤，完成从候选人种子节点到邻居与岗位记忆的汇总复核。`,
  };
}

function featureLabelFromEvidence(feature: CompetitionFeatureEvidence): string {
  const type = feature.featureType ? `${feature.featureType}·` : "";
  const value = feature.featureValue ? `=${feature.featureValue}` : "";
  return `${type}${feature.canonicalName}${value}`;
}

function summarizeEdgeReason(reason: string): string {
  if (!reason) {
    return "相似原因未展开";
  }
  const text = String(reason);
  const shared = /shared_features=([^;]+)/i.exec(text);
  const source = shared?.[1] ?? text;
  const items = source.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 3);
  return items.length > 0 ? `共享 ${items.join("、")}` : "相似原因已脱敏";
}

function summarizeRoleMemory(text: string): string {
  if (!text) {
    return "暂无可用岗位历史记忆";
  }
  return truncateText(text, 180);
}

function graphProjectionLabel(label: string): string {
  if (label === "likely_select" || label === "select" || label === "strong_match") return "推荐推进";
  if (label === "likely_reject" || label === "reject" || label === "weak_match") return "建议谨慎复核";
  if (label === "review_needed" || label === "needs_review") return "需要人工判断";
  return label || "等待人工判断";
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

function loadFeatureRows(competitionRoot: string): Map<string, CandidateFeatureRow[]> {
  const featurePath = join(competitionRoot, "artifacts", "memory_graph", "candidate_features.csv");
  const byCandidate = new Map<string, CandidateFeatureRow[]>();
  if (!existsSync(featurePath)) {
    return byCandidate;
  }
  const rows = parseCsv(readFileSync(featurePath, "utf8"));
  const header = rows[0] ?? [];
  for (const row of rows.slice(1)) {
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const key = header[i];
      if (!key) continue;
      record[key] = row[i] ?? "";
    }
    const candidateId = record["candidate_id"];
    if (!candidateId) continue;
    const existing = byCandidate.get(candidateId) ?? [];
    existing.push(record as unknown as CandidateFeatureRow);
    byCandidate.set(candidateId, existing);
  }
  return byCandidate;
}

function resolveCompetitionRoot(): string {
  const candidates = [
    resolve(process.cwd(), "..", "competition"),
    resolve(process.cwd(), "competition"),
    "/data/competition",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}
