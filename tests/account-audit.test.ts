import { describe, it, expect } from "vitest";
import { scoreTracking, scoreStructure, scoreWastedSpend, scoreConversionPerformance, scoreBudgetUtilization } from "../src/audit/account-audit.js";

describe("scoreTracking", () => {
  it("scores 0 with no conversion actions configured", () => {
    expect(scoreTracking([]).score).toBe(0);
  });

  it("scores 100 when all conversion actions are enabled", () => {
    const actions = [
      { conversion_action: { status: "ENABLED", counting_type: "ONE_PER_CLICK" } },
      { conversion_action: { status: "ENABLED", counting_type: "ONE_PER_CLICK" } },
    ];
    expect(scoreTracking(actions).score).toBe(100);
  });

  it("scores proportionally when some conversion actions are disabled", () => {
    const actions = [
      { conversion_action: { status: "ENABLED", counting_type: "ONE_PER_CLICK" } },
      { conversion_action: { status: "REMOVED", counting_type: "ONE_PER_CLICK" } },
    ];
    expect(scoreTracking(actions).score).toBe(50);
  });
});

describe("scoreStructure", () => {
  it("returns null (not a fabricated score) when there are no campaigns", () => {
    expect(scoreStructure([]).score).toBeNull();
  });

  it("scores low when there are campaigns but none are enabled", () => {
    const campaigns = [{ campaign: { status: "PAUSED", advertising_channel_type: "SEARCH" } }];
    expect(scoreStructure(campaigns).score).toBeLessThan(50);
  });
});

describe("scoreWastedSpend", () => {
  it("returns null when no search term has enough clicks for evidence", () => {
    const terms = [{ metrics: { clicks: "2", cost_micros: "500000", conversions: 0 } }];
    expect(scoreWastedSpend(terms).score).toBeNull();
  });

  it("scores 100 when all evidence-eligible terms convert", () => {
    const terms = [
      { metrics: { clicks: "20", cost_micros: "5000000", conversions: 2 } },
      { metrics: { clicks: "15", cost_micros: "3000000", conversions: 1 } },
    ];
    expect(scoreWastedSpend(terms).score).toBe(100);
  });

  it("scores lower proportional to the fraction of spend wasted on zero-conversion terms", () => {
    const terms = [
      { metrics: { clicks: "20", cost_micros: "5000000", conversions: 0 } }, // wasted, 5.00
      { metrics: { clicks: "15", cost_micros: "5000000", conversions: 1 } }, // productive, 5.00
    ];
    const result = scoreWastedSpend(terms);
    expect(result.score).toBe(50); // half the evaluated spend is wasted
  });
});

describe("scoreConversionPerformance", () => {
  it("returns null with no campaign performance data", () => {
    expect(scoreConversionPerformance([]).score).toBeNull();
  });

  it("scores based on the fraction of campaigns with at least one conversion", () => {
    const rows = [
      { campaign: { id: "1", name: "A", status: "ENABLED" }, metrics: { clicks: "10", impressions: "100", cost_micros: "1000000", conversions: 1, conversions_value: 50, average_cpc: "100000", ctr: 0.1 } },
      { campaign: { id: "2", name: "B", status: "ENABLED" }, metrics: { clicks: "10", impressions: "100", cost_micros: "1000000", conversions: 0, conversions_value: 0, average_cpc: "100000", ctr: 0.1 } },
    ];
    expect(scoreConversionPerformance(rows).score).toBe(50);
  });
});

describe("scoreBudgetUtilization", () => {
  it("returns null with no active campaigns", () => {
    const campaigns = [{ campaign: { status: "PAUSED" }, campaign_budget: { amount_micros: "5000000" } }];
    expect(scoreBudgetUtilization(campaigns).score).toBeNull();
  });

  it("flags zero-amount budgets on active campaigns", () => {
    const campaigns = [
      { campaign: { status: "ENABLED" }, campaign_budget: { amount_micros: "0" } },
      { campaign: { status: "ENABLED" }, campaign_budget: { amount_micros: "5000000" } },
    ];
    const result = scoreBudgetUtilization(campaigns);
    expect(result.score).toBeLessThan(80);
    expect(result.evidence.join()).toContain("zero-amount budget");
  });
});

const row = (id: string, name: string, cost: string, conversions: number, value: number, extra: Record<string, number> = {}) => ({
  campaign: { id, name, status: "ENABLED" },
  metrics: { clicks: "100", impressions: "1000", cost_micros: cost, conversions, conversions_value: value, average_cpc: "1000000", ctr: 0.1, ...extra },
});

describe("every component exposes score/evidence/confidence/missingData/warnings", () => {
  it("has all five fields on every scorer, including the null-score paths", () => {
    const components = [
      scoreTracking([]),
      scoreStructure([]),
      scoreWastedSpend([]),
      scoreConversionPerformance([]),
      scoreBudgetUtilization([]),
    ];
    for (const c of components) {
      expect(c).toHaveProperty("score");
      expect(Array.isArray(c.evidence)).toBe(true);
      expect(typeof c.confidence).toBe("number");
      expect(Array.isArray(c.missingData)).toBe(true);
      expect(Array.isArray(c.warnings)).toBe(true);
    }
  });
});

describe("scoreStructure with ad group and keyword coverage", () => {
  const campaigns = [
    { campaign: { id: "1", status: "ENABLED", advertising_channel_type: "SEARCH" } },
    { campaign: { id: "2", status: "ENABLED", advertising_channel_type: "SEARCH" } },
  ];

  it("scores higher with full ad group + keyword coverage than with half coverage", () => {
    const full = scoreStructure(
      campaigns,
      [
        { campaign: { id: "1" }, ad_group: { id: "a", status: "ENABLED" } },
        { campaign: { id: "2" }, ad_group: { id: "b", status: "ENABLED" } },
      ],
      [{ ad_group: { id: "a" } }, { ad_group: { id: "b" } }]
    );
    const half = scoreStructure(
      campaigns,
      [{ campaign: { id: "1" }, ad_group: { id: "a", status: "ENABLED" } }],
      [{ ad_group: { id: "a" } }]
    );
    expect(full.score).toBe(100);
    expect(half.score).toBeLessThan(full.score as number);
    expect(half.warnings.join()).toContain("no enabled ad group");
  });

  it("reports missing ad group/keyword data instead of inventing coverage", () => {
    const result = scoreStructure(campaigns, null, null);
    expect(result.missingData.length).toBe(2);
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe("scoreConversionPerformance against configured targets", () => {
  it("scores 100 on CPA when CPA is at or below targetCPA, and ~50 when CPA is twice the target", () => {
    // 20 conversions at 400 cost => CPA 20
    const good = scoreConversionPerformance([row("1", "A", "400000000", 20, 0)], { targetCPA: 20, targetROAS: null });
    // 20 conversions at 800 cost => CPA 40 (2x target)
    const bad = scoreConversionPerformance([row("1", "A", "800000000", 20, 0)], { targetCPA: 20, targetROAS: null });
    expect(good.score).toBeGreaterThan(bad.score as number);
    expect(bad.evidence.join()).toContain("CPA 40.00 vs configured target 20.00");
  });

  it("compares ROAS against targetROAS", () => {
    const r = scoreConversionPerformance([row("1", "A", "100000000", 20, 200)], { targetCPA: null, targetROAS: 4 });
    // ROAS = 200/100 = 2 vs target 4
    expect(r.evidence.join()).toContain("ROAS 2.00 vs configured target 4.00");
  });

  it("without any target: records the missing targets and warns the score is not about profitability", () => {
    const r = scoreConversionPerformance([row("1", "A", "100000000", 20, 200)]);
    expect(r.missingData.join()).toContain("targetCPA");
    expect(r.missingData.join()).toContain("targetROAS");
    expect(r.warnings.join()).toContain("not whether they convert profitably");
  });

  it("lowers confidence and warns when conversion volume is too small", () => {
    const r = scoreConversionPerformance([row("1", "A", "100000000", 2, 0)], { targetCPA: 20, targetROAS: null });
    expect(r.confidence).toBeLessThanOrEqual(0.35);
    expect(r.warnings.join()).toContain("statistically weak");
  });
});

describe("scoreBudgetUtilization with search budget lost impression share", () => {
  const campaigns = [{ campaign: { id: "1", status: "ENABLED" }, campaign_budget: { amount_micros: "5000000" } }];

  it("lowers the score and names the campaign when budget-lost impression share is high", () => {
    const constrained = scoreBudgetUtilization(campaigns, [row("1", "Constrained", "1000000", 1, 0, { search_budget_lost_impression_share: 0.4 })]);
    const free = scoreBudgetUtilization(campaigns, [row("1", "Free", "1000000", 1, 0, { search_budget_lost_impression_share: 0.01 })]);
    expect(constrained.score).toBeLessThan(free.score as number);
    expect(constrained.warnings.join()).toContain("Constrained");
  });

  it("records missing lost-impression-share data rather than assuming no constraint", () => {
    const r = scoreBudgetUtilization(campaigns, [row("1", "A", "1000000", 1, 0)]);
    expect(r.missingData.join()).toContain("search_budget_lost_impression_share");
  });
});

describe("scoreTracking: unavailable vs none configured", () => {
  it("returns null (not 0) when the conversion action list could not be retrieved", () => {
    const r = scoreTracking(null);
    expect(r.score).toBeNull();
    expect(r.missingData.length).toBeGreaterThan(0);
  });
});
