import { runQuery } from "./client.js";
import { enumName, KeywordMatchTypeEnum, CriterionStatusEnum } from "./enum-utils.js";
import { guardedMutate } from "../safety/mutation-guard.js";

/** Named export of the keyword row shape, matching the existing GAQL query exactly — shared with performance/normalize.ts. */
export interface KeywordPerformanceRow {
  ad_group_criterion: {
    criterion_id: string;
    keyword: { text: string; match_type: string };
    status: string;
  };
  campaign: { id: string; name: string };
  ad_group: { id: string; name: string };
  metrics: { clicks: string; conversions: number; cost_micros: string };
}

export async function listKeywords(customerId: string, campaignId?: string) {
  const filter = campaignId ? `AND campaign.id = ${Number(campaignId)}` : "";
  const rows = await runQuery<KeywordPerformanceRow>(
    customerId,
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type, ad_group_criterion.status,
            campaign.id, campaign.name, ad_group.id, ad_group.name,
            metrics.clicks, metrics.conversions, metrics.cost_micros
     FROM keyword_view
     WHERE ad_group_criterion.status != 'REMOVED' ${filter}
     ORDER BY metrics.cost_micros DESC`
  );
  // Normalize numeric enums to string names at the boundary (see enum-utils.ts).
  return rows.map((r) => ({
    ...r,
    ad_group_criterion: {
      ...r.ad_group_criterion,
      status: enumName(CriterionStatusEnum, r.ad_group_criterion.status),
      keyword: { ...r.ad_group_criterion.keyword, match_type: enumName(KeywordMatchTypeEnum, r.ad_group_criterion.keyword.match_type) },
    },
  }));
}

export interface AddNegativeKeywordsInput {
  customerId: string;
  accountId: string;
  /** ad_group resource_name (preferred, tightest scope) OR campaign resource_name for a campaign-level negative. */
  targetResourceName: string;
  scope: "AD_GROUP" | "CAMPAIGN";
  keywords: { text: string; matchType: "EXACT" | "PHRASE" | "BROAD" }[];
  reasoning: string;
  requestedByTool: string;
}

/**
 * Adds negative keywords — the lowest-risk mutation category in the system
 * (see risk-engine.ts: negatives can only exclude traffic, never increase
 * spend or remove reach that was converting). This is intentionally the
 * one write path a "continuous optimization" loop can call without a human
 * in the loop on every run, even in hard approval mode.
 */
export async function addNegativeKeywords(input: AddNegativeKeywordsInput) {
  return guardedMutate({
    customerId: input.customerId,
    accountId: input.accountId,
    mutation: { resourceType: "negative_keyword", operation: "CREATE" },
    proposedState: {
      scope: input.scope,
      target: input.targetResourceName,
      keywords: input.keywords,
    },
    reasoning: input.reasoning,
    requestedByTool: input.requestedByTool,
    execute: async (customer) => {
      const criteria = input.keywords.map((kw) => ({
        [input.scope === "AD_GROUP" ? "ad_group" : "campaign"]: input.targetResourceName,
        negative: true,
        keyword: { text: kw.text, match_type: kw.matchType },
      }));

      if (input.scope === "AD_GROUP") {
        const result = await customer.adGroupCriteria.create(criteria as never);
        return result.results.map((r) => r.resource_name).filter((n): n is string => typeof n === "string");
      } else {
        const result = await customer.campaignCriteria.create(criteria as never);
        return result.results.map((r) => r.resource_name).filter((n): n is string => typeof n === "string");
      }
    },
  });
}
