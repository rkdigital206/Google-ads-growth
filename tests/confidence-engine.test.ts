import { describe, it, expect } from "vitest";
import { computeConfidence, confidenceBand } from "../src/research/engines/confidence.js";

describe("computeConfidence", () => {
  it("scores an actual converting Google Ads search term higher than an AI-expanded keyword with identical relevance", () => {
    const adsEvidence = computeConfidence({
      source: "GOOGLE_ADS_SEARCH_TERMS",
      sampleSize: 50,
      ageInDays: 3,
      corroboratingSources: 1,
      businessRelevance: 0.8,
    });
    const aiEvidence = computeConfidence({
      source: "AI_EXPANSION",
      sampleSize: null,
      ageInDays: null,
      corroboratingSources: 1,
      businessRelevance: 0.8,
    });
    expect(adsEvidence).toBeGreaterThan(aiEvidence);
  });

  it("rewards larger sample sizes with diminishing returns", () => {
    const small = computeConfidence({ source: "GOOGLE_TRENDS", sampleSize: 5, ageInDays: 10, corroboratingSources: 1, businessRelevance: 0.5 });
    const large = computeConfidence({ source: "GOOGLE_TRENDS", sampleSize: 200, ageInDays: 10, corroboratingSources: 1, businessRelevance: 0.5 });
    expect(large).toBeGreaterThan(small);
  });

  it("rewards cross-source corroboration", () => {
    const single = computeConfidence({ source: "MARKET_RESEARCH", sampleSize: 10, ageInDays: 5, corroboratingSources: 1, businessRelevance: 0.5 });
    const corroborated = computeConfidence({ source: "MARKET_RESEARCH", sampleSize: 10, ageInDays: 5, corroboratingSources: 3, businessRelevance: 0.5 });
    expect(corroborated).toBeGreaterThan(single);
  });

  it("stays within [0, 1]", () => {
    const max = computeConfidence({ source: "GOOGLE_ADS_SEARCH_TERMS", sampleSize: 100000, ageInDays: 0, corroboratingSources: 10, businessRelevance: 1 });
    const min = computeConfidence({ source: "AI_EXPANSION", sampleSize: 0, ageInDays: 1000, corroboratingSources: 0, businessRelevance: 0 });
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(0);
  });

  it("maps scores to confidence bands correctly", () => {
    expect(confidenceBand(0.1)).toBe("VERY_LOW");
    expect(confidenceBand(0.3)).toBe("LOW");
    expect(confidenceBand(0.5)).toBe("MEDIUM");
    expect(confidenceBand(0.7)).toBe("HIGH");
    expect(confidenceBand(0.9)).toBe("VERY_HIGH");
  });
});
