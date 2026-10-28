/**
 * Adapters: raw Google Ads GAQL row -> normalized performance entity.
 *
 * These are intentionally thin — all the actual metric math lives in
 * metrics.ts's normalizeMetrics(), called once per adapter. Adding a new
 * entity type's fetcher in a future phase should mean adding one small
 * adapter function here, not reimplementing CTR/CPA/ROAS math again.
 */

import type { CampaignPerformanceRow, SearchTermPerformanceRow } from "../google-ads/reporting-service.js";
import type { KeywordPerformanceRow } from "../google-ads/keyword-service.js";
import type { AccountSummary } from "../google-ads/account-service.js";
import { normalizeMetrics, sumMetrics, type NormalizedMetrics } from "./metrics.js";
import type { AccountPerformance, CampaignPerformance, KeywordPerformance, SearchTermPerformance } from "./models.js";

export function normalizeCampaignPerformance(row: CampaignPerformanceRow): CampaignPerformance {
  return {
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    campaignStatus: row.campaign.status,
    metrics: normalizeMetrics(row.metrics),
  };
}

export function normalizeKeywordPerformance(row: KeywordPerformanceRow): KeywordPerformance {
  return {
    criterionId: row.ad_group_criterion.criterion_id,
    keywordText: row.ad_group_criterion.keyword.text,
    matchType: row.ad_group_criterion.keyword.match_type,
    keywordStatus: row.ad_group_criterion.status,
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    adGroupId: row.ad_group.id,
    adGroupName: row.ad_group.name,
    // listKeywords() does not currently select impressions/ctr/conversions_value —
    // normalizeMetrics() correctly returns null for those rather than guessing.
    metrics: normalizeMetrics(row.metrics),
  };
}

export function normalizeSearchTermPerformance(row: SearchTermPerformanceRow): SearchTermPerformance {
  return {
    searchTerm: row.search_term_view.search_term,
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    adGroupId: row.ad_group.id,
    adGroupName: row.ad_group.name,
    // getSearchTermReport() does not currently select conversions_value —
    // normalizeMetrics() returns null for roas/valuePerConversion accordingly.
    metrics: normalizeMetrics(row.metrics),
  };
}

/**
 * Rolls a set of already-normalized campaign performances up into an
 * account-level view. Deliberately takes normalized CampaignPerformance[]
 * rather than raw rows — account performance IS the sum of its campaigns,
 * there's no separate "account metrics" GAQL query needed for this, which
 * also guarantees the account total always reconciles with the campaign
 * breakdown shown alongside it (no risk of two different queries drifting
 * apart on a partial-data day).
 */
export function aggregateAccountPerformance(
  account: AccountSummary,
  campaigns: CampaignPerformance[]
): AccountPerformance {
  const metrics: NormalizedMetrics = sumMetrics(campaigns.map((c) => c.metrics));
  return {
    customerId: account.customerId,
    descriptiveName: account.descriptiveName ?? null,
    currencyCode: account.currencyCode ?? null,
    metrics,
  };
}
