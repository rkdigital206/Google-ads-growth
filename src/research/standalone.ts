/**
 * Standalone research operations (Phase E.1 section 11).
 *
 * Each function runs ONE research capability for a client using only that
 * client's stored BusinessProfile / OptimizationConfig and the injected
 * ResearchProviderRegistry. Nothing here knows about any specific client,
 * industry or country, creates fake providers, or mutates Google Ads.
 * `run_growth_research` still orchestrates all of them together.
 */

import type { BusinessProfile } from "../domain/business-profile.js";
import type { OptimizationConfig } from "../domain/optimization-config.js";
import type { ResearchProviderRegistry } from "./providers/types.js";
import type { ResearchResult } from "./types.js";
import { analyzeWebsite, type WebsiteIntelligenceResult } from "./engines/website-intelligence.js";
import { getTrendSnapshot, type TrendSnapshot } from "./engines/trend-intelligence.js";
import { researchCompetitors, type ClassifiedCompetitor } from "./engines/competitor-research.js";
import { candidatesFromSearchTerms, candidatesFromProviderIdeas, assessCandidates, buildProfileRelevance, type KeywordCandidate } from "./engines/keyword-research.js";
import { calculateBusinessEconomics } from "../economics/economics-engine.js";
import { defaultTrendTimeframe } from "./orchestrator.js";
import { normalizeSearchTermPerformance } from "../performance/normalize.js";
import type { SearchTermPerformanceRow } from "../google-ads/reporting-service.js";
import type { DateRange } from "../google-ads/reporting-service.js";

export interface ClientResearchContext {
  clientId: string;
  profile: BusinessProfile;
  config: OptimizationConfig;
}

export async function analyzeClientWebsite(ctx: ClientResearchContext, urlOverride?: string): Promise<ResearchResult<WebsiteIntelligenceResult>> {
  const url = urlOverride ?? ctx.profile.website;
  if (!url) return { state: "NOT_STARTED", code: "NOT_ATTEMPTED", data: null, issues: ["No website URL supplied and none stored on the client profile."] };
  return analyzeWebsite(url, ctx.profile.customIntents);
}

export interface TrendResearchArgs {
  topics?: string[];
  geography?: string;
  timeframe?: { start: string; end: string };
}

export async function researchClientTrends(ctx: ClientResearchContext, providers: ResearchProviderRegistry, args: TrendResearchArgs = {}): Promise<{ topics: string[]; geography: string; results: { topic: string; result: ResearchResult<TrendSnapshot> }[]; issues: string[] }> {
  const topics = args.topics ?? ctx.profile.productsOrServices;
  const geography = args.geography ?? ctx.profile.targetCountries[0] ?? ctx.profile.locations[0]?.country ?? "";
  const timeframe = args.timeframe ?? defaultTrendTimeframe();
  const issues: string[] = [];
  if (topics.length === 0) issues.push("No topics supplied and the client has no productsOrServices configured — nothing to research. Add products/services with update_client_profile.");
  const results = [];
  for (const topic of topics) {
    results.push({ topic, result: await getTrendSnapshot(providers.trend, ctx.clientId, topic, geography, timeframe) });
  }
  return { topics, geography, results, issues };
}

export interface KeywordResearchArgs {
  /** Seed keywords for the external provider; defaults to the client's productsOrServices. */
  seedKeywords?: string[];
  geography?: string;
  language?: string;
  /** Real Google Ads search-term rows (already ownership-verified by the caller). Omit when no linked account is in scope. */
  searchTermRows?: SearchTermPerformanceRow[];
  dateRange?: DateRange;
}

export interface KeywordResearchOutput {
  state: "COMPLETE" | "PARTIAL" | "BLOCKED";
  candidates: KeywordCandidate[];
  sources: { googleAdsSearchTerms: "USED" | "NOT_PROVIDED"; keywordProvider: "USED" | "PROVIDER_NOT_CONFIGURED" | "FAILED" };
  issues: string[];
}

export async function researchClientKeywords(ctx: ClientResearchContext, providers: ResearchProviderRegistry, args: KeywordResearchArgs = {}): Promise<KeywordResearchOutput> {
  const relevance = buildProfileRelevance(ctx.profile);
  const issues: string[] = [];
  let candidates: KeywordCandidate[] = [];
  const sources: KeywordResearchOutput["sources"] = { googleAdsSearchTerms: "NOT_PROVIDED", keywordProvider: "PROVIDER_NOT_CONFIGURED" };

  if (args.searchTermRows) {
    sources.googleAdsSearchTerms = "USED";
    candidates = candidatesFromSearchTerms(args.searchTermRows.map(normalizeSearchTermPerformance), ctx.profile.customIntents, { relevanceScoreFn: relevance.fn, relevanceBasis: relevance.basis });
  } else {
    issues.push("No linked Google Ads account was supplied, so no search-term evidence is included.");
  }

  if (providers.keywordResearch) {
    try {
      const seeds = args.seedKeywords ?? ctx.profile.productsOrServices;
      if (seeds.length === 0) {
        issues.push("No seed keywords supplied and no productsOrServices configured — the keyword provider was not called.");
        sources.keywordProvider = "USED";
      } else {
        const geography = args.geography ?? ctx.profile.targetCountries[0] ?? ctx.profile.locations[0]?.country ?? "";
        const ideas = await providers.keywordResearch.getKeywordIdeas(seeds, geography, args.language ?? ctx.profile.languages[0] ?? "");
        const known = new Set(candidates.map((c) => c.keyword.toLowerCase()));
        candidates = [...candidates, ...candidatesFromProviderIdeas(ideas.filter((i) => !known.has(i.keyword.toLowerCase())), ctx.profile.customIntents, relevance)];
        sources.keywordProvider = "USED";
      }
    } catch (err) {
      sources.keywordProvider = "FAILED";
      issues.push(`KEYWORD_PROVIDER_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    issues.push("PROVIDER_NOT_CONFIGURED: no KeywordResearchProvider is configured in the ResearchProviderRegistry; no search-volume or keyword-idea data is available and none has been estimated.");
  }

  const economics = calculateBusinessEconomics(ctx.profile.businessType, ctx.config);
  const affordableCpa = ctx.config.targetCPA ?? economics.targetCpa?.value ?? economics.maxCpa?.value ?? null;
  candidates = assessCandidates(candidates, affordableCpa);

  const usedAnything = sources.googleAdsSearchTerms === "USED" || sources.keywordProvider === "USED";
  const state = !usedAnything ? "BLOCKED" : issues.length > 0 ? "PARTIAL" : "COMPLETE";
  return { state, candidates, sources, issues };
}

export async function researchClientCompetitors(
  ctx: ClientResearchContext,
  providers: ResearchProviderRegistry,
  args: { query?: string; geography?: string } = {}
): Promise<{ query: string; geography: string; result: ResearchResult<ClassifiedCompetitor[]> }> {
  const query = args.query ?? ctx.profile.productsOrServices[0] ?? ctx.profile.industry ?? ctx.profile.clientName;
  const geography = args.geography ?? ctx.profile.targetCountries[0] ?? ctx.profile.locations[0]?.country ?? "";
  return { query, geography, result: await researchCompetitors(providers.competitorResearch, query, geography) };
}
