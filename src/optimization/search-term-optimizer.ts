import { fromMicros } from "../utils/validation.js";
import { classifyTermAgainstIntents, type CustomIntentDefinition } from "../domain/intent.js";

export interface SearchTermRow {
  search_term_view: { search_term: string };
  campaign: { id: string; name: string };
  ad_group: { id: string; name: string; resource_name?: string };
  metrics: { clicks: string; impressions: string; cost_micros: string; conversions: number };
}

export interface SearchTermFinding {
  searchTerm: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  cost: number;
  conversions: number;
  /** A client custom-intent key, or "UNKNOWN" when no/ambiguous match. */
  classifiedIntent: string;
  intentConfidence: number;
  recommendation: "ADD_NEGATIVE" | "CROSS_CONTAMINATION_REVIEW" | "MONITOR" | "NONE";
  reason: string;
}

export interface SearchTermAnalysis {
  findings: SearchTermFinding[];
  totalWastedSpend: number;
  summary: string;
}

/**
 * Returns the client custom-intent key that a campaign name declares, using
 * the "SEARCH - <KEY> - ..." convention (or any name containing the key as a
 * delimited token). Returns null when the name declares none.
 */
export function expectedIntentFromCampaignName(campaignName: string, customIntents: CustomIntentDefinition[]): string | null {
  const escape = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const def of customIntents) {
    const re = new RegExp(`(^|[\\s\\-_|:/])${escape(def.key)}($|[\\s\\-_|:/])`, "i");
    if (re.test(campaignName)) return def.key;
  }
  return null;
}

/**
 * Analyzes a search term report against a spend-with-zero-conversions
 * threshold and against the campaign's expected intent (declared in its name
 * via the client's own custom-intent keys). With no custom intents configured,
 * intent cross-contamination checks are simply skipped.
 * Produces recommendations, NOT executed changes — the audit or
 * optimization tool calling this decides whether to turn ADD_NEGATIVE
 * findings into an actual addNegativeKeywords() call.
 */
export function analyzeSearchTerms(
  rows: SearchTermRow[],
  opts: { minSpendForWasteFlag?: number; minClicksForWasteFlag?: number; customIntents?: CustomIntentDefinition[] } = {}
): SearchTermAnalysis {
  const minSpend = opts.minSpendForWasteFlag ?? 20; // account currency units
  const minClicks = opts.minClicksForWasteFlag ?? 5;
  const customIntents = opts.customIntents ?? [];

  const findings: SearchTermFinding[] = rows.map((row) => {
    const cost = fromMicros(row.metrics.cost_micros);
    const clicks = Number(row.metrics.clicks);
    const conversions = row.metrics.conversions;
    const { intent, confidence } = classifyTermAgainstIntents(row.search_term_view.search_term, customIntents);

    const campaignExpectedIntent = expectedIntentFromCampaignName(row.campaign.name, customIntents);

    let recommendation: SearchTermFinding["recommendation"] = "NONE";
    let reason = "No action threshold met.";

    if (
      campaignExpectedIntent !== null &&
      intent !== "UNKNOWN" &&
      intent !== campaignExpectedIntent &&
      confidence >= 0.6
    ) {
      recommendation = "CROSS_CONTAMINATION_REVIEW";
      reason = `Search term classified as ${intent} intent (confidence ${confidence.toFixed(
        2
      )}) but is running in a ${campaignExpectedIntent}-intent campaign ("${row.campaign.name}"). Likely misdirected budget — review before adding as a negative, in case the classifier is wrong.`;
    } else if (conversions === 0 && cost >= minSpend && clicks >= minClicks) {
      recommendation = "ADD_NEGATIVE";
      reason = `${clicks} clicks and ${cost.toFixed(
        2
      )} spent with zero conversions — exceeds waste thresholds (${minClicks} clicks / ${minSpend} spend).`;
    } else if (conversions === 0 && clicks >= minClicks) {
      recommendation = "MONITOR";
      reason = `${clicks} clicks with zero conversions but below the spend threshold — watch next period before acting.`;
    }

    return {
      searchTerm: row.search_term_view.search_term,
      campaignName: row.campaign.name,
      adGroupName: row.ad_group.name,
      clicks,
      cost,
      conversions,
      classifiedIntent: intent,
      intentConfidence: confidence,
      recommendation,
      reason,
    };
  });

  const totalWastedSpend = findings
    .filter((f) => f.recommendation === "ADD_NEGATIVE")
    .reduce((sum, f) => sum + f.cost, 0);

  const contamination = findings.filter((f) => f.recommendation === "CROSS_CONTAMINATION_REVIEW").length;

  return {
    findings,
    totalWastedSpend,
    summary:
      `${findings.length} search terms analyzed. ` +
      `${findings.filter((f) => f.recommendation === "ADD_NEGATIVE").length} negative-keyword candidates ` +
      `(~${totalWastedSpend.toFixed(2)} in flagged wasted spend). ` +
      `${contamination} possible intent cross-contamination cases requiring manual review.`,
  };
}
