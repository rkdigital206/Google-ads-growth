/**
 * Opportunity scoring (Phase E.1 section 14).
 *
 * A RISING TREND IS NOT A PROFITABLE GOOGLE ADS OPPORTUNITY. This module
 * keeps seven independent evidence dimensions apart and applies explicit
 * gates, so demand signals can never stand in for proof of profitability:
 *
 *   trend signal        – is search interest rising?               (demand)
 *   commercial intent   – does the query signal willingness to act? (intent)
 *   business relevance  – does it match what the client sells?      (fit)
 *   Ads evidence        – has the account actually bought clicks?   (history)
 *   conversion evidence – did those clicks convert?                 (proof)
 *   economics           – is the observed CPA affordable?           (profit)
 *   confidence          – how much data stands behind all of this?
 *
 * Dimensions with no data are `null` and excluded from the composite score —
 * never defaulted. GATES (not weights) decide the classification:
 *
 *   VALIDATED_OPPORTUNITY requires real conversion evidence AND relevance AND
 *   known intent AND (when economics are known) affordable CPA.
 *   A trend can raise PROMISING_UNVALIDATED at most — never VALIDATED.
 *
 * Pure and deterministic; performs no I/O and creates no mutations.
 */

import type { TrendDirection } from "./providers/types.js";

export interface OpportunityEvidenceInput {
  /** Direction from the trend engine, or null when no trend data exists. */
  trendDirection: TrendDirection | null;
  /** 0-1 strength of the commercial-intent classification, or null if unclassified/unknown. */
  commercialIntent: number | null;
  /** 0-1 fit with the client's products/services, or null if it could not be assessed. */
  businessRelevance: number | null;
  /** Real account history for this term/keyword, or null if the account has none/was not queried. */
  ads: { clicks: number; impressions: number | null; cost: number | null; conversions: number | null } | null;
  /** Maximum CPA the business can afford (targetCPA, or derived maxCpa), or null if economics are unknown. */
  affordableCpa: number | null;
  /** Overall data confidence 0-1 from the confidence engine. */
  confidence: number;
}

export const OPPORTUNITY_CLASSIFICATIONS = [
  "VALIDATED_OPPORTUNITY",
  "PROMISING_UNVALIDATED",
  "TREND_ONLY",
  "NOT_RECOMMENDED",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type OpportunityClassification = (typeof OPPORTUNITY_CLASSIFICATIONS)[number];

export interface OpportunityDimension {
  /** 0-1, or null when there is no data for this dimension. */
  score: number | null;
  note: string;
}

export interface OpportunityAssessment {
  classification: OpportunityClassification;
  /** Weighted composite over the dimensions that HAVE data; null if none do. Informational — the classification is gate-based. */
  compositeScore: number | null;
  dimensions: {
    trendSignal: OpportunityDimension;
    commercialIntent: OpportunityDimension;
    businessRelevance: OpportunityDimension;
    adsEvidence: OpportunityDimension;
    conversionEvidence: OpportunityDimension;
    economics: OpportunityDimension;
  };
  confidence: number;
  /** Which dimensions had no data. */
  missingEvidence: string[];
  rationale: string[];
}

/** Minimum clicks before a zero/low-conversion history counts as evidence rather than noise. */
export const MIN_CLICKS_FOR_ADS_EVIDENCE = 20;

/** Trend is deliberately the lightest weight: demand is the weakest proof of profit. */
const WEIGHTS = {
  trendSignal: 0.05,
  commercialIntent: 0.2,
  businessRelevance: 0.2,
  adsEvidence: 0.15,
  conversionEvidence: 0.25,
  economics: 0.15,
} as const;

function trendScore(direction: TrendDirection | null): OpportunityDimension {
  switch (direction) {
    case null:
    case "UNKNOWN":
    case "INSUFFICIENT_DATA":
      return { score: null, note: "No usable trend data." };
    case "RISING":
      return { score: 0.9, note: "Search interest is rising (a demand signal only — says nothing about profitability)." };
    case "SEASONAL":
      return { score: 0.6, note: "Seasonal demand pattern." };
    case "STABLE":
      return { score: 0.5, note: "Stable demand." };
    case "VOLATILE":
      return { score: 0.3, note: "Volatile, hard-to-trust demand." };
    case "DECLINING":
      return { score: 0.1, note: "Search interest is declining." };
  }
}

export function scoreOpportunity(input: OpportunityEvidenceInput): OpportunityAssessment {
  const rationale: string[] = [];

  const trend = trendScore(input.trendDirection);
  const intent: OpportunityDimension =
    input.commercialIntent === null ? { score: null, note: "Intent unclassified or unknown." } : { score: input.commercialIntent, note: `Intent classification strength ${input.commercialIntent.toFixed(2)}.` };
  const relevance: OpportunityDimension =
    input.businessRelevance === null ? { score: null, note: "Relevance to the business could not be assessed." } : { score: input.businessRelevance, note: `Relevance to configured products/services ${input.businessRelevance.toFixed(2)}.` };

  const ads = input.ads;
  const adsEvidence: OpportunityDimension =
    ads === null
      ? { score: null, note: "No Google Ads history for this term." }
      : ads.clicks < MIN_CLICKS_FOR_ADS_EVIDENCE
        ? { score: Math.min(0.4, ads.clicks / MIN_CLICKS_FOR_ADS_EVIDENCE * 0.4), note: `Only ${ads.clicks} click(s) — below the ${MIN_CLICKS_FOR_ADS_EVIDENCE}-click evidence floor.` }
        : { score: Math.min(1, 0.5 + ads.clicks / 400), note: `${ads.clicks} real click(s) of account history.` };

  const hasVolume = ads !== null && ads.clicks >= MIN_CLICKS_FOR_ADS_EVIDENCE;
  const conversions = ads?.conversions ?? null;
  const conversionEvidence: OpportunityDimension =
    ads === null || conversions === null
      ? { score: null, note: "No conversion data for this term." }
      : conversions > 0
        ? { score: Math.min(1, 0.6 + conversions / 25), note: `${conversions} conversion(s) from ${ads.clicks} click(s).` }
        : hasVolume
          ? { score: 0, note: `${ads.clicks} clicks and zero conversions — negative evidence.` }
          : { score: null, note: "Zero conversions but too few clicks to count as evidence either way." };

  const observedCpa = ads !== null && ads.cost !== null && conversions !== null && conversions > 0 ? ads.cost / conversions : null;
  const economics: OpportunityDimension =
    observedCpa === null || input.affordableCpa === null
      ? {
          score: null,
          note: input.affordableCpa === null ? "No affordable-CPA figure (targetCPA/maxCpa unknown) — profitability cannot be judged." : "No observed CPA (no conversions) — profitability cannot be judged.",
        }
      : { score: Math.max(0, Math.min(1, input.affordableCpa / observedCpa)), note: `Observed CPA ${observedCpa.toFixed(2)} vs affordable ${input.affordableCpa.toFixed(2)}.` };

  const dimensions = { trendSignal: trend, commercialIntent: intent, businessRelevance: relevance, adsEvidence, conversionEvidence, economics };

  // Composite over available dimensions only.
  const entries = Object.entries(dimensions) as [keyof typeof WEIGHTS, OpportunityDimension][];
  const available = entries.filter(([, d]) => d.score !== null);
  const totalWeight = available.reduce((s, [k]) => s + WEIGHTS[k], 0);
  const compositeScore = available.length === 0 ? null : available.reduce((s, [k, d]) => s + (d.score as number) * WEIGHTS[k], 0) / totalWeight;
  const missingEvidence = entries.filter(([, d]) => d.score === null).map(([k]) => k);

  // ---- Gates (these, not the composite, decide the classification) ----
  const relevant = (input.businessRelevance ?? 0) >= 0.5;
  const intentKnown = (input.commercialIntent ?? 0) > 0;
  const proven = conversions !== null && conversions > 0 && hasVolume;
  const disproven = hasVolume && conversions === 0;
  const affordable = economics.score === null ? null : economics.score >= 1 ? true : economics.score >= 0.8;
  const rising = input.trendDirection === "RISING";

  let classification: OpportunityClassification;
  if (disproven) {
    classification = "NOT_RECOMMENDED";
    rationale.push("Real clicks with zero conversions is direct negative evidence; no trend or relevance signal overrides it.");
  } else if (proven && relevant && intentKnown && affordable !== false) {
    classification = "VALIDATED_OPPORTUNITY";
    rationale.push("Backed by real conversions, business relevance and known intent" + (affordable === true ? ", with an affordable observed CPA." : "; profitability still unconfirmed because economics are incomplete."));
  } else if (proven && affordable === false) {
    classification = "NOT_RECOMMENDED";
    rationale.push("Converts, but the observed CPA exceeds what the business can afford.");
  } else if (relevant && intentKnown) {
    classification = "PROMISING_UNVALIDATED";
    rationale.push("Relevant with a known intent, but no proven conversion evidence — validate with a small test before committing budget.");
    if (rising) rationale.push("The rising trend is a demand signal and does not validate profitability.");
  } else if (rising) {
    classification = "TREND_ONLY";
    rationale.push("The only positive signal is a rising trend. A rising trend is NOT a profitable Google Ads opportunity; relevance and/or intent are unproven.");
  } else if (available.length === 0 || (input.businessRelevance === null && input.commercialIntent === null)) {
    classification = "INSUFFICIENT_EVIDENCE";
    rationale.push("Not enough evidence in any dimension to classify.");
  } else {
    classification = "NOT_RECOMMENDED";
    rationale.push("Insufficient relevance/intent to justify pursuing this.");
  }

  // Confidence can only fall with missing proof: never above the supplied data confidence,
  // and capped when there is no conversion evidence.
  const confidence = Math.max(0, Math.min(input.confidence, proven ? 1 : 0.6));

  return { classification, compositeScore, dimensions, confidence, missingEvidence, rationale };
}
