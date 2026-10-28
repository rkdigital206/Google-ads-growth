/**
 * Universal research domain model (Phase D, section 3).
 *
 * Nothing here references Murooj, appliances, Dubai, or any specific
 * provider. A ResearchFinding about a SaaS company's pricing page and one
 * about a used-appliance dealer's WhatsApp number are the same shape.
 */

export const RESEARCH_SOURCES = [
  "WEBSITE",
  "GOOGLE_ADS_SEARCH_TERMS",
  "GOOGLE_ADS_KEYWORD_HISTORY",
  "GOOGLE_ADS_ACCOUNT",
  "CLIENT_PROVIDED",
  "GOOGLE_TRENDS",
  "MARKET_RESEARCH",
  "CUSTOMER_LANGUAGE",
  "COMPETITOR_RESEARCH",
  "KEYWORD_RESEARCH_PROVIDER",
  "AI_EXPANSION",
] as const;

export type ResearchSource = (typeof RESEARCH_SOURCES)[number];

export const RESEARCH_STATES = ["NOT_STARTED", "RUNNING", "PARTIAL", "COMPLETE", "FAILED", "BLOCKED"] as const;
export type ResearchState = (typeof RESEARCH_STATES)[number];

/** How a business claim was established — section 6. Never let INFERRED masquerade as VERIFIED. */
export const CLAIM_STATUSES = ["VERIFIED", "INFERRED", "UNKNOWN"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * FACT (directly observed in a source), INFERENCE (derived from facts),
 * HYPOTHESIS (plausible but unvalidated), UNKNOWN (no data — stated as a gap,
 * never filled with a guess).
 */
export const EPISTEMIC_STATUSES = ["FACT", "INFERENCE", "HYPOTHESIS", "UNKNOWN"] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export interface ResearchEvidence {
  source: ResearchSource;
  sourceUrl: string | null;
  retrievedAt: string; // ISO 8601
  /** The concrete datum this evidence rests on — a raw metric, a quoted page snippet, a trend value, etc. */
  detail: string;
}

export interface ResearchFinding {
  id: string;
  clientId: string;
  category: string;
  title: string;
  finding: string;
  evidence: ResearchEvidence[];
  epistemicStatus: EpistemicStatus;
  /** 0.0–1.0. Must be produced by the confidence engine (research/engines/confidence.ts), never assigned ad hoc. */
  confidence: number;
  status: ResearchState;
  implications: string[];
}

export interface ResearchQuery {
  clientId: string;
  /** Free-text topic/keyword/query this research question concerns. */
  topic: string;
  geography?: string;
  timeframe?: { start: string; end: string };
}

/** Machine-readable reason a research capability produced no (or partial) data. */
export const RESEARCH_ISSUE_CODES = [
  "PROVIDER_NOT_CONFIGURED",
  "DATA_UNAVAILABLE",
  "ACCESS_BLOCKED",
  "NOT_ATTEMPTED",
  "PROVIDER_ERROR",
] as const;
export type ResearchIssueCode = (typeof RESEARCH_ISSUE_CODES)[number];

export interface ResearchResult<T> {
  state: ResearchState;
  /** Set whenever state is not COMPLETE, so callers/tools can branch without parsing issue text. */
  code?: ResearchIssueCode;
  data: T | null;
  /** Populated when state is PARTIAL/FAILED/BLOCKED — human-readable, never silently swallowed. */
  issues: string[];
}

export const OPPORTUNITY_TYPES = [
  "NEW_KEYWORD",
  "KEYWORD_EXPANSION",
  "TREND_OPPORTUNITY",
  "SEASONAL_OPPORTUNITY",
  "GEOGRAPHIC_OPPORTUNITY",
  "PRODUCT_OPPORTUNITY",
  "SERVICE_OPPORTUNITY",
  "LANDING_PAGE_OPPORTUNITY",
  "MESSAGING_OPPORTUNITY",
  "NEGATIVE_KEYWORD_OPPORTUNITY",
] as const;

export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export interface ResearchOpportunity {
  id: string;
  clientId: string;
  type: OpportunityType;
  title: string;
  description: string;
  evidence: ResearchEvidence[];
  confidence: number;
  /** What should happen next — this layer never decides to create a campaign (section 40). */
  recommendedNextStep: string;
}
