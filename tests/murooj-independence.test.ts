import { describe, it, expect } from "vitest";
import { createBusinessProfile } from "../src/domain/business-profile.js";
import { emptyOptimizationConfig } from "../src/domain/optimization-config.js";
import { assessOnboardingCompleteness } from "../src/onboarding/engine.js";
import { calculateBusinessEconomics } from "../src/economics/economics-engine.js";
import { generateGrowthStrategyBrief } from "../src/research/strategy-brief.js";
import { runBusinessResearch } from "../src/research/orchestrator.js";
import { classifyTermAgainstIntents } from "../src/domain/intent.js";

/**
 * Required by Phase E section 22: "Create a test proving that the system
 * can operate without any Murooj-specific configuration." This test
 * constructs a completely hypothetical SaaS business — nothing about used
 * appliances, Dubai, AED, or BUY/SELL — and runs it through onboarding,
 * economics, and strategy-brief generation, using only the generic engines.
 *
 * If any of this had Murooj hardcoded into a "generic" layer, this test
 * would either fail to compile (a required Murooj-only field) or produce
 * nonsensical output (e.g. a BUY/SELL intent classification for a business
 * that never configured those intents).
 */
describe("Murooj independence", () => {
  const hypotheticalSaasBusiness = createBusinessProfile({
    clientName: "Nimbus Analytics",
    website: "https://nimbusanalytics.example.com",
    industry: "B2B SaaS — marketing analytics",
    businessType: "SAAS",
    primaryConversionGoal: "QUALIFIED_LEADS",
    currency: "USD",
    locations: [{ city: "Austin", region: "TX", country: "USA" }],
    targetCountries: ["USA", "Canada"],
    productsOrServices: ["Marketing analytics dashboard", "Attribution reporting"],
    growthGoal: "INCREASE_LEAD_VOLUME",
    // Deliberately NO customIntents — this business has no BUY/SELL-style
    // custom intent configuration at all, which is the normal/common case.
  });

  it("has no customIntents configured, and the standard intent set still works with none", () => {
    expect(hypotheticalSaasBusiness.customIntents).toEqual([]);
    const classification = classifyTermAgainstIntents("best marketing analytics tool", []);
    // With zero custom intents, every term is UNKNOWN against the custom
    // set — this is correct, not a bug: the client never defined any.
    expect(classification.intent).toBe("UNKNOWN");
  });

  it("progresses through onboarding using only SaaS-relevant questions — never asks about BUY/SELL, appliances, or Dubai", () => {
    const report = assessOnboardingCompleteness(hypotheticalSaasBusiness, emptyOptimizationConfig());
    const allQuestionText = report.nextQuestions.map((q) => q.question + q.rationale).join(" ").toLowerCase();

    expect(allQuestionText).not.toContain("murooj");
    expect(allQuestionText).not.toContain("appliance");
    expect(allQuestionText).not.toContain("dubai");
    expect(allQuestionText).not.toContain("buy");
    expect(allQuestionText).not.toContain("sell");

    // But it DOES ask SaaS-appropriate economics questions.
    expect(report.nextQuestions.some((q) => q.field === "lifetimeValue")).toBe(true);
  });

  it("calculates SaaS economics (CAC) with no ecommerce or lead-gen math applied", () => {
    const config = { ...emptyOptimizationConfig(), lifetimeValue: 5000, leadToSaleRate: 0.2 };
    const economics = calculateBusinessEconomics(hypotheticalSaasBusiness.businessType, config);

    expect(economics.maxCac?.calculable).toBe(true);
    expect(economics.maxCac?.value).toBeCloseTo(1000);
    // Ecommerce-only metrics must be null for a SaaS business.
    expect(economics.breakEvenRoas).toBeNull();
    expect(economics.targetRoas).toBeNull();
  });

  it("runs the REAL research orchestrator + strategy brief offline with no Murooj/BUY/SELL content anywhere", async () => {
    // No website (no network), no providers, no Ads account: everything unavailable must be reported as such.
    const profile = { ...hypotheticalSaasBusiness, website: null };
    const report = await runBusinessResearch({
      clientId: "client-xyz",
      profile,
      config: { ...emptyOptimizationConfig(), lifetimeValue: 5000, leadToSaleRate: 0.2 },
      providers: {},
    });
    const brief = generateGrowthStrategyBrief(profile, report);
    const fullText = JSON.stringify({ report, brief }).toLowerCase();

    expect(fullText).not.toContain("murooj");
    expect(fullText).not.toContain("appliance");
    expect(fullText).not.toContain("dubai");
    expect(fullText).not.toMatch(/\baed\b/);
    expect(fullText).not.toMatch(/\b(buy|sell)\b/);
    expect(brief.clientName).toBe("Nimbus Analytics");
    expect(brief.intentStrategy).toContain("No custom intents configured");
    expect(report.clientId).toBe("client-xyz");
    // maxCac is calculable because lifetimeValue + leadToSaleRate were explicitly supplied
    expect(report.economics.maxCac?.calculable).toBe(true);
  });
});
