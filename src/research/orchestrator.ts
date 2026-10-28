/**
 * Research orchestrator (Phase E section 15) — runBusinessResearch.
 *
 * Combines: BusinessProfile, website intelligence, Google Ads account
 * audit, trend research, keyword research, competitor research, and
 * business economics into one GrowthResearchReport.
 *
 * This function is READ-ONLY — it queries Google Ads (via the audit
 * engine) and whatever research providers are configured, but never
 * mutates anything. Per section 17, strategy generation (report.ts /
 * strategy-brief.ts) happens on top of this output as a separate step.
 */

import type { BusinessProfile } from "../domain/business-profile.js";
import type { OptimizationConfig } from "../domain/optimization-config.js";
import type { ResearchProviderRegistry } from "./providers/types.js";
import type { DateRange } from "../google-ads/reporting-service.js";
import { getSearchTermReport } from "../google-ads/reporting-service.js";
import { normalizeSearchTermPerformance } from "../performance/normalize.js";
import { analyzeWebsite, type WebsiteIntelligenceResult } from "./engines/website-intelligence.js";
import { getTrendSnapshot, type TrendSnapshot } from "./engines/trend-intelligence.js";
import { candidatesFromSearchTerms, candidatesFromProviderIdeas, mergeTrendSignal, assessCandidates, buildProfileRelevance, type KeywordCandidate } from "./engines/keyword-research.js";
import { researchCompetitors, type ClassifiedCompetitor } from "./engines/competitor-research.js";
import { auditGoogleAdsAccount, type GoogleAdsAccountAudit } from "../audit/account-audit.js";
import { calculateBusinessEconomics, type BusinessEconomicsSummary } from "../economics/economics-engine.js";
import type { ResearchResult } from "./types.js";
import { buildResearchSignals, type ResearchSignal } from "./signals.js";
import { describeMissingProviders } from "./providers/registry.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "research-orchestrator" });

export interface GrowthResearchReport {
  clientId: string | null;
  clientName: string;
  generatedAt: string;

  /** Which registry capabilities are NOT configured — each means that research area returned PROVIDER_NOT_CONFIGURED, not data. */
  missingProviders: string[];
  /** Every finding labeled FACT / INFERENCE / HYPOTHESIS / UNKNOWN with source, retrievedAt, evidence and confidence. */
  signals: ResearchSignal[];

  businessUnderstanding: {
    industry: string | null;
    businessType: string | null;
    businessModel: string | null;
    productsOrServices: string[];
    locations: string[];
  };

  websiteIntelligence: ResearchResult<WebsiteIntelligenceResult>;
  accountAudit: GoogleAdsAccountAudit | null;
  accountAuditIssue: string | null;
  trendSignals: ResearchResult<TrendSnapshot>[];
  keywordOpportunities: KeywordCandidate[];
  competitorSignals: ResearchResult<ClassifiedCompetitor[]>;
  economics: BusinessEconomicsSummary;

  risks: string[];
  opportunities: string[];
  missingInformation: string[];
  recommendedNextResearch: string[];
}

export interface RunBusinessResearchInput {
  clientId?: string;
  profile: BusinessProfile;
  config: OptimizationConfig;
  providers?: ResearchProviderRegistry;
  /** If provided, runs the Google Ads account audit + pulls real search-term data for keyword research. Omit for a client with no connected Google Ads account yet — research can still run on website/trend/competitor data alone. */
  googleAdsAccount?: { customerId: string; dateRange: DateRange };
  /** Trend topics to research — typically the client's primary products/services. */
  trendTopics?: string[];
  trendGeography?: string;
  /** Trend window. Defaults to the last 12 months, INDEPENDENT of the Ads lookback (seasonality needs a long window). */
  trendTimeframe?: { start: string; end: string };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Default trend window: the 365 days ending today. */
export function defaultTrendTimeframe(now: Date = new Date()): { start: string; end: string } {
  return { start: isoDate(new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)), end: isoDate(now) };
}

export async function runBusinessResearch(input: RunBusinessResearchInput): Promise<GrowthResearchReport> {
  const { profile, config, providers, googleAdsAccount } = input;
  const missingInformation: string[] = [];
  const risks: string[] = [];
  const opportunities: string[] = [];
  const relevance = buildProfileRelevance(profile);
  const trendTimeframe = input.trendTimeframe ?? defaultTrendTimeframe();

  // --- Website intelligence ---
  const websiteIntelligence: ResearchResult<WebsiteIntelligenceResult> = profile.website
    ? await analyzeWebsite(profile.website, profile.customIntents)
    : { state: "NOT_STARTED", data: null, issues: ["No website configured for this client."] };
  if (websiteIntelligence.state !== "COMPLETE") {
    missingInformation.push(`Website intelligence incomplete: ${websiteIntelligence.issues.join("; ")}`);
  }

  // --- Google Ads account audit + search-term-derived keyword research ---
  let accountAudit: GoogleAdsAccountAudit | null = null;
  let accountAuditIssue: string | null = null;
  let keywordOpportunities: KeywordCandidate[] = [];

  if (googleAdsAccount) {
    try {
      accountAudit = await auditGoogleAdsAccount(googleAdsAccount.customerId, googleAdsAccount.dateRange, { targetCPA: config.targetCPA, targetROAS: config.targetROAS });
      if (accountAudit.overallScore !== null && accountAudit.overallScore < 50) {
        risks.push(`Account health score is ${accountAudit.overallScore}/100 — see accountAudit.weaknesses before acting on any performance-based recommendation.`);
      }
      if (accountAudit.opportunities.length > 0) opportunities.push(...accountAudit.opportunities);
    } catch (err) {
      accountAuditIssue = err instanceof Error ? err.message : String(err);
      missingInformation.push(`Google Ads account audit failed: ${accountAuditIssue}`);
    }

    try {
      const searchTermRows = await getSearchTermReport(googleAdsAccount.customerId, googleAdsAccount.dateRange);
      const normalized = searchTermRows.map(normalizeSearchTermPerformance);
      keywordOpportunities = candidatesFromSearchTerms(normalized, profile.customIntents, { relevanceScoreFn: relevance.fn, relevanceBasis: relevance.basis });
    } catch (err) {
      missingInformation.push(`Search-term-based keyword research unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    missingInformation.push("No Google Ads account connected — account audit and search-term-based keyword research were skipped. Keyword research is limited to whatever external providers are configured.");
  }

  // --- Trend research ---
  const trendGeography = input.trendGeography ?? profile.targetCountries[0] ?? profile.locations[0]?.country ?? "";
  const trendTopics = input.trendTopics ?? profile.productsOrServices;
  const trendSignals: ResearchResult<TrendSnapshot>[] = [];
  for (const topic of trendTopics) {
    const result = await getTrendSnapshot(providers?.trend, input.clientId ?? profile.clientName, topic, trendGeography, trendTimeframe);
    trendSignals.push(result);
    if (result.state === "COMPLETE" && result.data) {
      // Merge this topic's trend direction onto any existing keyword
      // candidate with a matching keyword — trend data never creates a new
      // candidate by itself (section 13: trend ≠ profit; see
      // engines/keyword-research.ts's mergeTrendSignal for the actual
      // elevation/suppression rules).
      keywordOpportunities = mergeTrendSignal(keywordOpportunities, topic, result.data.direction);
    }
  }
  if (trendSignals.some((t) => t.code === "PROVIDER_NOT_CONFIGURED")) {
    missingInformation.push("Trend research is unavailable — no TrendProvider is configured in the ResearchProviderRegistry (PROVIDER_NOT_CONFIGURED).");
  }

  // --- External keyword ideas (only if a KeywordResearchProvider is configured) ---
  if (providers?.keywordResearch) {
    try {
      const ideas = await providers.keywordResearch.getKeywordIdeas(
        trendTopics.length > 0 ? trendTopics : profile.productsOrServices,
        trendGeography,
        profile.languages[0] ?? ""
      );
      const known = new Set(keywordOpportunities.map((k) => k.keyword.toLowerCase()));
      keywordOpportunities = [...keywordOpportunities, ...candidatesFromProviderIdeas(ideas.filter((i) => !known.has(i.keyword.toLowerCase())), profile.customIntents, relevance)];
    } catch (err) {
      missingInformation.push(`Keyword research provider failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    missingInformation.push("Keyword research provider not configured (PROVIDER_NOT_CONFIGURED) — no external search-volume or keyword-idea data is available and none has been estimated.");
  }

  // --- Competitor research ---
  const competitorQuery = trendTopics[0] ?? profile.industry ?? profile.clientName;
  const competitorSignals = await researchCompetitors(providers?.competitorResearch, competitorQuery, trendGeography);
  if (competitorSignals.state !== "COMPLETE") {
    missingInformation.push(`Competitor research unavailable: ${competitorSignals.issues.join("; ")}`);
  }

  // --- Economics ---
  const economics = calculateBusinessEconomics(profile.businessType, config);
  const economicsGaps = [economics.breakEvenRoas, economics.targetRoas, economics.maxCpa, economics.targetCpa, economics.maxCac]
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .filter((r) => !r.calculable);
  if (economicsGaps.length > 0) {
    missingInformation.push(
      `Business economics incomplete: ${economicsGaps.map((g) => `${g.metric} needs ${g.missingInputs.join(", ")}`).join("; ")}`
    );
  }

  // Trend is never treated as profit: every candidate gets a multi-dimensional assessment (see opportunity-scoring.ts).
  const affordableCpa = config.targetCPA ?? economics.targetCpa?.value ?? economics.maxCpa?.value ?? null;
  keywordOpportunities = assessCandidates(keywordOpportunities, affordableCpa);

  const generatedAt = new Date().toISOString();
  const signals = buildResearchSignals({
    generatedAt,
    website: websiteIntelligence,
    accountAudit,
    accountAuditIssue,
    trends: trendSignals,
    keywordCandidates: keywordOpportunities,
    competitors: competitorSignals,
    economics,
  });

  const recommendedNextResearch: string[] = [];
  if (!googleAdsAccount) recommendedNextResearch.push("Connect a Google Ads account to enable account audit and real search-term-based keyword evidence.");
  if (!providers?.keywordResearch) recommendedNextResearch.push("Configure a KeywordResearchProvider to enable external keyword ideas and provider-reported search volume.");
  if (!providers?.trend) recommendedNextResearch.push("Configure a TrendProvider to enable demand/seasonality research.");
  if (!providers?.competitorResearch) recommendedNextResearch.push("Configure a CompetitorResearchProvider to enable SERP competitor research.");
  if (economicsGaps.length > 0) recommendedNextResearch.push("Complete onboarding economics questions (see onboarding/engine.ts's assessOnboardingCompleteness) to enable precise CPA/ROAS targets.");

  log.info({ clientName: profile.clientName, missingCount: missingInformation.length }, "Business research run complete");

  return {
    clientId: input.clientId ?? null,
    clientName: profile.clientName,
    generatedAt,
    missingProviders: describeMissingProviders(providers ?? {}),
    signals,
    businessUnderstanding: {
      industry: profile.industry,
      businessType: profile.businessType,
      businessModel: profile.businessModel,
      productsOrServices: profile.productsOrServices,
      locations: profile.locations.map((l) => [l.city, l.region, l.country].filter(Boolean).join(", ")),
    },
    websiteIntelligence,
    accountAudit,
    accountAuditIssue,
    trendSignals,
    keywordOpportunities,
    competitorSignals,
    economics,
    risks,
    opportunities,
    missingInformation,
    recommendedNextResearch,
  };
}
