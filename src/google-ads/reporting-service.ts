import { runQuery } from "./client.js";
import { enumName, CampaignStatusEnum, ConversionActionStatusEnum, CountingTypeEnum } from "./enum-utils.js";

export interface DateRange {
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
}

function assertValidRange({ startDate, endDate }: DateRange) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(startDate) || !iso.test(endDate)) {
    throw new Error(`Dates must be YYYY-MM-DD. Got start=${startDate} end=${endDate}`);
  }
  if (new Date(startDate) > new Date(endDate)) {
    throw new Error(`startDate (${startDate}) is after endDate (${endDate})`);
  }
}

/**
 * Named export of the campaign performance row shape — used by
 * performance/normalize.ts so the normalizer doesn't have to redeclare an
 * inline type that could silently drift from the actual GAQL query below.
 */
export interface CampaignPerformanceRow {
  campaign: { id: string; name: string; status: string };
  metrics: {
    clicks: string;
    impressions: string;
    cost_micros: string;
    conversions: number;
    conversions_value: number;
    average_cpc: string;
    ctr: number;
    /** Added for the normalized performance layer (Phase C). Optional: older callers of this row shape don't need it. */
    search_impression_share?: number;
    search_budget_lost_impression_share?: number;
    search_rank_lost_impression_share?: number;
  };
}

/**
 * Campaign-level performance for a date range, ordered by cost descending
 * so the biggest spend items surface first — matches the priority
 * hierarchy in the project brief (revenue/conversions before vanity clicks).
 */
export async function getCampaignPerformance(customerId: string, range: DateRange) {
  assertValidRange(range);
  const rows = await runQuery<CampaignPerformanceRow>(
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status,
            metrics.clicks, metrics.impressions, metrics.cost_micros,
            metrics.conversions, metrics.conversions_value,
            metrics.average_cpc, metrics.ctr,
            metrics.search_impression_share, metrics.search_budget_lost_impression_share,
            metrics.search_rank_lost_impression_share
     FROM campaign
     WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
       AND campaign.status != 'REMOVED'
     ORDER BY metrics.cost_micros DESC`
  );
  return rows.map((r) => ({ ...r, campaign: { ...r.campaign, status: enumName(CampaignStatusEnum, r.campaign.status) } }));
}

/** Named export of the search term row shape, matching search-term-optimizer.ts's SearchTermRow exactly (unchanged) — re-exported here so performance/normalize.ts can share one source of truth instead of redeclaring it. */
export interface SearchTermPerformanceRow {
  search_term_view: { search_term: string };
  campaign: { id: string; name: string };
  ad_group: { id: string; name: string };
  metrics: {
    clicks: string;
    impressions: string;
    cost_micros: string;
    conversions: number;
  };
}

/**
 * Search term report — the raw material for negative-keyword mining and
 * discovering intent leaking budget in the wrong direction (see
 * search-term-optimizer.ts / domain/intent.ts for classification).
 */
export async function getSearchTermReport(customerId: string, range: DateRange, campaignId?: string) {
  assertValidRange(range);
  const campaignFilter = campaignId ? `AND campaign.id = ${Number(campaignId)}` : "";
  return runQuery<SearchTermPerformanceRow>(
    customerId,
    `SELECT search_term_view.search_term, campaign.id, campaign.name,
            ad_group.id, ad_group.name,
            metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
     FROM search_term_view
     WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'
       ${campaignFilter}
     ORDER BY metrics.cost_micros DESC
     LIMIT 500`
  );
}

/** Conversion action setup — critical to audit BEFORE trusting any conversion metric above. */
export async function getConversionActions(customerId: string) {
  const rows = await runQuery<{
    conversion_action: {
      id: string;
      name: string;
      status: string;
      type: string;
      category: string;
      counting_type: string;
    };
  }>(
    customerId,
    `SELECT conversion_action.id, conversion_action.name, conversion_action.status,
            conversion_action.type, conversion_action.category, conversion_action.counting_type
     FROM conversion_action
     WHERE conversion_action.status != 'REMOVED'`
  );
  return rows.map((r) => ({
    conversion_action: {
      ...r.conversion_action,
      status: enumName(ConversionActionStatusEnum, r.conversion_action.status),
      counting_type: enumName(CountingTypeEnum, r.conversion_action.counting_type),
    },
  }));
}
