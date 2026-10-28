/**
 * Central confidence engine (Phase D, section 26).
 *
 * Documented, deterministic scoring — no engine may assign a confidence
 * number by hand. Every factor and its weight is spelled out here so the
 * score is auditable, per section 25's "do not create arbitrary scores
 * without documented logic."
 *
 * Weights (sum to 1.0):
 *   sourceReliability   0.30  — how trustworthy is this kind of evidence in general (section 20's hierarchy)
 *   sampleSize          0.20  — how much underlying data supports the finding
 *   recency             0.15  — how fresh the evidence is
 *   crossSourceAgreement 0.20 — do multiple independent sources agree
 *   businessRelevance   0.15  — how directly this connects to the client's actual business
 *
 * Each factor is scored 0-1 by the functions below; the weighted sum is
 * the final confidence, clamped to [0, 1].
 */

import type { ResearchSource } from "../types.js";

export interface ConfidenceInputs {
  source: ResearchSource;
  /** Number of independent data points backing this finding (clicks, search volume samples, trend observations, etc). Null if not quantifiable. */
  sampleSize: number | null;
  /** How many days old the evidence is. Null if unknown/not time-based. */
  ageInDays: number | null;
  /** How many independent sources corroborate this same finding. 1 = single source. */
  corroboratingSources: number;
  /** Direct business relevance 0-1 — e.g. 1.0 for the client's own converting search term, lower for a generically related trend. Supplied by the calling engine, which has business context this module doesn't. */
  businessRelevance: number;
}

/**
 * Evidence hierarchy from section 20, encoded as base reliability scores.
 * An actual converting Google Ads search term is the strongest evidence
 * this system can have; an AI-generated semantic expansion is the weakest.
 */
const SOURCE_RELIABILITY: Record<ResearchSource, number> = {
  GOOGLE_ADS_SEARCH_TERMS: 1.0, // actual converting search term / real account data
  GOOGLE_ADS_KEYWORD_HISTORY: 0.9, // historical profitable keyword
  GOOGLE_ADS_ACCOUNT: 0.9, // account configuration/performance read directly from the Google Ads API
  CLIENT_PROVIDED: 0.7, // economics/profile values stated by the client — trusted, but unverified by us
  GOOGLE_TRENDS: 0.6, // demand signal, not a conversion signal
  MARKET_RESEARCH: 0.55,
  KEYWORD_RESEARCH_PROVIDER: 0.6, // provider-reported volume/competition: a demand estimate, not a conversion signal
  CUSTOMER_LANGUAGE: 0.5,
  WEBSITE: 0.5, // verified claims are reliable, but website data alone doesn't establish demand
  COMPETITOR_RESEARCH: 0.4,
  AI_EXPANSION: 0.2, // AI_GENERATED_HYPOTHESIS — never treated as verified demand (section 19)
};

function scoreSampleSize(sampleSize: number | null): number {
  if (sampleSize === null) return 0.3; // unknown sample size — mildly penalized, not zeroed
  if (sampleSize <= 0) return 0;
  // Diminishing returns: 5 samples -> ~0.4, 30 -> ~0.75, 100+ -> ~0.95
  return Math.min(0.95, Math.log10(sampleSize + 1) / Math.log10(120));
}

function scoreRecency(ageInDays: number | null): number {
  if (ageInDays === null) return 0.5; // unknown age — neutral, not penalized or rewarded
  if (ageInDays <= 7) return 1.0;
  if (ageInDays <= 30) return 0.85;
  if (ageInDays <= 90) return 0.6;
  if (ageInDays <= 180) return 0.35;
  return 0.15;
}

function scoreCrossSourceAgreement(corroboratingSources: number): number {
  if (corroboratingSources <= 1) return 0.4;
  if (corroboratingSources === 2) return 0.7;
  return 0.95; // 3+ independent sources agreeing
}

const WEIGHTS = {
  sourceReliability: 0.3,
  sampleSize: 0.2,
  recency: 0.15,
  crossSourceAgreement: 0.2,
  businessRelevance: 0.15,
};

export function computeConfidence(inputs: ConfidenceInputs): number {
  const sourceReliability = SOURCE_RELIABILITY[inputs.source];
  const sampleSize = scoreSampleSize(inputs.sampleSize);
  const recency = scoreRecency(inputs.ageInDays);
  const crossSourceAgreement = scoreCrossSourceAgreement(inputs.corroboratingSources);
  const businessRelevance = Math.max(0, Math.min(1, inputs.businessRelevance));

  const score =
    sourceReliability * WEIGHTS.sourceReliability +
    sampleSize * WEIGHTS.sampleSize +
    recency * WEIGHTS.recency +
    crossSourceAgreement * WEIGHTS.crossSourceAgreement +
    businessRelevance * WEIGHTS.businessRelevance;

  return Math.max(0, Math.min(1, score));
}

export type ConfidenceBand = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export function confidenceBand(score: number): ConfidenceBand {
  if (score < 0.2) return "VERY_LOW";
  if (score < 0.4) return "LOW";
  if (score < 0.6) return "MEDIUM";
  if (score < 0.8) return "HIGH";
  return "VERY_HIGH";
}
