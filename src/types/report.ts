export interface Report {
  reportId: string;
  periodStart: string;
  periodEnd: string;
  funnelSummary: string;
  qualitySummary: string;
  bottlenecks: string[];
  talentPoolSuggestions: string[];
  recommendations: string[];
  createdByAgent: string;
}
