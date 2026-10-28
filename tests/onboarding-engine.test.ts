import { describe, it, expect } from "vitest";
import { assessOnboardingCompleteness } from "../src/onboarding/engine.js";
import { createBusinessProfile } from "../src/domain/business-profile.js";
import { emptyOptimizationConfig } from "../src/domain/optimization-config.js";

describe("assessOnboardingCompleteness", () => {
  it("reports low completeness and lists the universal required fields for a brand-new, empty profile", () => {
    const profile = createBusinessProfile({ clientName: "" });
    const report = assessOnboardingCompleteness(profile, emptyOptimizationConfig());

    expect(report.readyForResearch).toBe(false);
    expect(report.readyForEconomicsCalculation).toBe(false);
    expect(report.missingCriticalFields).toContain("clientName");
    expect(report.missingCriticalFields).toContain("website");
    expect(report.completeness).toBeLessThan(0.5);
  });

  it("is readyForResearch once universal fields are filled, even with zero economics configured", () => {
    const profile = createBusinessProfile({
      clientName: "Test Business",
      website: "https://example.com",
      businessType: "ECOMMERCE",
      primaryConversionGoal: "ECOMMERCE_REVENUE",
      currency: "USD",
      locations: [{ city: "Austin", country: "USA" }],
    });
    const report = assessOnboardingCompleteness(profile, emptyOptimizationConfig());

    expect(report.readyForResearch).toBe(true);
    expect(report.readyForEconomicsCalculation).toBe(false); // AOV/margin still missing
    expect(report.nextQuestions.some((q) => q.field === "averageOrderValue")).toBe(true);
  });

  it("asks ecommerce-specific economics questions for an ECOMMERCE business, not lead-gen questions", () => {
    const profile = createBusinessProfile({
      clientName: "Shop",
      website: "https://shop.example.com",
      businessType: "ECOMMERCE",
      primaryConversionGoal: "ECOMMERCE_REVENUE",
      currency: "USD",
      locations: [{ city: "NYC", country: "USA" }],
    });
    const report = assessOnboardingCompleteness(profile, emptyOptimizationConfig());
    const fields = report.nextQuestions.map((q) => q.field);

    expect(fields).toContain("averageOrderValue");
    expect(fields).toContain("grossMargin");
    expect(fields).not.toContain("leadValue"); // lead-gen-specific, should not appear for ecommerce
  });

  it("asks lead-gen-specific economics questions for a LOCAL_SERVICE business, not ecommerce questions", () => {
    const profile = createBusinessProfile({
      clientName: "Plumbing Co",
      website: "https://plumbing.example.com",
      businessType: "LOCAL_SERVICE",
      primaryConversionGoal: "PHONE_CALLS",
      currency: "USD",
      locations: [{ city: "Dallas", country: "USA" }],
    });
    const report = assessOnboardingCompleteness(profile, emptyOptimizationConfig());
    const fields = report.nextQuestions.map((q) => q.field);

    expect(fields).toContain("leadValue");
    expect(fields).toContain("leadToSaleRate");
    expect(fields).not.toContain("averageOrderValue"); // ecommerce-specific, should not appear for local service
  });

  it("asks SaaS-specific economics questions for a SAAS business", () => {
    const profile = createBusinessProfile({
      clientName: "SaaS Co",
      website: "https://saas.example.com",
      businessType: "SAAS",
      primaryConversionGoal: "QUALIFIED_LEADS",
      currency: "USD",
      locations: [{ city: "SF", country: "USA" }],
    });
    const report = assessOnboardingCompleteness(profile, emptyOptimizationConfig());
    const fields = report.nextQuestions.map((q) => q.field);

    expect(fields).toContain("lifetimeValue");
    expect(fields).not.toContain("leadValue");
    expect(fields).toContain("leadToSaleRate");
  });

  it("is readyForEconomicsCalculation once all business-type-specific economics fields are filled", () => {
    const profile = createBusinessProfile({
      clientName: "Shop",
      website: "https://shop.example.com",
      businessType: "ECOMMERCE",
      primaryConversionGoal: "ECOMMERCE_REVENUE",
      currency: "USD",
      locations: [{ city: "NYC", country: "USA" }],
    });
    const config = { ...emptyOptimizationConfig(), averageOrderValue: 100, grossMargin: 0.4, targetROAS: 3 };
    const report = assessOnboardingCompleteness(profile, config);

    expect(report.readyForEconomicsCalculation).toBe(true);
    expect(report.nextQuestions.length).toBe(0);
  });
});
