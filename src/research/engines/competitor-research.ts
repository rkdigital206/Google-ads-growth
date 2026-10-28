/**
 * Competitor/SERP intelligence engine (Phase D sections 22-23).
 *
 * Section 22's rule is the whole point of this file: "Do not assume a
 * business appearing in Google search is necessarily a direct competitor."
 * A SERP appearance is SERP_COMPETITOR by default. Promoting it to
 * DIRECT_COMPETITOR requires positive evidence that the domain offers the
 * same product/service — this engine does not have a way to verify that
 * automatically yet (would require fetching and analyzing the competitor's
 * own site, out of scope for this phase), so it never does the promotion
 * itself. A future phase can add that verification step explicitly.
 */

import type { CompetitorResearchProvider, CompetitorSignal } from "../providers/types.js";
import type { ResearchResult } from "../types.js";

export type CompetitorClassification = "DIRECT_COMPETITOR" | "SERP_COMPETITOR" | "MARKET_REFERENCE";

export interface ClassifiedCompetitor {
  domain: string;
  classification: CompetitorClassification;
  observedFor: string;
  evidence: string;
  confidence: number;
}

export async function researchCompetitors(
  provider: CompetitorResearchProvider | undefined,
  query: string,
  geography: string
): Promise<ResearchResult<ClassifiedCompetitor[]>> {
  if (!provider) {
    return { state: "BLOCKED", code: "PROVIDER_NOT_CONFIGURED", data: null, issues: ["PROVIDER_NOT_CONFIGURED: no CompetitorResearchProvider is configured in the ResearchProviderRegistry."] };
  }

  let signals: CompetitorSignal[];
  try {
    signals = await provider.getSerpCompetitors(query, geography);
  } catch (err) {
    return {
      state: "FAILED",
      code: "PROVIDER_ERROR",
      data: null,
      issues: [`COMPETITOR_DATA_UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (signals.length === 0) {
    return { state: "PARTIAL", code: "DATA_UNAVAILABLE", data: null, issues: ["COMPETITOR_DATA_UNAVAILABLE: provider returned no SERP results for this query."] };
  }

  const classified: ClassifiedCompetitor[] = signals.map((s) => ({
    domain: s.domain,
    // Conservative default per section 22 — never DIRECT_COMPETITOR from
    // SERP presence alone.
    classification: "SERP_COMPETITOR",
    observedFor: s.observedFor,
    evidence: s.snippet ?? s.title ?? "Appeared in SERP results for this query.",
    // Deliberately capped below 0.6 (MEDIUM) — a single SERP appearance is
    // PARTIAL_COMPETITOR_SIGNAL, not strong evidence of anything beyond
    // "this domain shows up for this query."
    confidence: 0.4,
  }));

  return { state: "COMPLETE", data: classified, issues: [] };
}
