import type { ClientRowWithRelations } from "../../src/database/repositories/client-repo.js";

/** A Client row as Prisma would return it (all-null defaults) with overrides applied. */
export function clientRow(overrides: Partial<ClientRowWithRelations> = {}): ClientRowWithRelations {
  return {
    id: "c1", name: "Acme", website: null, industry: null, subIndustry: null, businessType: null, businessModel: null,
    productsOrServices: [], primaryOffers: [], targetCountries: [], languages: [], currency: null, secondaryConversions: [],
    growthGoal: null, salesCycle: null, reportedSeasonality: null, brandVoice: null, trackingStatus: null, restrictions: [],
    primaryConversionGoal: null, targetCPA: null, targetROAS: null, averageOrderValue: null, grossMargin: null, profitPerSale: null,
    leadValue: null, lifetimeValue: null, leadToSaleRate: null, monthlyBudget: null, minimumClicks: null, minimumImpressions: null,
    minimumSpend: null, minimumConversions: null, minimumDays: null, budgetChangeLimitPct: null, customIntentsJson: null,
    contextJson: null, createdAt: new Date(), updatedAt: new Date(), locations: [],
    ...overrides,
  } as ClientRowWithRelations;
}
