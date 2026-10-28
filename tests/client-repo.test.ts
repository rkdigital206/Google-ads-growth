import { describe, it, expect } from "vitest";
import {
  buildClientCreateData,
  buildClientUpdateData,
  toBusinessProfile,
  toOptimizationConfig,
  type ClientRowWithRelations,
} from "../src/database/repositories/client-repo.js";
import { assessOnboardingCompleteness } from "../src/onboarding/engine.js";
import { clientRow } from "./helpers/rows.js";
import { MUROOJ_PROFILE } from "../src/domain/client-fixtures/murooj.fixture.js";

const row = clientRow;

describe("buildClientCreateData (pure)", () => {
  it("sets only supplied fields — nothing is defaulted or guessed", () => {
    const data = buildClientCreateData({ name: "Bare Co" }) as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["name"]);
  });

  it("carries every supported onboarding field", () => {
    const data = buildClientCreateData({
      name: "Full Co", website: "https://full.example", industry: "Software", subIndustry: "Analytics", businessType: "SAAS",
      businessModel: "Subscription", productsOrServices: ["Dashboards", "API"], primaryOffers: ["14-day trial"],
      locations: [{ city: "Berlin", country: "DE", region: "BE", serviceRadius: "citywide" }], targetCountries: ["DE"], languages: ["de", "en"],
      currency: "EUR", primaryConversionGoal: "QUALIFIED_LEADS", secondaryConversions: ["newsletter"], growthGoal: "INCREASE_LEAD_QUALITY",
      salesCycle: "4-6 weeks", reportedSeasonality: "Q4 budget cycles", brandVoice: "plain", trackingStatus: "PARTIALLY_CONFIGURED",
      restrictions: ["no competitor brand terms"],
      customIntents: [{ key: "TRIAL", label: "Trial", description: "d", exampleQueries: [], conversionGoal: "signup", signalWords: ["free trial"] }],
      targetCPA: 50, targetROAS: 4, averageOrderValue: 100, grossMargin: 0.8, profitPerSale: 80, leadValue: 30, lifetimeValue: 2400,
      leadToSaleRate: 0.1, monthlyBudget: 5000, minimumClicks: 50, minimumImpressions: 1000, minimumSpend: 25, minimumConversions: 2,
      minimumDays: 14, budgetChangeLimitPct: 15,
    }) as Record<string, unknown>;
    expect(data.lifetimeValue).toBe(2400);
    expect(data.leadValue).toBe(30);
    expect(data.productsOrServices).toEqual(["Dashboards", "API"]);
    expect(data.locations).toEqual({ create: [{ city: "Berlin", region: "BE", country: "DE", serviceRadius: "citywide" }] });
    expect((data.customIntentsJson as unknown[]).length).toBe(1);
  });
});

describe("buildClientUpdateData (pure) — partial semantics", () => {
  it("includes ONLY the supplied keys", () => {
    expect(buildClientUpdateData({ currency: "USD" })).toEqual({ currency: "USD" });
    expect(buildClientUpdateData({})).toEqual({});
  });

  it("replaces list fields with set, replaces locations wholesale, and allows clearing with []", () => {
    const data = buildClientUpdateData({ productsOrServices: [], locations: [{ city: "A", country: "B" }] }) as Record<string, unknown>;
    expect(data.productsOrServices).toEqual({ set: [] });
    expect(data.locations).toEqual({ deleteMany: {}, create: [{ city: "A", region: null, country: "B", serviceRadius: null }] });
    expect("website" in data).toBe(false);
  });
});

describe("row → domain mapping (DB mapping round trip)", () => {
  it("maps products/services and locations from a DB row instead of returning empty arrays", () => {
    const profile = toBusinessProfile(
      row({
        productsOrServices: ["Teeth whitening", "Implants"], primaryOffers: ["Free consult"], languages: ["en"],
        locations: [
          { id: "l1", clientId: "c1", city: "Leeds", region: "West Yorkshire", country: "UK", serviceRadius: "20km" },
          { id: "l2", clientId: "c1", city: "York", region: null, country: "UK", serviceRadius: null },
        ],
      })
    );
    expect(profile.productsOrServices).toEqual(["Teeth whitening", "Implants"]);
    expect(profile.locations).toEqual([
      { city: "Leeds", region: "West Yorkshire", country: "UK", serviceRadius: "20km" },
      { city: "York", country: "UK" },
    ]);
  });

  it("maps lifetimeValue and leadValue separately", () => {
    const cfg = toOptimizationConfig(row({ leadValue: 20, lifetimeValue: 900 }));
    expect(cfg.leadValue).toBe(20);
    expect(cfg.lifetimeValue).toBe(900);
  });

  it("a persisted location satisfies the onboarding 'locations' requirement", () => {
    const empty = assessOnboardingCompleteness(toBusinessProfile(row({ website: "https://x.example", businessType: "LOCAL_SERVICE", primaryConversionGoal: "LEAD_GENERATION", currency: "USD" })), toOptimizationConfig(row()));
    expect(empty.missingCriticalFields).toContain("locations");
    const withLoc = assessOnboardingCompleteness(
      toBusinessProfile(row({ website: "https://x.example", businessType: "LOCAL_SERVICE", primaryConversionGoal: "LEAD_GENERATION", currency: "USD", locations: [{ id: "l", clientId: "c1", city: "Leeds", region: null, country: "UK", serviceRadius: null }] })),
      toOptimizationConfig(row())
    );
    expect(withLoc.missingCriticalFields).not.toContain("locations");
  });
});

describe("Murooj fixture does not affect generic onboarding", () => {
  it("a bare generic client has no Murooj data in its profile, intents or onboarding questions", () => {
    const profile = toBusinessProfile(row({ name: "Generic Bakery" }));
    const dump = JSON.stringify([profile, assessOnboardingCompleteness(profile, toOptimizationConfig(row()))]).toLowerCase();
    expect(profile.customIntents).toEqual([]);
    expect(profile.productsOrServices).toEqual([]);
    for (const needle of ["murooj", "appliance", "dubai", "aed"]) expect(dump).not.toContain(needle);
    // and the fixture itself is untouched / still exists as data
    expect(MUROOJ_PROFILE.clientName.toLowerCase()).toContain("murooj");
  });
});
