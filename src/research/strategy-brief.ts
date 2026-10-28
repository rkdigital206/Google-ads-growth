/**
 * Growth Strategy Brief generator (Phase E section 16).
 *
 * Pure function: GrowthResearchReport + BusinessProfile -> GrowthStrategyBrief.
 * No I/O, no Google Ads calls, no mutation — this only reorganizes
 * evidence that runBusinessResearch already collected into an actionable
 * plan. Per section 17, actually creating campaigns from this brief is a
 * distinct, approval-gated future step (Phase F), not something this
 * function does or implies it can do.
 */

import type { BusinessProfile } from "../domain/business-profile.js";
import type { GrowthResearchReport } from "./orchestrator.js";

export interface GrowthStrategyBrief {
  clientName: string;
  generatedAt: string;
  businessObjective: string;
  marketingObjective: string;
  targetAudience: string;
  markets: string[];
  intentStrategy: string;
  campaignOpportunities: string[];
  /** Themes backed by real conversion evidence only (VALIDATED_OPPORTUNITY). A rising trend never lands here on its own. */
  keywordThemes: string[];
  /** Unvalidated ideas (relevant but unproven, or trend-only). Test small; do not scale on this evidence. */
  hypothesesToValidate: string[];
  /** Things the research could not determine (provider not configured, missing economics, ...). */
  unknowns: string[];
  negativeKeywordThemes: string[];
  landingPageRequirements: string[];
  budgetRecommendation: string;
  biddingRecommendation: string;
  conversionStrategy: string;
  measurementRequirements: string[];
  testingPlan: string[];
  expectedKpis: string[];
  assumptions: string[];
  risks: string[];
  confidence: number;
}

export function generateGrowthStrategyBrief(profile: BusinessProfile, report: GrowthResearchReport): GrowthStrategyBrief {
  const assumptions: string[] = [];
  const risks: string[] = [...report.risks];

  const businessObjective = profile.growthGoal
    ? `Business growth goal: ${profile.growthGoal.replace(/_/g, " ").toLowerCase()}.`
    : "No growth goal configured — this is an assumption gap; ask the client before committing budget.";
  if (!profile.growthGoal) assumptions.push("No explicit growth goal was configured; strategy below is generic until this is confirmed.");

  const marketingObjective = profile.primaryConversionGoal
    ? `Optimize for: ${profile.primaryConversionGoal.replace(/_/g, " ").toLowerCase()}.`
    : "No primary conversion goal configured — cannot recommend a bidding strategy responsibly until this is set.";

  const targetAudience = profile.productsOrServices.length > 0
    ? `Customers seeking: ${profile.productsOrServices.join(", ")}.`
    : "Target audience undefined — no products/services configured on the business profile.";

  const markets = profile.targetCountries.length > 0 ? profile.targetCountries : profile.locations.map((l) => l.country);

  const classOf = (k: GrowthResearchReport["keywordOpportunities"][number]) => k.opportunity?.classification ?? null;
  // Legacy candidates without an assessment fall back to the engine's own conservative HIGH_PRIORITY (which already requires real conversions).
  const validatedKeywords = report.keywordOpportunities.filter((k) => (classOf(k) ?? (k.recommendation === "HIGH_PRIORITY" ? "VALIDATED_OPPORTUNITY" : null)) === "VALIDATED_OPPORTUNITY");
  const hypothesisKeywords = report.keywordOpportunities.filter((k) => classOf(k) === "PROMISING_UNVALIDATED" || classOf(k) === "TREND_ONLY");
  const highConfidenceKeywords = validatedKeywords;
  const negativeKeywords = report.keywordOpportunities.filter((k) => k.recommendation === "NEGATIVE_CANDIDATE");

  const keywordThemes = highConfidenceKeywords.length > 0
    ? [...new Set(highConfidenceKeywords.map((k) => k.intent))].map((intent) => `${intent} intent: ${highConfidenceKeywords.filter((k) => k.intent === intent).length} validated candidate(s) with real conversion evidence`)
    : [];
  if (keywordThemes.length === 0) {
    assumptions.push("No conversion-validated keyword candidates were available at brief generation time — connect a Google Ads account with search-term history and/or a keyword research provider before finalizing campaign themes.");
  }

  const hypothesesToValidate = hypothesisKeywords.slice(0, 20).map(
    (k) => `"${k.keyword}" — ${classOf(k)}: ${k.opportunity?.rationale[0] ?? k.reason}`
  );
  const unknowns = report.signals.filter((sig) => sig.epistemicStatus === "UNKNOWN").map((sig) => sig.statement);

  const negativeKeywordThemes = negativeKeywords.length > 0
    ? [`${negativeKeywords.length} negative-keyword candidate(s) identified from search-term evidence — see report.keywordOpportunities for the full list with reasons.`]
    : [];

  const landingPageRequirements: string[] = [];
  if (report.websiteIntelligence.state === "COMPLETE" && report.websiteIntelligence.data) {
    if (report.websiteIntelligence.data.mixedIntentSignals.length > 0) {
      landingPageRequirements.push(
        "Website shows mixed-intent signals on the same page — dedicated, intent-specific landing pages are needed before running intent-specific ad campaigns, or traffic and messaging will mismatch."
      );
      risks.push("Mixed-intent landing page detected — running separated campaigns against a single mixed-message page will underperform regardless of keyword/bid quality.");
    }
    const missingConversionPath = report.websiteIntelligence.data.claims.some((c) => c.claim.includes("No phone number, WhatsApp"));
    if (missingConversionPath) {
      landingPageRequirements.push("No clear conversion path (phone/WhatsApp/form) was detected on the homepage — verify manually and fix before sending paid traffic.");
    }
  } else {
    landingPageRequirements.push("Website intelligence was incomplete — landing page requirements cannot be fully assessed; verify manually before launch.");
  }

  const budgetRecommendation = profile.currency
    ? `Monthly budget should be set against ${profile.currency}-denominated targets once economics are confirmed (see report.economics) — this brief does not propose a specific number without a client-configured monthlyBudget or a validated target CPA/ROAS.`
    : "Currency not confirmed — budget recommendation withheld until currency is set and cross-checked against the Google Ads account's actual currency.";

  const economicsCalculable = [report.economics.targetRoas, report.economics.targetCpa, report.economics.maxCac].some((r) => r?.calculable);
  const biddingRecommendation = economicsCalculable
    ? "Bid toward the calculated target (see report.economics) once initial conversion volume validates the account can hit it — do not set a Target CPA/ROAS bid strategy from day one with zero conversion history; start with manual/maximize-clicks and graduate once there's enough conversion data (see domain/optimization-config.ts's sample-size thresholds)."
    : "Cannot recommend a specific bidding strategy without calculable economics — see report.economics for exactly which inputs are missing.";

  const conversionStrategy = report.accountAudit
    ? report.accountAudit.components.find((c) => c.dimension === "tracking")?.score !== null && (report.accountAudit.components.find((c) => c.dimension === "tracking")?.score ?? 0) < 70
      ? "Conversion tracking needs attention before scaling spend — see accountAudit.components (tracking dimension) for specifics."
      : "Conversion tracking appears reasonably healthy based on the account audit — safe to proceed with performance-based optimization."
    : "No Google Ads account connected — conversion strategy cannot be assessed against real tracking data yet.";

  const measurementRequirements = [
    "Confirm every conversion action's counting_type and status before trusting any CPA/ROAS number.",
    "Re-run the account audit after any tracking fix to confirm the fix actually worked, not just that it was applied.",
  ];

  const testingPlan = keywordThemes.length > 0
    ? ["Start with the conversion-validated keyword themes identified above.", "Treat hypothesesToValidate (including anything that is only trending) as small, capped tests — a rising trend is a demand signal, not proof of profit."]
    : ["No evidence-backed keyword themes yet — first step is running keyword/search-term research, not launching campaigns."];

  const expectedKpis = report.economics.targetCpa?.calculable
    ? [`Target CPA: ${report.economics.targetCpa.value?.toFixed(2)} (${report.economics.targetCpa.formula})`]
    : report.economics.targetRoas?.calculable
      ? [`Target ROAS: ${report.economics.targetRoas.value?.toFixed(2)}x (${report.economics.targetRoas.formula})`]
      : ["No KPI target calculable yet — see report.economics for missing inputs."];

  const confidenceInputs = [
    report.websiteIntelligence.state === "COMPLETE" ? 0.7 : 0.2,
    report.accountAudit?.confidence ?? 0.2,
    report.keywordOpportunities.length > 0 ? Math.max(...report.keywordOpportunities.map((k) => k.confidence), 0) : 0.2,
  ];
  const confidence = confidenceInputs.reduce((a, b) => a + b, 0) / confidenceInputs.length;

  return {
    clientName: profile.clientName,
    generatedAt: new Date().toISOString(),
    businessObjective,
    marketingObjective,
    targetAudience,
    markets,
    intentStrategy: profile.customIntents.length > 0
      ? `${profile.customIntents.length} client-defined custom intent(s) configured (${profile.customIntents.map((i) => i.key).join(", ")}) — campaigns should be structured to avoid mixing them (see report.opportunities/risks for cross-contamination evidence).`
      : "No custom intents configured — standard intent classification (transactional/commercial/informational/etc.) applies.",
    campaignOpportunities: report.opportunities,
    keywordThemes,
    hypothesesToValidate,
    unknowns,
    negativeKeywordThemes,
    landingPageRequirements,
    budgetRecommendation,
    biddingRecommendation,
    conversionStrategy,
    measurementRequirements,
    testingPlan,
    expectedKpis,
    assumptions,
    risks,
    confidence,
  };
}
