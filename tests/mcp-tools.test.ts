/**
 * Tool-level tests: handlers are invoked exactly as MCP would invoke them
 * (zod-parsed args), with Prisma and every Google Ads service mocked. Nothing
 * here touches a network, a database, or a live Google Ads account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeServer } from "./helpers/fake-server.js";
import { clientRow } from "./helpers/rows.js";
import type { TrendProvider, KeywordResearchProvider, CompetitorResearchProvider } from "../src/research/providers/types.js";

const m = vi.hoisted(() => ({
  prisma: {
    client: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    googleAdsAccount: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  audit: vi.fn(),
  createSearchCampaign: vi.fn(),
  updateCampaignBudget: vi.fn(),
  pauseCampaign: vi.fn(),
  addNegativeKeywords: vi.fn(),
  guardedMutate: vi.fn(),
  getSearchTermReport: vi.fn(),
  getCampaignPerformance: vi.fn(),
  discover: vi.fn(),
  getAccountSummary: vi.fn(),
}));

vi.mock("../src/database/repositories/prisma-client.js", () => ({ prisma: m.prisma }));
vi.mock("../src/audit/account-audit.js", () => ({ auditGoogleAdsAccount: m.audit }));
vi.mock("../src/google-ads/campaign-service.js", () => ({ createSearchCampaign: m.createSearchCampaign, updateCampaignBudget: m.updateCampaignBudget, pauseCampaign: m.pauseCampaign }));
vi.mock("../src/google-ads/keyword-service.js", () => ({ addNegativeKeywords: m.addNegativeKeywords, listKeywords: vi.fn() }));
vi.mock("../src/safety/mutation-guard.js", () => ({ guardedMutate: m.guardedMutate }));
vi.mock("../src/google-ads/reporting-service.js", () => ({ getSearchTermReport: m.getSearchTermReport, getCampaignPerformance: m.getCampaignPerformance, getConversionActions: vi.fn() }));
vi.mock("../src/google-ads/account-service.js", () => ({ discoverAccessibleAccounts: m.discover, getAccountSummary: m.getAccountSummary, listCampaigns: vi.fn(), listAdGroups: vi.fn() }));

import { registerOnboardingTools } from "../src/mcp/tools/onboarding-tools.js";
import { registerGrowthTools } from "../src/mcp/tools/growth-tools.js";
import { registerResearchTools } from "../src/mcp/tools/research-tools.js";
import { registerCampaignTools } from "../src/mcp/tools/campaign-tools.js";
import { registerDiscoveryTools } from "../src/mcp/tools/discovery-tools.js";
import { registerAuditTools } from "../src/mcp/tools/audit-tools.js";
import { registerReportingTools } from "../src/mcp/tools/reporting-tools.js";
import { configureResearchProviders, resetResearchProvidersForTesting } from "../src/research/providers/registry.js";

const MUTATORS = () => [m.createSearchCampaign, m.updateCampaignBudget, m.pauseCampaign, m.addNegativeKeywords, m.guardedMutate];
const expectNoMutation = () => MUTATORS().forEach((fn) => expect(fn).not.toHaveBeenCalled());

const accountRow = (over: Record<string, unknown> = {}) => ({
  id: "acc1", clientId: "c1", customerId: "1234567890", descriptiveName: "Acme Ads", currencyCode: "USD", timeZone: "UTC",
  isManagerLinked: false, managerAccountId: null, accountType: "CLIENT", createdAt: new Date(), ...over,
});

function setup(...registrars: ((s: any) => void)[]) {
  const fake = makeFakeServer();
  registrars.forEach((r) => r(fake.server));
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetResearchProvidersForTesting();
  m.prisma.googleAdsAccount.findMany.mockResolvedValue([]);
});

describe("onboarding tools (generic, full persistence, partial update)", () => {
  it("onboard_client sends EVERY supplied field to persistence and returns products/locations in the profile", async () => {
    m.prisma.client.create.mockImplementation(async ({ data }: any) =>
      clientRow({ id: "new1", ...data, locations: (data.locations?.create ?? []).map((l: any, i: number) => ({ id: `l${i}`, clientId: "new1", ...l })) })
    );
    const { call } = setup(registerOnboardingTools);
    const r = await call("onboard_client", {
      name: "Generic Bakery", businessType: "LOCAL_SERVICE", productsOrServices: ["Sourdough", "Cakes"],
      locations: [{ city: "Lahore", country: "PK", serviceRadius: "10km" }], leadValue: 12, lifetimeValue: 400, languages: ["en", "ur"],
      restrictions: ["no discount claims"], minimumDays: 5, trackingStatus: "NOT_CONFIGURED",
    });
    expect(r.isError).toBe(false);
    const data = m.prisma.client.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ name: "Generic Bakery", productsOrServices: ["Sourdough", "Cakes"], leadValue: 12, lifetimeValue: 400, minimumDays: 5, trackingStatus: "NOT_CONFIGURED" });
    expect(r.json.profile.productsOrServices).toEqual(["Sourdough", "Cakes"]);
    expect(r.json.profile.locations).toEqual([{ city: "Lahore", country: "PK", serviceRadius: "10km" }]);
    expect(r.json.optimizationConfig.lifetimeValue).toBe(400);
    expect(r.json.optimizationConfig.leadValue).toBe(12);
    expectNoMutation();
  });

  it("update_client_profile is partial: only supplied fields reach persistence", async () => {
    m.prisma.client.findUnique.mockResolvedValue(clientRow({ id: "c1", productsOrServices: ["A"] }));
    m.prisma.client.update.mockResolvedValue(clientRow({ id: "c1", productsOrServices: ["A"], currency: "USD" }));
    const { call } = setup(registerOnboardingTools);
    const r = await call("update_client_profile", { clientId: "c1", currency: "USD" });
    expect(r.isError).toBe(false);
    expect(m.prisma.client.update.mock.calls[0]![0].data).toEqual({ currency: "USD" });
  });

  it("update_client_profile can add products, locations, intents and thresholds without recreating the client", async () => {
    m.prisma.client.findUnique.mockResolvedValue(clientRow());
    m.prisma.client.update.mockResolvedValue(clientRow());
    const { call } = setup(registerOnboardingTools);
    await call("update_client_profile", {
      clientId: "c1", productsOrServices: ["X"], locations: [{ city: "A", country: "B" }], primaryOffers: ["o"], languages: ["en"],
      restrictions: ["r"], businessModel: "m", growthGoal: "REDUCE_CAC", trackingStatus: "CONFIGURED_VERIFIED", minimumClicks: 10, budgetChangeLimitPct: 10,
      customIntents: [{ key: "K", label: "K", description: "d", conversionGoal: "g", signalWords: ["k"] }],
    });
    const data = m.prisma.client.update.mock.calls[0]![0].data;
    expect(Object.keys(data).sort()).toEqual(
      ["budgetChangeLimitPct", "businessModel", "customIntentsJson", "growthGoal", "languages", "locations", "minimumClicks", "primaryOffers", "productsOrServices", "restrictions", "trackingStatus"].sort()
    );
  });

  it("update_client_profile on an unknown client is an error and writes nothing", async () => {
    m.prisma.client.findUnique.mockResolvedValue(null);
    const { call } = setup(registerOnboardingTools);
    const r = await call("update_client_profile", { clientId: "nope", currency: "USD" });
    expect(r.isError).toBe(true);
    expect(m.prisma.client.update).not.toHaveBeenCalled();
  });
});

describe("clientId ↔ customerId ownership is enforced before any client-specific output", () => {
  beforeEach(() => m.prisma.client.findUnique.mockResolvedValue(clientRow({ id: "c1", targetCPA: 25 })));

  it("audit_google_ads_account: unlinked customer is rejected and no audit runs", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(null);
    const { call } = setup(registerGrowthTools);
    const r = await call("audit_google_ads_account", { clientId: "c1", customerId: "1234567890" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not linked to any client/);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("audit_google_ads_account: customer linked to a DIFFERENT client is rejected and no audit runs", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ clientId: "other-client" }));
    const { call } = setup(registerGrowthTools);
    const r = await call("audit_google_ads_account", { clientId: "c1", customerId: "123-456-7890" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/not linked to client c1/);
    expect(r.text).not.toContain("other-client");
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("audit_google_ads_account: matching pair runs the audit with the CLIENT's configured targets", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow());
    m.audit.mockResolvedValue({ customerId: "1234567890", overallScore: 80, components: [] });
    const { call } = setup(registerGrowthTools);
    const r = await call("audit_google_ads_account", { clientId: "c1", customerId: "123-456-7890" });
    expect(r.isError).toBe(false);
    expect(m.audit).toHaveBeenCalledWith("1234567890", expect.any(Object), { targetCPA: 25, targetROAS: null });
    expectNoMutation();
  });

  it("run_growth_research and generate_growth_strategy reject a mismatched customerId", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ clientId: "other" }));
    const { call } = setup(registerGrowthTools);
    expect((await call("run_growth_research", { clientId: "c1", customerId: "1234567890" })).isError).toBe(true);
    expect((await call("generate_growth_strategy", { clientId: "c1", customerId: "1234567890" })).isError).toBe(true);
    expect((await call("research_keywords_placeholder_guard".length ? "run_growth_research" : "run_growth_research", { clientId: "c1", customerId: "1234567890" })).isError).toBe(true);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("reporting tools require a linked pair and never query Google Ads for a mismatched account", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ clientId: "other" }));
    const { call } = setup(registerReportingTools);
    const a = await call("get_campaign_performance", { clientId: "c1", customerId: "1234567890", startDate: "2026-01-01", endDate: "2026-01-31" });
    const b = await call("analyze_search_terms", { clientId: "c1", customerId: "1234567890", startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(a.isError && b.isError).toBe(true);
    expect(m.getCampaignPerformance).not.toHaveBeenCalled();
    expect(m.getSearchTermReport).not.toHaveBeenCalled();
  });

  it("every mutation tool rejects a mismatched client/account/customer BEFORE reaching the safety chain", async () => {
    const { call } = setup(registerCampaignTools);
    const base = { clientId: "c1", customerId: "1234567890", accountId: "acc1", reasoning: "a long enough reason" };

    // account record belongs to another client
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ clientId: "other" }));
    for (const [tool, extra] of [
      ["create_search_campaign", { campaignName: "n", dailyBudget: 5, intent: "TRANSACTIONAL", biddingStrategy: "MANUAL_CPC" }],
      ["update_campaign_budget", { campaignId: "1", campaignResourceName: "customers/1234567890/campaigns/1", budgetResourceName: "customers/1234567890/campaignBudgets/1", currentDailyBudget: 5, newDailyBudget: 6 }],
      ["pause_campaign", { campaignResourceName: "customers/1234567890/campaigns/1" }],
      ["add_negative_keywords", { targetResourceName: "customers/1234567890/campaigns/1", scope: "CAMPAIGN", keywords: [{ text: "free", matchType: "EXACT" }] }],
    ] as const) {
      const r = await call(tool, { ...base, ...extra });
      expect(r.isError, tool).toBe(true);
    }
    expectNoMutation();

    // customerId disagrees with the account record
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ customerId: "9999999999" }));
    expect((await call("pause_campaign", { ...base, campaignResourceName: "customers/1234567890/campaigns/1" })).isError).toBe(true);

    // account is a MANAGER
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ accountType: "MANAGER" }));
    expect((await call("pause_campaign", { ...base, campaignResourceName: "customers/1234567890/campaigns/1" })).isError).toBe(true);
    expectNoMutation();
  });

  it("a resource name belonging to another customer is rejected even when the account record matches", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow());
    const { call } = setup(registerCampaignTools);
    const r = await call("pause_campaign", { clientId: "c1", customerId: "1234567890", accountId: "acc1", reasoning: "a long enough reason", campaignResourceName: "customers/5555555555/campaigns/9" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/does not belong to customer/);
    expectNoMutation();
  });

  it("create_search_campaign validates intent against THIS client's configured intents (no BUY/SELL hard-coding)", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow());
    m.prisma.client.findUnique.mockResolvedValue(clientRow({ id: "c1", customIntentsJson: [{ key: "EMERGENCY", label: "E", description: "d", exampleQueries: [], conversionGoal: "g", signalWords: ["urgent"] }] as any }));
    m.createSearchCampaign.mockResolvedValue({ proposed: true });
    const { call } = setup(registerCampaignTools);
    const base = { clientId: "c1", customerId: "1234567890", accountId: "acc1", campaignName: "n", dailyBudget: 5, biddingStrategy: "MANUAL_CPC", reasoning: "a long enough reason" };

    const bad = await call("create_search_campaign", { ...base, intent: "BUY" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("EMERGENCY");
    expect(m.createSearchCampaign).not.toHaveBeenCalled();

    const good = await call("create_search_campaign", { ...base, intent: "EMERGENCY" });
    expect(good.isError).toBe(false);
    expect(m.createSearchCampaign).toHaveBeenCalledTimes(1); // handed to the (unchanged) safety chain
  });
});

describe("account discovery → inspect → assign flow", () => {
  it("list_google_ads_accounts reports linked client per account and NEVER auto-links anything", async () => {
    m.discover.mockResolvedValue([
      { customerId: "1", inspection: "INSPECTED", accountType: "CLIENT", summary: {}, linkable: true, notLinkableReason: null, accessPaths: [{ via: "DIRECT" }], error: null },
      { customerId: "2", inspection: "INSPECTED", accountType: "MANAGER", summary: {}, linkable: false, notLinkableReason: "mgr", accessPaths: [{ via: "DIRECT" }], error: null },
      { customerId: "3", inspection: "INACCESSIBLE", accountType: "UNKNOWN", summary: null, linkable: false, notLinkableReason: "x", accessPaths: [{ via: "DIRECT" }], error: "denied" },
    ]);
    m.prisma.googleAdsAccount.findMany.mockResolvedValue([{ customerId: "1", clientId: "c1" }]);
    const { call } = setup(registerDiscoveryTools);
    const r = await call("list_google_ads_accounts", {});
    expect(r.json.managerCount).toBe(1);
    expect(r.json.clientCount).toBe(1);
    expect(r.json.unknownOrInaccessibleCount).toBe(1);
    expect(r.json.accounts.find((a: any) => a.customerId === "1").linkedClientId).toBe("c1");
    expect(r.json.linkableUnassignedCount).toBe(0);
    expect(m.prisma.googleAdsAccount.create).not.toHaveBeenCalled();
    expect(m.prisma.client.create).not.toHaveBeenCalled();
  });

  it("link_google_ads_account re-inspects server-side and refuses a MANAGER account", async () => {
    m.getAccountSummary.mockResolvedValue({ customerId: "900", descriptiveName: "MCC", currencyCode: "USD", timeZone: "UTC", status: "ENABLED", isManager: true });
    m.prisma.client.findUnique.mockResolvedValue({ id: "c1" });
    const { call } = setup(registerDiscoveryTools);
    const r = await call("link_google_ads_account", { clientId: "c1", customerId: "900" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/MANAGER/);
    expect(m.prisma.googleAdsAccount.create).not.toHaveBeenCalled();
  });

  it("link_google_ads_account refuses an account it cannot inspect (UNKNOWN type)", async () => {
    m.getAccountSummary.mockRejectedValue(new Error("denied"));
    const { call } = setup(registerDiscoveryTools);
    const r = await call("link_google_ads_account", { clientId: "c1", customerId: "900" });
    expect(r.isError).toBe(true);
    expect(m.prisma.googleAdsAccount.create).not.toHaveBeenCalled();
  });

  it("link_google_ads_account stores an inspected CLIENT account for the named client", async () => {
    m.getAccountSummary.mockResolvedValue({ customerId: "100", descriptiveName: "Shop", currencyCode: "EUR", timeZone: "Europe/Berlin", status: "ENABLED", isManager: false });
    m.prisma.client.findUnique.mockResolvedValue({ id: "c1" });
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(null);
    m.prisma.googleAdsAccount.create.mockImplementation(async ({ data }: any) => ({ id: "new", ...data }));
    const { call } = setup(registerDiscoveryTools);
    const r = await call("link_google_ads_account", { clientId: "c1", customerId: "100" });
    expect(r.isError).toBe(false);
    expect(m.prisma.googleAdsAccount.create.mock.calls[0]![0].data).toMatchObject({ clientId: "c1", customerId: "100", accountType: "CLIENT", currencyCode: "EUR" });
  });
});

describe("ResearchProviderRegistry injection + standalone research tools", () => {
  const rising = Array.from({ length: 8 }, (_, i) => ({ date: `2026-0${i + 1}-01`, interest: 10 + i * 10 }));
  const stubTrend: TrendProvider = {
    name: "stub-trend-provider",
    getInterestOverTime: async () => rising,
    getInterestByRegion: async () => [{ region: "R1", interest: 70 }],
    getRelatedQueries: async () => [{ query: "related q", kind: "RISING", value: 5 }],
    getRelatedTopics: async () => ["related topic"],
  };
  const stubKeywords: KeywordResearchProvider = { name: "stub-kw", getKeywordIdeas: async () => [{ keyword: "wood chairs", searchVolume: 1200, competition: "LOW" }] };
  const stubCompetitors: CompetitorResearchProvider = { name: "stub-serp", getSerpCompetitors: async (q) => [{ domain: "rival.example", observedFor: q, title: "Rival", snippet: "we sell chairs" }] };

  beforeEach(() =>
    m.prisma.client.findUnique.mockResolvedValue(
      clientRow({ id: "c1", name: "Chair Co", productsOrServices: ["wood chairs"], targetCountries: ["DE"], languages: ["de"], businessType: "ECOMMERCE" })
    )
  );

  it("research_trends with NO provider configured returns PROVIDER_NOT_CONFIGURED and no trend numbers", async () => {
    const { call } = setup(registerResearchTools);
    const r = await call("research_trends", { clientId: "c1" });
    expect(r.isError).toBe(false);
    expect(r.json.results).toHaveLength(1);
    const res = r.json.results[0].result;
    expect(res.state).toBe("BLOCKED");
    expect(res.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(res.data).toBeNull();
    expect(r.text).not.toMatch(/"interest"/);
  });

  it("an injected TrendProvider is resolved from the registry (no tool changes needed) and exposes all four provider methods", async () => {
    configureResearchProviders({ trend: stubTrend });
    const { call } = setup(registerResearchTools);
    const r = await call("research_trends", { clientId: "c1" });
    const res = r.json.results[0].result;
    expect(res.state).toBe("COMPLETE");
    expect(res.data.source).toBe("stub-trend-provider");
    expect(res.data.direction).toBe("RISING");
    expect(res.data.relatedQueries).toEqual(["related q"]);
    expect(res.data.relatedTopics).toEqual(["related topic"]);
    expect(res.data.geographicInterest).toEqual([{ region: "R1", interest: 70 }]);
  });

  it("run_growth_research uses the registry too, and labels a rising trend as an INFERENCE that is explicitly not profit", async () => {
    configureResearchProviders({ trend: stubTrend });
    const { call } = setup(registerGrowthTools);
    const r = await call("run_growth_research", { clientId: "c1" });
    expect(r.isError).toBe(false);
    expect(r.json.missingProviders).toEqual(expect.arrayContaining(["keywordResearch", "competitorResearch", "marketResearch"]));
    expect(r.json.missingProviders).not.toContain("trend");
    const dir = r.json.signals.find((s: any) => s.id === "trend-direction-0");
    expect(dir.epistemicStatus).toBe("INFERENCE");
    expect(dir.statement).toMatch(/not evidence of profitable/);
    expect(dir.source).toBe("stub-trend-provider");
    expect(dir.retrievedAt).toBeTruthy();
    expectNoMutation();
  });

  it("run_growth_research with an empty registry marks trend/competitor/keyword areas UNKNOWN, with no retrievedAt/confidence invented", async () => {
    const { call } = setup(registerGrowthTools);
    const r = await call("run_growth_research", { clientId: "c1" });
    const unknowns = r.json.signals.filter((s: any) => s.epistemicStatus === "UNKNOWN");
    expect(unknowns.length).toBeGreaterThan(0);
    for (const u of unknowns) {
      expect(u.retrievedAt).toBeNull();
      expect(u.confidence).toBeNull();
    }
    for (const s of r.json.signals.filter((s: any) => s.epistemicStatus !== "UNKNOWN")) {
      expect(typeof s.source).toBe("string");
      expect(s.retrievedAt).toBeTruthy();
      expect(typeof s.confidence).toBe("number");
      expect(Array.isArray(s.evidence)).toBe(true);
    }
    expect(r.json.trendSignals[0].code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("research_keywords: provider ideas carry provider-reported volume, are HYPOTHESES, and never exceed unvalidated status", async () => {
    configureResearchProviders({ keywordResearch: stubKeywords });
    const { call } = setup(registerResearchTools);
    const r = await call("research_keywords", { clientId: "c1" });
    expect(r.json.sources.keywordProvider).toBe("USED");
    const c = r.json.candidates[0];
    expect(c.keyword).toBe("wood chairs");
    expect(c.providerSearchVolume).toBe(1200);
    expect(c.recommendation).not.toBe("HIGH_PRIORITY");
    expect(c.opportunity.classification).not.toBe("VALIDATED_OPPORTUNITY");
  });

  it("research_keywords without a keyword provider reports PROVIDER_NOT_CONFIGURED and fabricates no volume", async () => {
    const { call } = setup(registerResearchTools);
    const r = await call("research_keywords", { clientId: "c1" });
    expect(r.json.state).toBe("BLOCKED");
    expect(r.json.candidates).toEqual([]);
    expect(r.json.issues.join()).toContain("PROVIDER_NOT_CONFIGURED");
  });

  it("research_keywords with a customerId from another client is rejected before any Ads query", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow({ clientId: "other" }));
    const { call } = setup(registerResearchTools);
    const r = await call("research_keywords", { clientId: "c1", customerId: "1234567890" });
    expect(r.isError).toBe(true);
    expect(m.getSearchTermReport).not.toHaveBeenCalled();
  });

  it("research_keywords uses REAL search-term rows of a linked account, and converting terms outrank provider ideas", async () => {
    m.prisma.googleAdsAccount.findUnique.mockResolvedValue(accountRow());
    m.getSearchTermReport.mockResolvedValue([
      { search_term_view: { search_term: "wood chairs berlin" }, campaign: { id: "1", name: "c" }, ad_group: { id: "1", name: "a" }, metrics: { clicks: "60", impressions: "900", cost_micros: "120000000", conversions: 6 } },
    ]);
    configureResearchProviders({ keywordResearch: stubKeywords });
    const { call } = setup(registerResearchTools);
    const r = await call("research_keywords", { clientId: "c1", customerId: "1234567890" });
    const real = r.json.candidates.find((c: any) => c.keyword === "wood chairs berlin");
    const idea = r.json.candidates.find((c: any) => c.keyword === "wood chairs");
    expect(real.source).toBe("GOOGLE_ADS_SEARCH_TERMS");
    expect(real.recommendation).toBe("HIGH_PRIORITY");
    expect(idea.source).toBe("KEYWORD_RESEARCH_PROVIDER");
    expect(real.confidence).toBeGreaterThan(idea.confidence);
  });

  it("research_competitors: not configured → explicit state; configured → SERP_COMPETITOR (never DIRECT from SERP alone)", async () => {
    const { call } = setup(registerResearchTools);
    const none = await call("research_competitors", { clientId: "c1" });
    expect(none.json.result.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(none.json.result.data).toBeNull();

    configureResearchProviders({ competitorResearch: stubCompetitors });
    const some = await call("research_competitors", { clientId: "c1" });
    expect(some.json.query).toBe("wood chairs");
    expect(some.json.result.data[0].classification).toBe("SERP_COMPETITOR");
  });

  it("analyze_website with no stored website and no url is NOT_STARTED (no fetch, no invented content)", async () => {
    const { call } = setup(registerResearchTools);
    const r = await call("analyze_website", { clientId: "c1" });
    expect(r.json.result.state).toBe("NOT_STARTED");
    expect(r.json.result.data).toBeNull();
  });

  it("standalone research tools reject an unknown client", async () => {
    m.prisma.client.findUnique.mockResolvedValue(null);
    const { call } = setup(registerResearchTools);
    for (const t of ["analyze_website", "research_trends", "research_keywords", "research_competitors"]) {
      expect((await call(t, { clientId: "nope" })).isError, t).toBe(true);
    }
  });
});

describe("get_audit_checklist is generic (built from stored client data)", () => {
  it("contains no pilot/Murooj assumptions for a generic client, and reflects that client's own gaps", async () => {
    m.prisma.client.findUnique.mockResolvedValue(
      clientRow({ id: "c1", name: "Nimbus Analytics", businessType: "SAAS", website: "https://nimbus.example", currency: "USD" })
    );
    m.prisma.googleAdsAccount.findMany.mockResolvedValue([accountRow({ clientId: "c1", currencyCode: "USD" })]);
    const { call } = setup(registerAuditTools);
    const r = await call("get_audit_checklist", { clientId: "c1" });
    expect(r.isError).toBe(false);
    const text = r.text.toLowerCase();
    for (const banned of ["murooj", "appliance", "dubai", "pilot", "buy/sell", "whatsapp", "\"buy\"", "\"sell\""]) expect(text).not.toContain(banned);
    expect(text).toContain("nimbus analytics");
    expect(text).toContain("lifetimevalue"); // SaaS economics gap surfaced from THIS client's config
    expect(r.json.linkedAccounts).toBe(1);
    expect(r.json.checklist.some((i: any) => i.id === "define-primary-goal" && i.blocking)).toBe(true);
  });

  it("with no linked account the first blocking item says to link one", async () => {
    m.prisma.client.findUnique.mockResolvedValue(clientRow({ id: "c1" }));
    const { call } = setup(registerAuditTools);
    const r = await call("get_audit_checklist", { clientId: "c1" });
    expect(r.json.checklist[0].id).toBe("link-account");
  });

  it("legacy pilot-only tools are no longer registered", () => {
    const { tools } = setup(registerAuditTools, registerReportingTools, registerGrowthTools, registerResearchTools, registerCampaignTools, registerDiscoveryTools, registerOnboardingTools);
    for (const gone of ["run_account_audit", "get_campaign_structure_recommendation"]) expect(tools.has(gone)).toBe(false);
    for (const present of ["get_audit_checklist", "analyze_website", "research_trends", "research_keywords", "research_competitors", "link_google_ads_account", "get_linked_accounts", "update_client_profile"]) expect(tools.has(present)).toBe(true);
  });
});
