import { describe, it, expect } from "vitest";
import { candidatesFromSearchTerms, mergeTrendSignal, addAiExpansionCandidate } from "../src/research/engines/keyword-research.js";
import type { SearchTermPerformance } from "../src/performance/models.js";
import type { CustomIntentDefinition } from "../src/domain/intent.js";

const BUY: CustomIntentDefinition = {
  key: "BUY",
  label: "Buy",
  description: "test",
  exampleQueries: [],
  conversionGoal: "test",
  signalWords: ["buy", "used"],
};

function searchTermRow(term: string, clicks: number, conversions: number): SearchTermPerformance {
  return {
    searchTerm: term,
    campaignId: "1",
    campaignName: "Test Campaign",
    adGroupId: "2",
    adGroupName: "Test Ad Group",
    metrics: {
      impressions: clicks * 10,
      clicks,
      ctr: 0.1,
      cost: clicks * 2,
      averageCpc: 2,
      conversions,
      conversionRate: clicks > 0 ? conversions / clicks : null,
      costPerConversion: conversions > 0 ? (clicks * 2) / conversions : null,
      conversionsValue: conversions * 50,
      valuePerConversion: conversions > 0 ? 50 : null,
      roas: conversions > 0 ? (conversions * 50) / (clicks * 2) : null,
      searchImpressionShare: null,
      searchBudgetLostImpressionShare: null,
      searchRankLostImpressionShare: null,
    },
  };
}

describe("candidatesFromSearchTerms", () => {
  it("marks low-click terms as INSUFFICIENT_EVIDENCE rather than guessing", () => {
    const [candidate] = candidatesFromSearchTerms([searchTermRow("used fridge dubai", 2, 0)], [BUY]);
    expect(candidate?.recommendation).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("marks a real converting search term as HIGH_PRIORITY", () => {
    const [candidate] = candidatesFromSearchTerms([searchTermRow("used fridge dubai", 40, 5)], [BUY]);
    expect(candidate?.recommendation).toBe("HIGH_PRIORITY");
    expect(candidate?.intent).toBe("BUY");
  });

  it("flags an irrelevant, unclassified term with real traffic as NEGATIVE_CANDIDATE", () => {
    const [candidate] = candidatesFromSearchTerms(
      [searchTermRow("free fridge repair manual pdf", 30, 0)],
      [BUY],
      { relevanceScoreFn: () => 0.1 }
    );
    expect(candidate?.recommendation).toBe("NEGATIVE_CANDIDATE");
  });
});

describe("mergeTrendSignal — required scenario A: trending but irrelevant -> DO NOT RECOMMEND", () => {
  it("does not upgrade a low-relevance term to a priority recommendation just because it is trending", () => {
    const [candidate] = candidatesFromSearchTerms([searchTermRow("celebrity gossip dubai", 30, 0)], [BUY], {
      relevanceScoreFn: () => 0.05,
    });
    const merged = mergeTrendSignal([candidate!], "celebrity gossip dubai", "RISING");
    expect(merged[0]?.recommendation).not.toBe("HIGH_PRIORITY");
    expect(merged[0]?.recommendation).toBe("RESEARCH_ONLY");
  });
});

describe("mergeTrendSignal — required scenario C-equivalent: rising trend + real conversion evidence -> HIGH_PRIORITY", () => {
  it("keeps/elevates to HIGH_PRIORITY when there is both a rising trend and proven Ads conversions", () => {
    const [candidate] = candidatesFromSearchTerms([searchTermRow("used fridge dubai", 40, 5)], [BUY], {
      relevanceScoreFn: () => 0.9,
    });
    const merged = mergeTrendSignal([candidate!], "used fridge dubai", "RISING");
    expect(merged[0]?.recommendation).toBe("HIGH_PRIORITY");
  });
});

describe("mergeTrendSignal — rising trend + relevance but NO proven conversions -> validation opportunity, not HIGH_PRIORITY", () => {
  it("does not treat trend + relevance + classified intent alone (no conversions yet) as sufficient for HIGH_PRIORITY", () => {
    // "used dishwasher dubai" matches BUY's signal words, so it gets a
    // known intent classification and (with high relevance) MEDIUM_PRIORITY
    // — but has zero conversions, so it must not be promoted to
    // HIGH_PRIORITY by a trend signal alone.
    const [candidate] = candidatesFromSearchTerms([searchTermRow("used dishwasher dubai", 20, 0)], [BUY], {
      relevanceScoreFn: () => 0.8,
    });
    expect(candidate?.recommendation).toBe("MEDIUM_PRIORITY");
    const merged = mergeTrendSignal([candidate!], "used dishwasher dubai", "RISING");
    expect(merged[0]?.recommendation).not.toBe("HIGH_PRIORITY");
  });
});

describe("addAiExpansionCandidate — required scenario D: AI-only keyword -> AI_GENERATED_HYPOTHESIS, low confidence", () => {
  it("produces a low-confidence candidate explicitly marked as unverified", () => {
    const candidate = addAiExpansionCandidate("hypothetical new keyword idea", "COMMERCIAL", 0.5);
    expect(candidate.source).toBe("AI_EXPANSION");
    expect(candidate.confidence).toBeLessThan(0.4);
    expect(candidate.reason).toContain("AI_GENERATED_HYPOTHESIS");
    expect(candidate.recommendation).toBe("INSUFFICIENT_EVIDENCE");
  });
});
