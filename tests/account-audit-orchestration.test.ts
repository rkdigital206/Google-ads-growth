import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/google-ads/account-service.js", () => ({
  getAccountSummary: vi.fn(),
  listCampaigns: vi.fn(),
  listAdGroups: vi.fn(),
}));
vi.mock("../src/google-ads/reporting-service.js", () => ({
  getConversionActions: vi.fn(),
  getCampaignPerformance: vi.fn(),
  getSearchTermReport: vi.fn(),
}));
vi.mock("../src/google-ads/keyword-service.js", () => ({ listKeywords: vi.fn() }));

import * as accountService from "../src/google-ads/account-service.js";
import * as reporting from "../src/google-ads/reporting-service.js";
import * as keywordService from "../src/google-ads/keyword-service.js";
import { auditGoogleAdsAccount } from "../src/audit/account-audit.js";

const range = { startDate: "2026-01-01", endDate: "2026-01-31" };

describe("auditGoogleAdsAccount — graceful degradation (read-only, deterministic)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("still returns an audit when every data source fails: no fabricated score, missing data listed", async () => {
    const boom = new Error("API unavailable");
    vi.mocked(accountService.getAccountSummary).mockRejectedValue(boom);
    vi.mocked(accountService.listCampaigns).mockRejectedValue(boom);
    vi.mocked(accountService.listAdGroups).mockRejectedValue(boom);
    vi.mocked(reporting.getConversionActions).mockRejectedValue(boom);
    vi.mocked(reporting.getCampaignPerformance).mockRejectedValue(boom);
    vi.mocked(reporting.getSearchTermReport).mockRejectedValue(boom);
    vi.mocked(keywordService.listKeywords).mockRejectedValue(boom);

    const audit = await auditGoogleAdsAccount("1234567890", range);

    expect(audit.account).toBeNull();
    // Unavailable data must NEVER be scored as if it were "none configured".
    const byDim = Object.fromEntries(audit.components.map((c) => [c.dimension, c]));
    expect(byDim.tracking?.score).toBeNull();
    expect(audit.overallScore).toBeNull();
    expect(byDim.structure?.score).toBeNull();
    expect(byDim.wastedSpend?.score).toBeNull();
    expect(byDim.conversionPerformance?.score).toBeNull();
    expect(byDim.budgetUtilization?.score).toBeNull();
    expect(audit.missingData.length).toBeGreaterThanOrEqual(7);
    expect(audit.dataSufficiency.sufficientForConclusions).toBe(false);
    expect(audit.accountMetrics).toBeNull();
    expect(audit.accountStats.adGroupCount).toBeNull();
    expect(audit.accountStats.keywordCount).toBeNull();
  });

  it("scores from partial data: excludes unavailable dimensions from the overall score instead of defaulting them", async () => {
    vi.mocked(accountService.getAccountSummary).mockRejectedValue(new Error("no meta"));
    vi.mocked(accountService.listCampaigns).mockResolvedValue([
      { campaign: { id: "1", name: "C", status: "ENABLED", advertising_channel_type: "SEARCH" }, campaign_budget: { amount_micros: "5000000" } },
    ]);
    vi.mocked(accountService.listAdGroups).mockRejectedValue(new Error("x"));
    vi.mocked(reporting.getConversionActions).mockResolvedValue([{ conversion_action: { id: "1", name: "Lead", status: "ENABLED", type: "WEBPAGE", category: "LEAD", counting_type: "ONE_PER_CLICK" } }]);
    vi.mocked(reporting.getCampaignPerformance).mockRejectedValue(new Error("x"));
    vi.mocked(reporting.getSearchTermReport).mockResolvedValue([]);
    vi.mocked(keywordService.listKeywords).mockRejectedValue(new Error("x"));

    const audit = await auditGoogleAdsAccount("1234567890", range);

    const scored = audit.components.filter((c) => c.score !== null).map((c) => c.dimension);
    expect(scored).toContain("tracking");
    expect(scored).not.toContain("conversionPerformance");
    expect(audit.overallScore).not.toBeNull();
    expect(audit.recommendedActions.join()).toContain("Re-run this audit");
  });

  it("is read-only: only query functions are used (no mutation service is even imported by the audit)", async () => {
    const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/audit/account-audit.ts", import.meta.url), "utf8"));
    expect(src).not.toMatch(/guardedMutate|mutate|\.create\(|\.update\(|\.remove\(/);
  });
});
