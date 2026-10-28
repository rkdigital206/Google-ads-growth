/**
 * REAL-DATABASE integration tests (real Prisma + real PostgreSQL).
 * Skipped unless RUN_DB_TESTS=1 and DATABASE_URL points at a disposable database
 * whose schema was applied with `npx prisma db push`.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgresql://... npx vitest run tests/integration-db.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

const enabled = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("client persistence + account linking (real Postgres)", () => {
  let repo: typeof import("../src/database/repositories/client-repo.js");
  let accounts: typeof import("../src/database/repositories/account-repo.js");
  let prisma: typeof import("../src/database/repositories/prisma-client.js")["prisma"];

  beforeAll(async () => {
    repo = await import("../src/database/repositories/client-repo.js");
    accounts = await import("../src/database/repositories/account-repo.js");
    prisma = (await import("../src/database/repositories/prisma-client.js")).prisma;
  });
  beforeEach(async () => {
    await prisma.googleAdsAccount.deleteMany();
    await prisma.client.deleteMany();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const fullInput = {
    name: "Leeds Dental", website: "https://leeds-dental.example", industry: "Healthcare", subIndustry: "Dental", businessType: "HEALTHCARE" as const,
    businessModel: "Private clinic", productsOrServices: ["Teeth whitening", "Implants", "Invisalign"], primaryOffers: ["Free consult"],
    locations: [
      { city: "Leeds", region: "West Yorkshire", country: "UK", serviceRadius: "20km radius" },
      { city: "York", country: "UK" },
    ],
    targetCountries: ["UK"], languages: ["en"], currency: "GBP", primaryConversionGoal: "BOOKINGS" as const, secondaryConversions: ["phone call"],
    growthGoal: "INCREASE_LEAD_VOLUME" as const, salesCycle: "same-week", reportedSeasonality: "post-holiday", brandVoice: "warm",
    trackingStatus: "CONFIGURED_UNVERIFIED" as const, restrictions: ["no before/after claims"],
    customIntents: [{ key: "EMERGENCY", label: "Emergency", description: "urgent dental", exampleQueries: ["emergency dentist leeds"], conversionGoal: "call", signalWords: ["emergency", "urgent"] }],
    targetCPA: 40, targetROAS: 3, averageOrderValue: 300, grossMargin: 0.6, profitPerSale: 180, leadValue: 90, lifetimeValue: 1500, leadToSaleRate: 0.3,
    monthlyBudget: 4000, minimumClicks: 40, minimumImpressions: 800, minimumSpend: 30, minimumConversions: 2, minimumDays: 10, budgetChangeLimitPct: 15,
  };

  it("onboard → database → get_client_profile preserves the FULL profile (products, locations, intents, economics, thresholds)", async () => {
    const created = await repo.createClient(fullInput);
    const loaded = await repo.getClientById(created.id);
    expect(loaded).not.toBeNull();
    const p = loaded!.profile;
    expect(p.productsOrServices).toEqual(fullInput.productsOrServices);
    expect(p.primaryOffers).toEqual(["Free consult"]);
    expect(p.locations).toHaveLength(2);
    expect(p.locations).toContainEqual({ city: "Leeds", region: "West Yorkshire", country: "UK", serviceRadius: "20km radius" });
    expect(p.locations).toContainEqual({ city: "York", country: "UK" });
    expect(p.customIntents).toEqual(fullInput.customIntents);
    expect(p.trackingStatus).toBe("CONFIGURED_UNVERIFIED");
    expect(p.restrictions).toEqual(["no before/after claims"]);
    expect(p.businessModel).toBe("Private clinic");
    expect(p.growthGoal).toBe("INCREASE_LEAD_VOLUME");
    const c = loaded!.optimizationConfig;
    expect(c.leadValue).toBe(90);
    expect(c.lifetimeValue).toBe(1500);
    expect(c.minimumDays).toBe(10);
    expect(c.budgetChangeLimitPct).toBe(15);
  });

  it("update_client_profile is a PARTIAL update: untouched fields survive", async () => {
    const created = await repo.createClient(fullInput);
    await repo.updateClientFields(created.id, { currency: "USD", lifetimeValue: 2000 });
    const loaded = (await repo.getClientById(created.id))!;
    expect(loaded.profile.currency).toBe("USD");
    expect(loaded.optimizationConfig.lifetimeValue).toBe(2000);
    // everything else untouched
    expect(loaded.profile.productsOrServices).toEqual(fullInput.productsOrServices);
    expect(loaded.profile.locations).toHaveLength(2);
    expect(loaded.profile.customIntents).toHaveLength(1);
    expect(loaded.optimizationConfig.leadValue).toBe(90);
    expect(loaded.profile.website).toBe(fullInput.website);
  });

  it("can add products, replace locations and clear a list without recreating the client", async () => {
    const created = await repo.createClient({ name: "Starter Co" });
    await repo.updateClientFields(created.id, { productsOrServices: ["A", "B"], locations: [{ city: "Lahore", country: "PK" }], restrictions: ["x"] });
    let loaded = (await repo.getClientById(created.id))!;
    expect(loaded.profile.productsOrServices).toEqual(["A", "B"]);
    expect(loaded.profile.locations).toEqual([{ city: "Lahore", country: "PK" }]);

    await repo.updateClientFields(created.id, { locations: [{ city: "Dubai", country: "AE" }, { city: "Sharjah", country: "AE" }], restrictions: [] });
    loaded = (await repo.getClientById(created.id))!;
    expect(loaded.profile.locations.map((l) => l.city).sort()).toEqual(["Dubai", "Sharjah"]);
    expect(loaded.profile.restrictions).toEqual([]);
    expect(await prisma.clientLocation.count({ where: { clientId: created.id } })).toBe(2); // old row removed, no orphans
  });

  it("a minimal client has NO silently defaulted values", async () => {
    const created = await repo.createClient({ name: "Bare" });
    const loaded = (await repo.getClientById(created.id))!;
    expect(loaded.profile.productsOrServices).toEqual([]);
    expect(loaded.profile.locations).toEqual([]);
    expect(Object.values(loaded.optimizationConfig).every((v) => v === null)).toBe(true);
    expect(loaded.profile.trackingStatus).toBe("UNKNOWN");
  });

  describe("account ↔ client linking and ownership", () => {
    it("links a CLIENT account and verifies ownership; rejects mismatched client/customer pairs", async () => {
      const a = await repo.createClient({ name: "A" });
      const b = await repo.createClient({ name: "B" });
      await accounts.linkGoogleAdsAccount({ clientId: a.id, customerId: "123-456-7890", accountType: "CLIENT", descriptiveName: "A Ads" });

      expect(await accounts.verifyAccountBelongsToClient(a.id, "1234567890")).not.toBeNull();
      expect(await accounts.verifyAccountBelongsToClient(b.id, "1234567890")).toBeNull();
      await expect(accounts.assertAccountBelongsToClient(b.id, "1234567890")).rejects.toThrow(/not linked to client/);
      await expect(accounts.assertAccountBelongsToClient(a.id, "9999999999")).rejects.toThrow(/not linked to any client/);
      await expect(accounts.assertAccountBelongsToClient(a.id, "123-456-7890")).resolves.toMatchObject({ customerId: "1234567890" });
    });

    it("refuses MANAGER and UNKNOWN accounts and refuses to silently reassign a linked account", async () => {
      const a = await repo.createClient({ name: "A" });
      const b = await repo.createClient({ name: "B" });
      await expect(accounts.linkGoogleAdsAccount({ clientId: a.id, customerId: "1111111111", accountType: "MANAGER" })).rejects.toThrow(/MANAGER/);
      await expect(accounts.linkGoogleAdsAccount({ clientId: a.id, customerId: "2222222222", accountType: "UNKNOWN" })).rejects.toThrow(/UNKNOWN/);
      await accounts.linkGoogleAdsAccount({ clientId: a.id, customerId: "3333333333", accountType: "CLIENT" });
      await expect(accounts.linkGoogleAdsAccount({ clientId: b.id, customerId: "3333333333", accountType: "CLIENT" })).rejects.toThrow(/already linked to a different client/);
      expect(await prisma.googleAdsAccount.count()).toBe(1);
    });

    it("refuses to link to a client that does not exist", async () => {
      await expect(accounts.linkGoogleAdsAccount({ clientId: "nope", customerId: "4444444444", accountType: "CLIENT" })).rejects.toThrow(/No client found/);
    });
  });
});
