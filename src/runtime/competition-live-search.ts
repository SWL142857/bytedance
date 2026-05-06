import { spawn } from "node:child_process";
import {
  buildCompetitionCandidateReview,
  buildCompetitionDemoOverview,
  type CompetitionCandidateCard,
  type CompetitionSearchResult,
} from "./competition-demo-view-model.js";

export interface CompetitionLiveSearchOptions {
  competitionRoot: string;
  snapshot?: string;
  walkMode?: "feature" | "candidate";
  topK?: number;
}

interface PythonCompactCandidate {
  rank: number;
  candidate_id: string;
  normalized_role: string;
  search_score: number;
  projection_label: string;
  gnn_signal: {
    available: boolean;
    prediction: string;
    select_probability: number;
  };
  score_explanation: string;
  lexical_score?: number;
  feature_support_score?: number;
  projection_score?: number;
  gnn_effective_score?: number;
}

interface PythonCompactSearchResult {
  snapshot: string;
  query: string;
  walk_mode: string;
  query_parse: {
    matched_roles: string[];
    positive_terms: string[];
    negative_terms: string[];
    risk_preference: string;
  };
  query_aware_subgraph: {
    query_terms: string[];
    focus_query_terms?: string[];
    shared_query_terms: string[];
    selected_candidates: number;
    seed_features?: number;
    expanded_features?: number;
  };
  top_seed_features?: Array<{
    feature_key: string;
    feature_type: string;
    canonical_name: string;
    seed_score: number;
    example_candidates?: string[];
  }>;
  top_expanded_features?: Array<{
    feature_key: string;
    feature_type: string;
    canonical_name: string;
    activation: number;
  }>;
  feature_feature_paths?: Array<{
    source_feature_key: string;
    target_feature_key: string;
    normalized_weight: number;
    propagated_activation: number;
  }>;
  top_candidates: PythonCompactCandidate[];
  llm_search_result?: {
    overall_summary?: string;
    follow_up_question?: string;
    recommended_candidates?: Array<{
      candidate_id: string;
      fit_score?: number;
      why_match?: string;
      risk_note?: string;
    }>;
  };
}

const DEFAULT_SNAPSHOT = "exp_6000plus";

export async function runCompetitionLiveSearch(
  query: string,
  options: CompetitionLiveSearchOptions,
): Promise<CompetitionSearchResult> {
  const enrichedQuery = enrichCompetitionQuery(query);
  const compact = await runPythonSearch(enrichedQuery, options);
  const overview = buildCompetitionDemoOverview({ competitionRoot: options.competitionRoot });
  const reviewCache = new Map<string, ReturnType<typeof buildCompetitionCandidateReview>>();
  const llmCandidateMap = new Map(
    (compact.llm_search_result?.recommended_candidates ?? []).map((item) => [item.candidate_id, item]),
  );

  const candidates: CompetitionCandidateCard[] = compact.top_candidates.map((item) => {
    const llmCandidate = llmCandidateMap.get(item.candidate_id);
    const review = buildCompetitionCandidateReview(item.candidate_id, {
      competitionRoot: options.competitionRoot,
      query,
    });
    reviewCache.set(item.candidate_id, review);
    const score = normalizePythonSearchScore(llmCandidate?.fit_score ?? item.search_score);
    return {
      candidateId: item.candidate_id,
      role: item.normalized_role,
      headline: llmCandidate?.why_match ?? review?.candidate.headline ?? item.score_explanation,
      matchScore: score,
      recommendationLabel: score >= 0.8 ? "强烈推荐" : score >= 0.6 ? "推荐复核" : "建议关注",
      topReasons: [
        item.score_explanation,
        ...(llmCandidate?.why_match ? [llmCandidate.why_match] : []),
      ].filter(Boolean).slice(0, 2),
      riskNotes: [
        ...(llmCandidate?.risk_note ? [llmCandidate.risk_note] : []),
        ...(review?.queryContext?.missingRequirements.length ? [review.queryContext.missingRequirements.join("、")] : []),
      ].filter(Boolean).slice(0, 2),
      featureBadges: review?.queryContext?.matchedFeatureNodes.slice(0, 3) ?? [],
      evidenceCount: review?.candidate.evidenceCount ?? 0,
      similarCandidateCount: review?.candidate.similarCandidateCount ?? 0,
    };
  });
  candidates.sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0));

  const traceCandidates = compact.top_candidates.map((item) => {
    const llmCandidate = llmCandidateMap.get(item.candidate_id);
    const review = reviewCache.get(item.candidate_id) ?? null;
    return {
      candidateId: item.candidate_id,
      role: item.normalized_role,
      finalScore: roundScore(llmCandidate?.fit_score ?? normalizePythonSearchScore(item.search_score)),
      baseScore: roundScore(item.lexical_score ?? 0),
      boostScore: roundScore((item.feature_support_score ?? 0) + (item.projection_score ?? 0) + (item.gnn_effective_score ?? 0)),
      matchedTokens: compact.query_aware_subgraph.shared_query_terms ?? [],
      contributions: [
        {
          source: "role" as const,
          score: roundScore(item.lexical_score ?? 0),
          reason: "查询词 / 角色命中",
        },
        {
          source: "evidence" as const,
          score: roundScore(item.feature_support_score ?? 0),
          reason: "feature walk 特征支持",
        },
        {
          source: "job" as const,
          score: roundScore(item.projection_score ?? 0),
          reason: "图投影先验",
        },
        {
          source: "phrase" as const,
          score: roundScore(item.gnn_effective_score ?? 0),
          reason: "GNN 校准",
        },
      ].filter((part) => part.score !== 0),
      matchedFeatureNodes: review?.queryContext?.matchedFeatureNodes ?? [],
      missingRequirements: review?.queryContext?.missingRequirements ?? [],
      exactConstraintMatch: (review?.queryContext?.missingRequirements.length ?? 1) === 0,
    };
  });
  traceCandidates.sort((a, b) => Number(b.finalScore || 0) - Number(a.finalScore || 0));

  return {
    query,
    mode: "demo_search",
    candidates,
    safeSummary: compact.llm_search_result?.overall_summary
      ? compact.llm_search_result.overall_summary
      : `Live Search RAG 返回 ${candidates.length} 位候选人。`,
    trace: {
      dataSource: "local_competition_dataset",
      mode: "query_search",
      normalizedTokens: compact.query_aware_subgraph.focus_query_terms?.length
        ? compact.query_aware_subgraph.focus_query_terms
        : compact.query_aware_subgraph.query_terms,
      candidateCountBeforeFilter: overview.candidateCount,
      candidateCountAfterFilter: candidates.length,
      candidates: traceCandidates,
      topSeedFeatures: compact.top_seed_features?.slice(0, 5).map((item) => item.canonical_name) ?? [],
      topExpandedFeatures: compact.top_expanded_features?.slice(0, 5).map((item) => item.canonical_name) ?? [],
      featureFeaturePaths: compact.feature_feature_paths ?? [],
      llmSummary: compact.llm_search_result?.overall_summary ?? null,
      followUpQuestion: compact.llm_search_result?.follow_up_question ?? null,
    } as CompetitionSearchResult["trace"] & Record<string, unknown>,
  };
}

function runPythonSearch(
  query: string,
  options: CompetitionLiveSearchOptions,
): Promise<PythonCompactSearchResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-m",
      "memory_graph_pipeline.memory_graph_demo",
      "--root",
      options.competitionRoot,
      "--snapshot",
      options.snapshot ?? DEFAULT_SNAPSHOT,
      "search",
      "--query",
      query,
      "--walk-mode",
      options.walkMode ?? "feature",
      "--top-k",
      String(options.topK ?? 8),
      "--compact",
      "--run-llm",
    ];

    const child = spawn("python", args, {
      cwd: options.competitionRoot,
      env: {
        ...process.env,
        PYTHONPATH: "src",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Python Search RAG exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PythonCompactSearchResult);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function enrichCompetitionQuery(query: string): string {
  let enriched = query;
  if (/本科/.test(query) && !/bachelor/i.test(query)) {
    enriched += " bachelor undergraduate";
  }
  if (/硕士/.test(query) && !/master/i.test(query)) {
    enriched += " master graduate";
  }
  if (/博士/.test(query) && !/phd|doctorate/i.test(query)) {
    enriched += " phd doctorate";
  }
  return enriched;
}

function normalizePythonSearchScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  const normalized = 1 / (1 + Math.exp(-(score - 3) / 1.4));
  return roundScore(normalized);
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}
