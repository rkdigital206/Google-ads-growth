import { describe, it, expect } from "vitest";
import { researchCompetitors } from "../src/research/engines/competitor-research.js";
import type { CompetitorResearchProvider } from "../src/research/providers/types.js";

describe("researchCompetitors", () => {
  it("returns PROVIDER_NOT_CONFIGURED when no provider is wired up", async () => {
    const result = await researchCompetitors(undefined, "used fridge dubai", "AE");
    expect(result.state).toBe("BLOCKED");
    expect(result.issues.join()).toContain("PROVIDER_NOT_CONFIGURED");
  });

  it("required scenario H: a SERP appearance is classified SERP_COMPETITOR, never auto-promoted to DIRECT_COMPETITOR", async () => {
    const provider: CompetitorResearchProvider = {
      name: "test-serp-provider",
      getSerpCompetitors: async () => [
        { domain: "some-appliance-blog.com", observedFor: "used fridge dubai", title: "10 tips for buying appliances", snippet: null },
      ],
    };
    const result = await researchCompetitors(provider, "used fridge dubai", "AE");
    expect(result.state).toBe("COMPLETE");
    expect(result.data?.[0]?.classification).toBe("SERP_COMPETITOR");
    expect(result.data?.[0]?.confidence).toBeLessThan(0.6); // MEDIUM band or below — not strong evidence
  });

  it("returns COMPETITOR_DATA_UNAVAILABLE (not fabricated results) when the provider errors", async () => {
    const failing: CompetitorResearchProvider = {
      name: "failing-provider",
      getSerpCompetitors: async () => {
        throw new Error("rate limited");
      },
    };
    const result = await researchCompetitors(failing, "query", "AE");
    expect(result.state).toBe("FAILED");
    expect(result.issues.join()).toContain("COMPETITOR_DATA_UNAVAILABLE");
  });
});
