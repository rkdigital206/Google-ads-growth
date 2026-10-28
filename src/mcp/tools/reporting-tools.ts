import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCampaignPerformance, getSearchTermReport } from "../../google-ads/reporting-service.js";
import { analyzeSearchTerms } from "../../optimization/search-term-optimizer.js";
import { assertAccountBelongsToClient } from "../../database/repositories/account-repo.js";
import { ok, fail, requireClient } from "./tool-helpers.js";

const dateRangeShape = {
  clientId: z.string().describe("The client that owns the account."),
  customerId: z.string().describe("Google Ads customer ID; must be linked to clientId."),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
};

export function registerReportingTools(server: McpServer) {
  server.tool(
    "get_campaign_performance",
    "Returns campaign-level performance metrics for a date range, ordered by cost descending. Read-only. Requires a clientId and a customerId linked to that client. Always pull current data before analysis instead of relying on remembered or externally reported figures.",
    dateRangeShape,
    async ({ clientId, customerId, startDate, endDate }) => {
      try {
        const account = await assertAccountBelongsToClient(clientId, customerId);
        const rows = await getCampaignPerformance(account.customerId, { startDate, endDate });
        return ok({ clientId, customerId: account.customerId, rows });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    "analyze_search_terms",
    "Pulls the search term report for a date range and runs it through the optimizer: flags negative-keyword candidates (spend with zero conversions), monitors near-threshold terms, and — if the client has configured custom intents — flags terms whose intent does not match the campaign's declared intent. Returns recommendations only; does not modify the account. Requires a clientId and a customerId linked to that client.",
    {
      ...dateRangeShape,
      campaignId: z.string().optional(),
      minSpendForWasteFlag: z.number().positive().optional(),
      minClicksForWasteFlag: z.number().int().positive().optional(),
    },
    async ({ clientId, customerId, startDate, endDate, campaignId, minSpendForWasteFlag, minClicksForWasteFlag }) => {
      try {
        const client = await requireClient(clientId);
        const account = await assertAccountBelongsToClient(clientId, customerId);
        const rows = await getSearchTermReport(account.customerId, { startDate, endDate }, campaignId);
        const analysis = analyzeSearchTerms(rows, { minSpendForWasteFlag, minClicksForWasteFlag, customIntents: client.customIntents });
        return ok({ clientId, customerId: account.customerId, ...analysis });
      } catch (err) {
        return fail(err);
      }
    }
  );
}
