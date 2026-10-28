import { describe, it, expect } from "vitest";
import { scoreOpportunity } from "../src/research/opportunity-scoring.js";
import { assertResourceBelongsToCustomer, normalizeCustomerId, assertLinkable } from "../src/database/repositories/account-repo.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const base = { trendDirection: null, commercialIntent: null, businessRelevance: null, ads: null, affordableCpa: null, confidence: 0.9 } as const;

describe("opportunity scoring — a rising trend is never a profitable opportunity", () => {
  it("rising trend alone → TREND_ONLY, never VALIDATED", () => {
    const r = scoreOpportunity({ ...base, trendDirection: "RISING" });
    expect(r.classification).toBe("TREND_ONLY");
    expect(r.rationale.join(" ")).toMatch(/NOT a profitable/);
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
  it("rising + relevant + intent but no conversions → PROMISING_UNVALIDATED at most", () => {
    const r = scoreOpportunity({ ...base, trendDirection: "RISING", commercialIntent: 0.9, businessRelevance: 0.9 });
    expect(r.classification).toBe("PROMISING_UNVALIDATED");
  });
  it("real conversions + relevance + intent + affordable CPA → VALIDATED", () => {
    const r = scoreOpportunity({ ...base, commercialIntent: 0.8, businessRelevance: 0.8, ads: { clicks: 100, impressions: 1000, cost: 200, conversions: 10 }, affordableCpa: 30 });
    expect(r.classification).toBe("VALIDATED_OPPORTUNITY");
  });
  it("rising trend cannot rescue clicks with zero conversions", () => {
    const r = scoreOpportunity({ ...base, trendDirection: "RISING", commercialIntent: 0.9, businessRelevance: 0.9, ads: { clicks: 80, impressions: 900, cost: 150, conversions: 0 } });
    expect(r.classification).toBe("NOT_RECOMMENDED");
  });
  it("converting but CPA above affordable → NOT_RECOMMENDED", () => {
    const r = scoreOpportunity({ ...base, commercialIntent: 0.8, businessRelevance: 0.8, ads: { clicks: 100, impressions: 1000, cost: 1000, conversions: 5 }, affordableCpa: 20 });
    expect(r.classification).toBe("NOT_RECOMMENDED");
  });
  it("no evidence at all → INSUFFICIENT_EVIDENCE with null composite and every dimension missing", () => {
    const r = scoreOpportunity({ ...base });
    expect(r.classification).toBe("INSUFFICIENT_EVIDENCE");
    expect(r.compositeScore).toBeNull();
    expect(r.missingEvidence).toHaveLength(6);
  });
});

describe("ownership / target helpers (pure)", () => {
  it("normalizes customer ids", () => expect(normalizeCustomerId("123-456-7890")).toBe("1234567890"));
  it("resource names must belong to the customer", () => {
    expect(() => assertResourceBelongsToCustomer("1234567890", "customers/1234567890/campaigns/1")).not.toThrow();
    expect(() => assertResourceBelongsToCustomer("1234567890", "customers/999/campaigns/1")).toThrow(/does not belong/);
    expect(() => assertResourceBelongsToCustomer("1234567890", "garbage")).toThrow();
  });
  it("only CLIENT accounts are linkable", () => {
    expect(() => assertLinkable("CLIENT" as any, "1")).not.toThrow();
    expect(() => assertLinkable("MANAGER" as any, "1")).toThrow();
    expect(() => assertLinkable("UNKNOWN" as any, "1")).toThrow();
  });
});

describe("no live mutation from read-only modules (static scan)", () => {
  const root = join(__dirname, "..", "src");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const MUT = /guardedMutate|mutation-guard|createSearchCampaign|updateCampaignBudget|pauseCampaign|addNegativeKeywords|\.mutate\(|campaign-service/;
  const readOnly = [
    "mcp/tools/onboarding-tools.ts", "mcp/tools/discovery-tools.ts", "mcp/tools/growth-tools.ts", "mcp/tools/research-tools.ts",
    "mcp/tools/audit-tools.ts", "mcp/tools/reporting-tools.ts", "audit/account-audit.ts", "audit/checklist.ts", "research/orchestrator.ts",
    "research/standalone.ts", "google-ads/account-service.ts", "google-ads/reporting-service.ts",
  ];
  for (const f of readOnly) it(`${f} imports no mutation service`, () => expect(read(f)).not.toMatch(MUT));
  it("mutation functions are referenced only by campaign-tools, the guard chain and the services themselves", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const hits = walk(root).filter((f) => f.endsWith(".ts") && /(guardedMutate|createSearchCampaign|updateCampaignBudget|pauseCampaign|addNegativeKeywords)\(/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""))).map((f) => f.slice(root.length + 1));
    const allowed = ["mcp/tools/campaign-tools.ts", "google-ads/campaign-service.ts", "google-ads/keyword-service.ts", "safety/mutation-guard.ts", "safety/approval-policy.ts", "mcp/tools/approval-tools.ts"];
    for (const h of hits) expect(allowed, h).toContain(h);
  });
});
