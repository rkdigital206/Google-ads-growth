/**
 * Canonical performance metrics — the single implementation every entity
 * normalizer in normalize.ts calls into. Brief section 15: "All
 * calculations must have one canonical implementation."
 *
 * Two things this module is strict about:
 *   1. Raw Google Ads GAQL fields arrive as strings for int64 metrics
 *      (clicks, impressions, cost_micros) and numbers for doubles
 *      (conversions, ctr, average_cpc as a double in some reports). This
 *      module normalizes that inconsistency once, here.
 *   2. A field that was not present in the source data produces `null`,
 *      never `0` and never a computed guess. `0` means "the API returned
 *      zero"; `null` means "we don't know." Conflating the two is exactly
 *      the kind of fabrication the brief prohibits (section 3: "Where a
 *      metric is unavailable: return null / unavailable. Never fabricate
 *      metrics.").
 */

import { fromMicros } from "../utils/validation.js";

/**
 * Raw metrics fields as they show up in Google Ads GAQL "metrics.*"
 * segments across the reporting-service.ts queries already in this
 * codebase. All fields optional — different GAQL queries select different
 * subsets, and this type must not force callers to fabricate the rest.
 */
export interface RawMetricsFields {
  clicks?: string | number;
  impressions?: string | number;
  cost_micros?: string | number;
  conversions?: number;
  conversions_value?: number;
  average_cpc?: string | number;
  ctr?: number;
  search_impression_share?: number;
  search_budget_lost_impression_share?: number;
  search_rank_lost_impression_share?: number;
}

/** Canonical normalized metrics shape every performance entity embeds. */
export interface NormalizedMetrics {
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cost: number | null;
  averageCpc: number | null;
  conversions: number | null;
  conversionRate: number | null;
  costPerConversion: number | null;
  conversionsValue: number | null;
  valuePerConversion: number | null;
  roas: number | null;
  searchImpressionShare: number | null;
  searchBudgetLostImpressionShare: number | null;
  searchRankLostImpressionShare: number | null;
}

function toNumberOrNull(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/** Safe division: null if either operand is unavailable, or if dividing by zero (not an error, just undefined). */
function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Converts a raw Google Ads metrics fragment into the canonical normalized
 * shape. Every derived field (ctr, conversionRate, costPerConversion,
 * roas, etc.) is RECOMPUTED here from the raw inputs rather than trusted
 * from whatever the API happened to return for e.g. `ctr` or `average_cpc`
 * — this guarantees one consistent definition across every entity type,
 * per brief section 15, rather than campaign-level ctr and keyword-level
 * ctr silently using different underlying math because two different GAQL
 * responses formatted them differently.
 */
export function normalizeMetrics(raw: RawMetricsFields): NormalizedMetrics {
  const impressions = toNumberOrNull(raw.impressions);
  const clicks = toNumberOrNull(raw.clicks);
  const conversions = toNumberOrNull(raw.conversions);
  const conversionsValue = toNumberOrNull(raw.conversions_value);

  const cost = raw.cost_micros === undefined ? null : fromMicros(raw.cost_micros);
  const averageCpc = raw.average_cpc === undefined ? null : fromMicros(raw.average_cpc);

  const ctr = safeDivide(clicks, impressions);
  const conversionRate = safeDivide(conversions, clicks);
  const costPerConversion = safeDivide(cost, conversions);
  const valuePerConversion = safeDivide(conversionsValue, conversions);
  const roas = safeDivide(conversionsValue, cost);

  return {
    impressions,
    clicks,
    ctr,
    cost,
    averageCpc,
    conversions,
    conversionRate,
    costPerConversion,
    conversionsValue,
    valuePerConversion,
    roas,
    searchImpressionShare: raw.search_impression_share ?? null,
    searchBudgetLostImpressionShare: raw.search_budget_lost_impression_share ?? null,
    searchRankLostImpressionShare: raw.search_rank_lost_impression_share ?? null,
  };
}

/** Sums normalized metrics across multiple entities into an aggregate — used for rolling campaigns up to account-level, etc. Rate/ratio fields are recomputed from the summed absolutes, never averaged. */
export function sumMetrics(metrics: NormalizedMetrics[]): NormalizedMetrics {
  const sumField = (field: "impressions" | "clicks" | "cost" | "conversions" | "conversionsValue") => {
    const values = metrics.map((m) => m[field]).filter((v): v is number => v !== null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };

  const impressions = sumField("impressions");
  const clicks = sumField("clicks");
  const cost = sumField("cost");
  const conversions = sumField("conversions");
  const conversionsValue = sumField("conversionsValue");

  return {
    impressions,
    clicks,
    cost,
    conversions,
    conversionsValue,
    ctr: safeDivide(clicks, impressions),
    averageCpc: safeDivide(cost, clicks),
    conversionRate: safeDivide(conversions, clicks),
    costPerConversion: safeDivide(cost, conversions),
    valuePerConversion: safeDivide(conversionsValue, conversions),
    roas: safeDivide(conversionsValue, cost),
    // Impression share metrics don't sum meaningfully across entities
    // (they're already ratios); aggregate views should treat them as
    // unavailable rather than average them here.
    searchImpressionShare: null,
    searchBudgetLostImpressionShare: null,
    searchRankLostImpressionShare: null,
  };
}
