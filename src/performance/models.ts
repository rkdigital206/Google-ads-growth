/**
 * Normalized performance entity models (brief section 15).
 *
 * Every entity embeds the same `metrics: NormalizedMetrics` shape from
 * metrics.ts, so diagnostic/scaling/budget engines (future phases) can
 * write logic once against `metrics` regardless of entity type.
 *
 * Fetchers exist today (this phase) for: Campaign, Keyword, SearchTerm —
 * these have working GAQL queries in google-ads/reporting-service.ts and
 * keyword-service.ts, and normalizer functions in normalize.ts.
 *
 * AdGroup, Ad, Asset, Location, Device, Conversion, and Daily performance
 * are defined here as interfaces ONLY — no live GAQL fetcher exists yet.
 * Building those fetchers is explicitly out of scope for this deliverable
 * (Phase B + C only); wiring them up is straightforward extension work for
 * whichever future phase needs them (ad performance engine, budget/device
 * analysis, etc.) using the same runQuery() + normalizeMetrics() pattern
 * already established for Campaign/Keyword/SearchTerm below.
 */

import type { NormalizedMetrics } from "./metrics.js";

export interface AccountPerformance {
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  metrics: NormalizedMetrics;
}

export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  metrics: NormalizedMetrics;
}

export interface AdGroupPerformance {
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  metrics: NormalizedMetrics;
}

export interface KeywordPerformance {
  criterionId: string;
  keywordText: string;
  matchType: string;
  keywordStatus: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  metrics: NormalizedMetrics;
}

export interface SearchTermPerformance {
  searchTerm: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  metrics: NormalizedMetrics;
}

export interface AdPerformance {
  adId: string;
  adGroupId: string;
  campaignId: string;
  headlines: string[];
  descriptions: string[];
  metrics: NormalizedMetrics;
}

export interface AssetPerformance {
  assetId: string;
  assetType: string;
  metrics: NormalizedMetrics;
}

export interface DevicePerformance {
  device: "MOBILE" | "DESKTOP" | "TABLET" | "CONNECTED_TV" | "OTHER";
  campaignId: string | null;
  metrics: NormalizedMetrics;
}

export interface LocationPerformance {
  locationCriterionId: string;
  locationName: string | null;
  campaignId: string | null;
  metrics: NormalizedMetrics;
}

export interface ConversionPerformance {
  conversionActionId: string;
  conversionActionName: string;
  conversionActionStatus: string;
  category: string | null;
  countingType: string | null;
  metrics: Pick<NormalizedMetrics, "conversions" | "conversionsValue" | "valuePerConversion">;
}

export interface DailyPerformance {
  /** YYYY-MM-DD */
  date: string;
  campaignId: string | null;
  metrics: NormalizedMetrics;
}
