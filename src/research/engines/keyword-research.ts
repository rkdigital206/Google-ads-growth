/**
 * Keyword research engine (Phase D sections 17-21).
 *
 * Evidence hierarchy (section 20), implemented, not just described:
 * a candidate sourced from GOOGLE_ADS_SEARCH_TERMS (an actual converting
 * or non-converting real search term in the client's account) always
 * outranks one sourced from AI_EXPANSION or bare trend data, because the
 * confidence engine's SOURCE_RELIABILITY table encodes that hierarchy.
 *
 * This engine does NOT call an AI model to expand keywords — that's a
 * capability, not a requirement, and doing it here would mean either
 * fabricating "AI-generated" keywords with no real semantic expansion
 * behind them, or silently depending on a specific LLM call from within a
 * deterministic engine. AI-expansion candidates, if added by a caller
 * (e.g. an MCP tool that separately asks the model for expansion ideas),
 * must be tagged AI_GENERATED_HYPOTHESIS via addAiExpansionCandidate below
 * and will always score LOW/VERY_LOW confidence given SOURCE_RELIABILITY.
 */

import type { SearchTermPerformance } from "../../performance/models.js";
import { classifyTermAgainstIntents, type CustomIntentDefinition, type IntentType } from "../../domain/intent.js";
import { computeConfidence } from "./confidence.js";
import type { ResearchSource } from "../types.js";
import type { TrendDirection, KeywordResearchCandidate } from "../providers/types.js";
import type { BusinessProfile } from "../../domain/business-profile.js";
import { scoreOpportunity, type OpportunityAssessment } from "../opportunity-scoring.js";

export type KeywordRecommendation =
  | "HIGH_PRIORITY"
  | "MEDIUM_PRIORITY"
  | "LOW_PRIORITY"
  | "NEGATIVE_CANDIDATE"
  | "RESEARCH_ONLY"
  | "INSUFFICIENT_EVIDENCE";

export interface KeywordCandidate {
  keyword: string;
  intent: IntentType;
  source: ResearchSource;
  /** Whether this trend evidence exists at all, and its direction if so — null when no trend provider/data is available. */
  trendSignal: TrendDirection | null;
  /** Relevance to the business's actual products/services, 0-1. Supplied by the caller from business-profile matching — this engine doesn't guess relevance itself. */
  relevanceScore: number;
  /** Commercial-intent strength, 0-1, derived from the intent classification confidence. */
  commercialScore: number;
  confidence: number;
  recommendation: KeywordRecommendation;
  reason: string;
  /** How `relevanceScore` was obtained, so a neutral default can never be mistaken for a measured value. */
  relevanceBasis?: "PROFILE_TERM_OVERLAP" | "NEUTRAL_DEFAULT_NO_PROFILE_TERMS" | "CALLER_SUPPLIED";
  /** Real Google Ads history for this term, if it came from account data. Null for external-provider ideas. */
  evidence?: { clicks: number; impressions: number | null; cost: number | null; conversions: number | null } | null;
  /** Provider-reported figures, set ONLY when a configured KeywordResearchProvider returned them. Never estimated. */
  providerSearchVolume?: number | null;
  providerCompetition?: string | number | null;
  /** Multi-dimensional assessment (trend ≠ profit). Present after assessCandidates(). */
  opportunity?: OpportunityAssessment;
}

const STOPWORDS = new Set(["the", "and", "for", "with", "near", "best", "buy", "cheap", "online", "price", "shop", "store", "from", "your", "that", "this"]);
const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

/**
 * Deterministic business-relevance function derived from the client's own
 * products/services, offers and industry: the share of a term's content
 * words that appear in the profile vocabulary. If the profile has NO such
 * vocabulary the function returns a neutral 0.5 and the basis says so.
 */
export function buildProfileRelevance(profile: Pick<BusinessProfile, "productsOrServices" | "primaryOffers" | "industry" | "subIndustry">): {
  fn: (term: string) => number;
  basis: NonNullable<KeywordCandidate["relevanceBasis"]>;
} {
  const vocab = new Set(
    [...profile.productsOrServices, ...profile.primaryOffers, profile.industry ?? "", profile.subIndustry ?? ""].flatMap(tokenize)
  );
  if (vocab.size === 0) return { fn: () => 0.5, basis: "NEUTRAL_DEFAULT_NO_PROFILE_TERMS" };
  return {
    basis: "PROFILE_TERM_OVERLAP",
    fn: (term: string) => {
      const tokens = tokenize(term);
      if (tokens.length === 0) return 0.15;
      const hits = tokens.filter((t) => vocab.has(t)).length;
      return hits === 0 ? 0.15 : Math.min(1, 0.4 + 0.6 * (hits / tokens.length));
    },
  };
}

/**
 * Builds keyword candidates from real search-term performance data — the
 * strongest evidence tier this system has (section 20, #1). Terms with
 * meaningful spend/clicks and clear intent get HIGH/MEDIUM priority;
 * terms with too little data get INSUFFICIENT_EVIDENCE rather than a
 * fabricated recommendation, matching the sample-size discipline already
 * established in performance/ and optimization/.
 */
export function candidatesFromSearchTerms(
  rows: SearchTermPerformance[],
  customIntents: CustomIntentDefinition[],
  opts: {
    minClicksForEvidence?: number;
    relevanceScoreFn?: (term: string) => number;
    relevanceBasis?: NonNullable<KeywordCandidate["relevanceBasis"]>;
  } = {}
): KeywordCandidate[] {
  const minClicks = opts.minClicksForEvidence ?? 5;
  const relevanceScoreFn = opts.relevanceScoreFn ?? (() => 0.5); // neutral default when caller has no business-matching logic yet
  const relevanceBasis = opts.relevanceBasis ?? (opts.relevanceScoreFn ? "CALLER_SUPPLIED" : "NEUTRAL_DEFAULT_NO_PROFILE_TERMS");

  return rows.map((row) => {
    const classification = classifyTermAgainstIntents(row.searchTerm, customIntents);
    const clicks = row.metrics.clicks ?? 0;
    const conversions = row.metrics.conversions;
    const relevanceScore = relevanceScoreFn(row.searchTerm);
    const commercialScore = classification.confidence;

    const confidence = computeConfidence({
      source: "GOOGLE_ADS_SEARCH_TERMS",
      sampleSize: clicks,
      ageInDays: 0, // caller-supplied rows are assumed current-period; a future phase can thread through the actual report date range
      corroboratingSources: 1,
      businessRelevance: relevanceScore,
    });

    let recommendation: KeywordRecommendation;
    let reason: string;

    if (clicks < minClicks) {
      recommendation = "INSUFFICIENT_EVIDENCE";
      reason = `Only ${clicks} click(s) — below the ${minClicks}-click evidence threshold to recommend action either way.`;
    } else if (classification.intent === "UNKNOWN" && relevanceScore < 0.3) {
      recommendation = "NEGATIVE_CANDIDATE";
      reason = "Unclear intent and low relevance to the business's configured products/services.";
    } else if (conversions !== null && conversions > 0) {
      recommendation = "HIGH_PRIORITY";
      reason = `Actual converting search term (${conversions} conversion(s) from ${clicks} clicks) — the strongest evidence tier available.`;
    } else if (relevanceScore >= 0.6 && classification.intent !== "UNKNOWN") {
      recommendation = "MEDIUM_PRIORITY";
      reason = `Relevant, classified intent (${String(classification.intent)}), but no conversions yet — worth continued monitoring, not yet proven.`;
    } else {
      recommendation = "RESEARCH_ONLY";
      reason = "Some evidence exists but neither strong relevance nor proven conversion performance.";
    }

    return {
      keyword: row.searchTerm,
      intent: classification.intent,
      source: "GOOGLE_ADS_SEARCH_TERMS",
      trendSignal: null, // no trend engine correlation performed at this stage — see mergeTrendSignal below
      relevanceScore,
      commercialScore,
      confidence,
      recommendation,
      reason,
      relevanceBasis,
      evidence: { clicks, impressions: row.metrics.impressions, cost: row.metrics.cost, conversions },
    };
  });
}

/**
 * Candidates from a configured KeywordResearchProvider. Volume/competition
 * are copied verbatim from the provider (null if it gave none). With no
 * Google Ads evidence these can never exceed MEDIUM/RESEARCH_ONLY.
 */
export function candidatesFromProviderIdeas(
  ideas: KeywordResearchCandidate[],
  customIntents: CustomIntentDefinition[],
  relevance: { fn: (term: string) => number; basis: NonNullable<KeywordCandidate["relevanceBasis"]> }
): KeywordCandidate[] {
  return ideas.map((idea) => {
    const classification = classifyTermAgainstIntents(idea.keyword, customIntents);
    const relevanceScore = relevance.fn(idea.keyword);
    const confidence = computeConfidence({
      source: "KEYWORD_RESEARCH_PROVIDER",
      sampleSize: idea.searchVolume,
      ageInDays: null,
      corroboratingSources: 1,
      businessRelevance: relevanceScore,
    });
    const relevant = relevanceScore >= 0.5;
    return {
      keyword: idea.keyword,
      intent: classification.intent,
      source: "KEYWORD_RESEARCH_PROVIDER",
      trendSignal: null,
      relevanceScore,
      commercialScore: classification.confidence,
      confidence,
      recommendation: relevant ? "RESEARCH_ONLY" : "LOW_PRIORITY",
      reason: "Provider-suggested keyword idea with no Google Ads history for this client — a hypothesis to test, not proven demand or profit.",
      relevanceBasis: relevance.basis,
      evidence: null,
      providerSearchVolume: idea.searchVolume,
      providerCompetition: idea.competition,
    } satisfies KeywordCandidate;
  });
}

/** Attaches the multi-dimensional opportunity assessment to every candidate (trend ≠ profit). */
export function assessCandidates(candidates: KeywordCandidate[], affordableCpa: number | null): KeywordCandidate[] {
  return candidates.map((c) => ({
    ...c,
    opportunity: scoreOpportunity({
      trendDirection: c.trendSignal,
      commercialIntent: c.intent === "UNKNOWN" ? null : c.commercialScore > 0 ? c.commercialScore : null,
      businessRelevance: c.relevanceBasis === "NEUTRAL_DEFAULT_NO_PROFILE_TERMS" ? null : c.relevanceScore,
      ads: c.evidence ?? null,
      affordableCpa,
      confidence: c.confidence,
    }),
  }));
}

/**
 * Merges a trend direction onto an existing candidate list where the
 * trend topic matches the keyword text. Section 12/13: a rising trend
 * alone must never upgrade a candidate to HIGH_PRIORITY by itself — it
 * can only elevate a candidate that ALREADY has real Ads evidence
 * (RESEARCH scenario C), and it explicitly must NOT do so for a candidate
 * with no commercial relevance (scenario A).
 */
export function mergeTrendSignal(
  candidates: KeywordCandidate[],
  topic: string,
  direction: TrendDirection
): KeywordCandidate[] {
  return candidates.map((c) => {
    if (c.keyword.toLowerCase() !== topic.toLowerCase()) return c;

    const withTrend: KeywordCandidate = { ...c, trendSignal: direction };

    // Deliberately only "HIGH_PRIORITY" counts as real Ads evidence here —
    // that recommendation is only reached in candidatesFromSearchTerms when
    // there's an actual proven conversion. MEDIUM_PRIORITY (relevant +
    // classified intent, but zero conversions so far) is NOT strong enough
    // evidence to let a trend signal push a candidate to HIGH_PRIORITY —
    // that would let "relevant + trending" masquerade as "proven profitable
    // + trending" (section 12's actual bar).
    const hasRealAdsEvidence = c.recommendation === "HIGH_PRIORITY";
    const hasCommercialRelevance = c.relevanceScore >= 0.5 && c.intent !== "UNKNOWN";

    if (direction === "RISING" && hasRealAdsEvidence && hasCommercialRelevance) {
      return {
        ...withTrend,
        recommendation: "HIGH_PRIORITY",
        reason: withTrend.reason + " Rising trend + existing conversion evidence + business relevance — scaling opportunity worth validating further.",
      };
    }
    if (direction === "RISING" && hasCommercialRelevance && !hasRealAdsEvidence) {
      return {
        ...withTrend,
        recommendation: withTrend.recommendation === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "RESEARCH_ONLY",
        reason: withTrend.reason + " Rising trend + business relevance but no proven Ads conversion evidence yet — validate before committing budget, per trend-is-not-profit rule.",
      };
    }
    if (direction === "RISING" && !hasCommercialRelevance) {
      return {
        ...withTrend,
        recommendation: "RESEARCH_ONLY",
        reason: withTrend.reason + " Rising trend noted, but low business relevance — do not recommend targeting based on the trend alone.",
      };
    }

    return withTrend;
  });
}

/**
 * Explicit entry point for AI-generated keyword expansion, kept separate
 * from candidatesFromSearchTerms so an AI_GENERATED_HYPOTHESIS candidate
 * can never accidentally be constructed with a stronger source tag.
 */
export function addAiExpansionCandidate(keyword: string, intent: IntentType, relevanceScore: number): KeywordCandidate {
  const confidence = computeConfidence({
    source: "AI_EXPANSION",
    sampleSize: null,
    ageInDays: null,
    corroboratingSources: 1,
    businessRelevance: relevanceScore,
  });
  return {
    keyword,
    intent,
    source: "AI_EXPANSION",
    trendSignal: null,
    relevanceScore,
    commercialScore: 0,
    confidence,
    recommendation: "INSUFFICIENT_EVIDENCE",
    reason: "AI_GENERATED_HYPOTHESIS — no external evidence (search terms, trend data, or market research) backs this candidate yet.",
  };
}
