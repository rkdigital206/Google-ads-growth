/**
 * Provider abstractions (Phase D, section 4).
 *
 * No engine in research/engines/ may import a concrete provider directly —
 * only these interfaces. This is what lets a real Google Trends API, a
 * SEMrush/Ahrefs keyword provider, or a SERP-scraping competitor provider
 * get wired in later without touching engine logic.
 *
 * NONE of these interfaces have a real implementation wired up in this
 * phase — no API keys/credentials for any external research provider
 * exist in this project yet. Every engine that depends on one of these
 * must handle a null/not-configured provider gracefully (PROVIDER_NOT_CONFIGURED,
 * per section 37) rather than assume one exists.
 */

export type TrendDirection = "RISING" | "STABLE" | "DECLINING" | "SEASONAL" | "VOLATILE" | "INSUFFICIENT_DATA" | "UNKNOWN";

export interface TrendTimeSeriesPoint {
  date: string; // ISO 8601 date
  interest: number; // provider-normalized interest value (e.g. 0-100)
}

export interface TrendInterestByRegion {
  region: string;
  interest: number;
}

export interface TrendRelatedQuery {
  query: string;
  /** "RISING" if the provider flags it as a breakout/rising related query, "TOP" otherwise. */
  kind: "RISING" | "TOP";
  value: number | null;
}

export interface TrendProvider {
  name: string;
  getInterestOverTime(topic: string, geography: string, timeframe: { start: string; end: string }): Promise<TrendTimeSeriesPoint[]>;
  getInterestByRegion(topic: string, geography: string): Promise<TrendInterestByRegion[]>;
  getRelatedQueries(topic: string, geography: string): Promise<TrendRelatedQuery[]>;
  getRelatedTopics(topic: string, geography: string): Promise<string[]>;
}

export interface KeywordResearchCandidate {
  keyword: string;
  /** Provider-reported search volume, if any. Null if the provider doesn't expose it or none was found. */
  searchVolume: number | null;
  /** Provider-reported competition signal, if any (e.g. "LOW"/"MEDIUM"/"HIGH" or a 0-1 score depending on provider). */
  competition: string | number | null;
}

export interface KeywordResearchProvider {
  name: string;
  getKeywordIdeas(seedKeywords: string[], geography: string, language: string): Promise<KeywordResearchCandidate[]>;
}

export interface CompetitorSignal {
  domain: string;
  /** How this competitor was surfaced — see research/types.ts's DIRECT_COMPETITOR/SERP_COMPETITOR/MARKET_REFERENCE distinction, applied by the consuming engine, not this provider. */
  observedFor: string; // the query/keyword that surfaced this competitor
  title: string | null;
  snippet: string | null;
}

export interface CompetitorResearchProvider {
  name: string;
  getSerpCompetitors(query: string, geography: string): Promise<CompetitorSignal[]>;
}

export interface MarketResearchProvider {
  name: string;
  /** Free-text market/terminology research for a topic — shape is intentionally loose since real providers vary widely (search APIs, LLM research tools, etc). */
  research(topic: string, geography: string): Promise<{ summary: string; sources: string[] }>;
}

/**
 * Registry of configured providers for a research run. Any field left
 * undefined means that capability is PROVIDER_NOT_CONFIGURED — engines
 * must check for this explicitly rather than assume a provider exists.
 */
export interface ResearchProviderRegistry {
  trend?: TrendProvider;
  keywordResearch?: KeywordResearchProvider;
  competitorResearch?: CompetitorResearchProvider;
  marketResearch?: MarketResearchProvider;
}
