import { describe, it, expect } from "vitest";
import { normalizeMetrics, sumMetrics } from "../src/performance/metrics.js";
import {
  normalizeCampaignPerformance,
  normalizeKeywordPerformance,
  normalizeSearchTermPerformance,
  aggregateAccountPerformance,
} from "../src/performance/normalize.js";

describe("normalizeMetrics", () => {
  it("computes CTR, conversion rate, CPA, and ROAS from raw fields", () => {
    const m = normalizeMetrics({
      clicks: "100",
      impressions: "2000",
      cost_micros: "50000000", // 50.00 in account currency
      conversions: 5,
      conversions_value: 500,
      average_cpc: "500000",
    });

    expect(m.impressions).toBe(2000);
    expect(m.clicks).toBe(100);
    expect(m.ctr).toBeCloseTo(0.05);
    expect(m.cost).toBeCloseTo(50);
    expect(m.averageCpc).toBeCloseTo(0.5);
    expect(m.conversions).toBe(5);
    expect(m.conversionRate).toBeCloseTo(0.05);
    expect(m.costPerConversion).toBeCloseTo(10);
    expect(m.conversionsValue).toBe(500);
    expect(m.valuePerConversion).toBeCloseTo(100);
    expect(m.roas).toBeCloseTo(10);
  });

  it("returns null (not zero, not fabricated) for fields not present in the source data", () => {
    const m = normalizeMetrics({ clicks: "10", cost_micros: "1000000" });
    expect(m.impressions).toBeNull();
    expect(m.ctr).toBeNull(); // can't compute without impressions
    expect(m.conversions).toBeNull();
    expect(m.conversionRate).toBeNull();
    expect(m.roas).toBeNull();
  });

  it("distinguishes zero conversions (real data) from missing conversions data (null)", () => {
    const zeroConversions = normalizeMetrics({ clicks: "40", cost_micros: "10000000", conversions: 0 });
    expect(zeroConversions.conversions).toBe(0);
    expect(zeroConversions.conversionRate).toBe(0);
    expect(zeroConversions.costPerConversion).toBeNull(); // division by zero conversions is undefined, not Infinity

    const missingConversions = normalizeMetrics({ clicks: "40", cost_micros: "10000000" });
    expect(missingConversions.conversions).toBeNull();
    expect(missingConversions.conversionRate).toBeNull();
  });

  it("does not fabricate impression-share fields when absent", () => {
    const m = normalizeMetrics({ clicks: "1", impressions: "1" });
    expect(m.searchImpressionShare).toBeNull();
    expect(m.searchBudgetLostImpressionShare).toBeNull();
    expect(m.searchRankLostImpressionShare).toBeNull();
  });

  it("passes through impression-share fields when present", () => {
    const m = normalizeMetrics({
      clicks: "1",
      impressions: "1",
      search_impression_share: 0.72,
      search_budget_lost_impression_share: 0.1,
      search_rank_lost_impression_share: 0.18,
    });
    expect(m.searchImpressionShare).toBeCloseTo(0.72);
    expect(m.searchBudgetLostImpressionShare).toBeCloseTo(0.1);
    expect(m.searchRankLostImpressionShare).toBeCloseTo(0.18);
  });
});

describe("sumMetrics", () => {
  it("sums absolutes and recomputes ratios rather than averaging them", () => {
    const a = normalizeMetrics({ clicks: "100", impressions: "1000", cost_micros: "10000000", conversions: 10, conversions_value: 200 });
    const b = normalizeMetrics({ clicks: "50", impressions: "500", cost_micros: "5000000", conversions: 0, conversions_value: 0 });

    const total = sumMetrics([a, b]);
    expect(total.clicks).toBe(150);
    expect(total.impressions).toBe(1500);
    expect(total.cost).toBeCloseTo(15);
    expect(total.conversions).toBe(10);
    // Recomputed from summed absolutes: 150 clicks / 1500 impressions
    expect(total.ctr).toBeCloseTo(0.1);
    // 10 conversions / 150 clicks, not an average of the two campaigns' conversion rates
    expect(total.conversionRate).toBeCloseTo(10 / 150);
  });

  it("does not aggregate impression-share metrics (not meaningful summed)", () => {
    const a = normalizeMetrics({ clicks: "1", impressions: "1", search_impression_share: 0.5 });
    const total = sumMetrics([a]);
    expect(total.searchImpressionShare).toBeNull();
  });
});

describe("entity adapters", () => {
  it("normalizes a campaign row", () => {
    const row = {
      campaign: { id: "111", name: "SEARCH - BUY - Core", status: "ENABLED" },
      metrics: {
        clicks: "20",
        impressions: "400",
        cost_micros: "8000000",
        conversions: 2,
        conversions_value: 100,
        average_cpc: "400000",
        ctr: 0.05,
      },
    };
    const perf = normalizeCampaignPerformance(row);
    expect(perf.campaignId).toBe("111");
    expect(perf.campaignName).toBe("SEARCH - BUY - Core");
    expect(perf.metrics.clicks).toBe(20);
    expect(perf.metrics.roas).toBeCloseTo(12.5);
  });

  it("normalizes a keyword row, leaving impressions/ctr null since listKeywords doesn't select them", () => {
    const row = {
      ad_group_criterion: {
        criterion_id: "555",
        keyword: { text: "used fridge dubai", match_type: "BROAD" },
        status: "ENABLED",
      },
      campaign: { id: "111", name: "SEARCH - BUY - Core" },
      ad_group: { id: "222", name: "Buy - Refrigerators" },
      metrics: { clicks: "5", conversions: 1, cost_micros: "2000000" },
    };
    const perf = normalizeKeywordPerformance(row);
    expect(perf.keywordText).toBe("used fridge dubai");
    expect(perf.metrics.clicks).toBe(5);
    expect(perf.metrics.impressions).toBeNull();
    expect(perf.metrics.ctr).toBeNull();
  });

  it("normalizes a search term row", () => {
    const row = {
      search_term_view: { search_term: "sell used fridge dubai" },
      campaign: { id: "111", name: "SEARCH - BUY - Core" },
      ad_group: { id: "222", name: "Buy - Refrigerators" },
      metrics: { clicks: "12", impressions: "80", cost_micros: "3000000", conversions: 0 },
    };
    const perf = normalizeSearchTermPerformance(row);
    expect(perf.searchTerm).toBe("sell used fridge dubai");
    expect(perf.metrics.conversions).toBe(0);
    expect(perf.metrics.costPerConversion).toBeNull();
  });

  it("aggregates campaign performances into account performance", () => {
    const campaigns = [
      normalizeCampaignPerformance({
        campaign: { id: "1", name: "A", status: "ENABLED" },
        metrics: { clicks: "10", impressions: "100", cost_micros: "1000000", conversions: 1, conversions_value: 50, average_cpc: "100000", ctr: 0.1 },
      }),
      normalizeCampaignPerformance({
        campaign: { id: "2", name: "B", status: "ENABLED" },
        metrics: { clicks: "20", impressions: "200", cost_micros: "2000000", conversions: 2, conversions_value: 100, average_cpc: "100000", ctr: 0.1 },
      }),
    ];
    const account = aggregateAccountPerformance(
      { customerId: "999", descriptiveName: "Test Account", currencyCode: "AED", timeZone: "Asia/Dubai", status: "ENABLED" },
      campaigns
    );
    expect(account.metrics.clicks).toBe(30);
    expect(account.metrics.conversions).toBe(3);
    expect(account.metrics.cost).toBeCloseTo(3);
  });
});
