/**
 * Research report assembly (Phase D section 28).
 *
 * This does not run any research itself — it's a pure assembly function
 * over whatever ResearchResult objects the caller already produced by
 * invoking the engines in research/engines/. Keeping this a pure function
 * (no I/O) makes the report shape easy to unit test independent of any
 * live website/trend/competitor call.
 *
 * Every section that couldn't be completed is explicitly listed under
 * missingInformation — never silently omitted, per section 7 and 29.
 */

import type { BusinessProfile } from "../domain/business-profile.js";
import type { ResearchResult, ResearchState } from "./types.js";
import type { WebsiteIntelligenceResult } from "./engines/website-intelligence.js";
import type { TrendSnapshot } from "./engines/trend-intelligence.js";
import type { KeywordCandidate } from "./engines/keyword-research.js";
import type { ClassifiedCompetitor } from "./engines/competitor-research.js";

export interface ResearchReport {
  clientId: string;
  clientName: string;
  generatedAt: string;
  overallState: ResearchState;

  businessUnderstanding: {
    industry: string | null;
    businessModel: string | null;
    productsOrServices: string[];
    locations: string[];
  };

  websiteIntelligence: ResearchResult<WebsiteIntelligenceResult>;
  trendSignals: ResearchResult<TrendSnapshot>[];
  keywordOpportunities: KeywordCandidate[];
  negativeOpportunities: KeywordCandidate[];
  competitorSignals: ResearchResult<ClassifiedCompetitor[]>;

  highConfidenceOpportunities: KeywordCandidate[];
  lowConfidenceHypotheses: KeywordCandidate[];

  missingInformation: string[];
  recommendedNextResearch: string[];
}

function worstState(states: ResearchState[]): ResearchState {
  const priority: ResearchState[] = ["FAILED", "BLOCKED", "PARTIAL", "RUNNING", "NOT_STARTED", "COMPLETE"];
  for (const state of priority) {
    if (states.includes(state)) return state;
  }
  return "NOT_STARTED";
}

export function buildResearchReport(input: {
  clientId: string;
  profile: BusinessProfile;
  website: ResearchResult<WebsiteIntelligenceResult>;
  trends: ResearchResult<TrendSnapshot>[];
  keywordCandidates: KeywordCandidate[];
  competitors: ResearchResult<ClassifiedCompetitor[]>;
}): ResearchReport {
  const missingInformation: string[] = [];
  const recommendedNextResearch: string[] = [];

  if (input.website.state !== "COMPLETE") {
    missingInformation.push(`Website intelligence is incomplete: ${input.website.issues.join("; ") || "unknown reason"}`);
    recommendedNextResearch.push("Retry website analysis manually or from a different network/IP if the site is blocking automated access.");
  }

  if (input.trends.length === 0) {
    missingInformation.push("No trend research was attempted for this client.");
  } else {
    const failedTrends = input.trends.filter((t) => t.state !== "COMPLETE");
    if (failedTrends.length > 0) {
      missingInformation.push(`${failedTrends.length} of ${input.trends.length} trend lookups did not complete: ${failedTrends.flatMap((t) => t.issues).join("; ")}`);
    }
  }

  if (input.competitors.state !== "COMPLETE") {
    missingInformation.push(`Competitor research is incomplete: ${input.competitors.issues.join("; ") || "unknown reason"}`);
    recommendedNextResearch.push("Configure a CompetitorResearchProvider to enable SERP competitor research.");
  }

  if (input.profile.openQuestionsForAudit.length > 0) {
    missingInformation.push(...input.profile.openQuestionsForAudit);
  }

  const negativeOpportunities = input.keywordCandidates.filter((c) => c.recommendation === "NEGATIVE_CANDIDATE");
  const highConfidenceOpportunities = input.keywordCandidates.filter((c) => c.confidence >= 0.7 && c.recommendation !== "NEGATIVE_CANDIDATE");
  const lowConfidenceHypotheses = input.keywordCandidates.filter((c) => c.confidence < 0.4 && c.recommendation !== "NEGATIVE_CANDIDATE");

  const overallState = worstState([
    input.website.state,
    ...input.trends.map((t) => t.state),
    input.competitors.state,
  ]);

  return {
    clientId: input.clientId,
    clientName: input.profile.clientName,
    generatedAt: new Date().toISOString(),
    overallState,
    businessUnderstanding: {
      industry: input.profile.industry,
      businessModel: input.profile.businessModel,
      productsOrServices: input.profile.productsOrServices,
      locations: input.profile.locations.map((l) => [l.city, l.region, l.country].filter(Boolean).join(", ")),
    },
    websiteIntelligence: input.website,
    trendSignals: input.trends,
    keywordOpportunities: input.keywordCandidates,
    negativeOpportunities,
    competitorSignals: input.competitors,
    highConfidenceOpportunities,
    lowConfidenceHypotheses,
    missingInformation,
    recommendedNextResearch,
  };
}
