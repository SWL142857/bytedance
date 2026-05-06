import { spawn } from "node:child_process";
import { buildCompetitionCandidateReview } from "./competition-demo-view-model.js";

export interface CompetitionLiveReviewOptions {
  competitionRoot: string;
  snapshot?: string;
  gnnRun?: string;
  topKNeighbors?: number;
}

interface PythonCompactReviewerResult {
  snapshot: string;
  candidate_id: string;
  job_id: string;
  normalized_role: string;
  projection: {
    label: string;
    graph_score: number;
    confidence: number;
    neighbor_count: number;
  };
  gnn_signal: {
    available: boolean;
    prediction: string;
    select_probability: number;
    effective_prediction?: string;
    confidence_strength?: number;
  };
  top_general_signals?: Array<{
    feature_type: string;
    canonical_name: string;
    feature_value?: string | null;
    confidence?: number;
    source_text_span?: string;
  }>;
  top_neighbors: Array<{
    candidate_id: string;
    similarity_score: number;
    decision_gt: string;
    reason_label: string;
    projection_label: string;
    gnn_select_probability: number;
  }>;
  query_aware_subgraph: {
    query_terms: string[];
    selected_features: number;
    selected_neighbors: number;
  };
  llm_review_result?: {
    decision_pred?: "select" | "reject";
    confidence?: number;
    reason_label?: string;
    reason_group?: string;
    review_summary?: string;
  };
}

interface PythonCompactAdHocReviewerResult {
  source_mode: "ad_hoc_resume";
  candidate_id: string;
  job_id: string;
  normalized_role: string;
  projection: {
    label: string;
    graph_score: number;
    confidence: number;
    neighbor_count: number;
  };
  gnn_signal: {
    available: boolean;
    prediction: string;
    select_probability: number;
    effective_prediction?: string;
    confidence_strength?: number;
  };
  top_general_signals?: Array<{
    feature_type: string;
    canonical_name: string;
    feature_value?: string | null;
  }>;
  top_neighbors: Array<{
    candidate_id: string;
    similarity_score: number;
    decision_gt: string;
    reason_label: string;
    projection_label: string;
    gnn_select_probability: number;
    edge_reason: string;
  }>;
  query_aware_subgraph: {
    query_terms: string[];
    selected_features: number;
    selected_neighbors: number;
    textualized_subgraph: string;
  };
  llm_review_result?: {
    decision_pred?: "select" | "reject";
    confidence?: number;
    reason_label?: string;
    reason_group?: string;
    review_summary?: string;
  };
}

const DEFAULT_SNAPSHOT = "exp_6000plus";

export async function runCompetitionLiveReview(
  candidateId: string,
  options: CompetitionLiveReviewOptions,
): Promise<Record<string, unknown> | null> {
  const compact = await runPythonReviewer(candidateId, options);
  const staticReview = buildCompetitionCandidateReview(candidateId, {
    competitionRoot: options.competitionRoot,
  });
  if (!staticReview) {
    return null;
  }

  return {
    candidate: staticReview.candidate,
    graphProjection: staticReview.graphProjection,
    gnnSignal: compact.gnn_signal,
    roleMemory: staticReview.roleMemory,
    matchedFeatures: staticReview.matchedFeatures,
    similarCandidates: staticReview.similarCandidates,
    humanDecisionCheckpoint: staticReview.humanDecisionCheckpoint,
    walkTrace: staticReview.walkTrace,
    queryContext: null,
    reviewerDecision: {
      decision: compact.llm_review_result?.decision_pred ?? null,
      confidence: compact.llm_review_result?.confidence ?? null,
      reasonLabel: compact.llm_review_result?.reason_label ?? null,
      reasonGroup: compact.llm_review_result?.reason_group ?? null,
      reviewSummary: compact.llm_review_result?.review_summary ?? null,
    },
    reviewerSignals: {
      topGeneralSignals: compact.top_general_signals ?? [],
      topNeighbors: compact.top_neighbors ?? [],
      queryAwareSubgraph: compact.query_aware_subgraph,
      rawProjection: compact.projection,
    },
  };
}

export async function runCompetitionAdHocReview(
  input: {
    role: string;
    jobDescription: string;
    resumeText: string;
    candidateLabel?: string;
  },
  options: CompetitionLiveReviewOptions,
): Promise<Record<string, unknown>> {
  const compact = await runPythonAdHocReviewer(input, options);
  return {
    candidate: {
      candidateId: compact.candidate_id,
      role: compact.normalized_role,
      headline: compact.llm_review_result?.review_summary ?? "临时简历复核候选人",
      matchScore: roundScore(compact.llm_review_result?.confidence ?? 0),
      recommendationLabel: compact.llm_review_result?.decision_pred === "select" ? "强烈推荐" : "建议谨慎复核",
      topReasons: [compact.llm_review_result?.reason_label ?? "实时复核结论"],
      riskNotes: [],
      featureBadges: (compact.top_general_signals ?? []).slice(0, 3).map((item) => item.canonical_name),
      evidenceCount: compact.query_aware_subgraph.selected_features,
      similarCandidateCount: compact.projection.neighbor_count,
    },
    graphProjection: {
      label: compact.projection.label,
      confidence: compact.projection.confidence,
      graphScore: compact.projection.graph_score,
      neighborCount: compact.projection.neighbor_count,
      reviewMode: "graph_projection_review",
      signalSummary: "临时简历复核使用本地图谱邻居和图投影先验。",
    },
    gnnSignal: compact.gnn_signal,
    roleMemory: `${input.role} · ${input.jobDescription}`,
    matchedFeatures: (compact.top_general_signals ?? []).map((item) => ({
      featureType: item.feature_type,
      canonicalName: item.canonical_name,
      featureValue: item.feature_value ?? null,
      confidence: 1,
      sourceSnippet: item.feature_value ?? item.canonical_name,
    })),
    similarCandidates: compact.top_neighbors.map((item) => ({
      candidateId: item.candidate_id,
      similarityScore: item.similarity_score,
      edgeReason: item.edge_reason,
    })),
    humanDecisionCheckpoint: "图谱与 Reviewer 仅提供建议，最终录取决定仍由招聘人员人工确认。",
    walkTrace: {
      steps: [],
      safeSummary: compact.query_aware_subgraph.textualized_subgraph,
    },
    queryContext: null,
    reviewerDecision: {
      decision: compact.llm_review_result?.decision_pred ?? null,
      confidence: compact.llm_review_result?.confidence ?? null,
      reasonLabel: compact.llm_review_result?.reason_label ?? null,
      reasonGroup: compact.llm_review_result?.reason_group ?? null,
      reviewSummary: compact.llm_review_result?.review_summary ?? null,
    },
    reviewerSignals: {
      topGeneralSignals: compact.top_general_signals ?? [],
      topNeighbors: compact.top_neighbors ?? [],
      queryAwareSubgraph: compact.query_aware_subgraph,
      rawProjection: compact.projection,
    },
    sourceMode: "ad_hoc_resume",
  };
}

function runPythonReviewer(
  candidateId: string,
  options: CompetitionLiveReviewOptions,
): Promise<PythonCompactReviewerResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-m",
      "memory_graph_pipeline.memory_graph_demo",
      "--root",
      options.competitionRoot,
      "--snapshot",
      options.snapshot ?? DEFAULT_SNAPSHOT,
      "reviewer",
      "--candidate",
      candidateId,
      "--top-k-neighbors",
      String(options.topKNeighbors ?? 5),
      "--compact",
      "--run-llm",
    ];
    if (options.gnnRun) {
      args.push("--gnn-run", options.gnnRun);
    }

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
        reject(new Error(stderr || `Python Reviewer RAG exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PythonCompactReviewerResult);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runPythonAdHocReviewer(
  input: {
    role: string;
    jobDescription: string;
    resumeText: string;
    candidateLabel?: string;
  },
  options: CompetitionLiveReviewOptions,
): Promise<PythonCompactAdHocReviewerResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-m",
      "memory_graph_pipeline.ad_hoc_reviewer_demo",
      "--root",
      options.competitionRoot,
      "--snapshot",
      options.snapshot ?? DEFAULT_SNAPSHOT,
      "--role",
      input.role,
      "--job-description",
      input.jobDescription,
      "--resume-text",
      input.resumeText,
      "--candidate-label",
      input.candidateLabel ?? "临时候选人",
      "--top-k-neighbors",
      String(options.topKNeighbors ?? 5),
      "--compact",
      "--run-llm",
    ];
    if (options.gnnRun) {
      args.push("--gnn-run", options.gnnRun);
    }

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
        reject(new Error(stderr || `Python ad-hoc Reviewer RAG exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PythonCompactAdHocReviewerResult);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function roundScore(score: number): number {
  return Math.round(score * 100) / 100;
}
