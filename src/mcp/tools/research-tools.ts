import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeClientWebsite, researchClientTrends, researchClientKeywords, researchClientCompetitors } from "../../research/standalone.js";
import { getResearchProviderRegistry } from "../../research/providers/registry.js";
import { getSearchTermReport } from "../../google-ads/reporting-service.js";
import { assertAccountBelongsToClient } from "../../database/repositories/account-repo.js";
import { childLogger } from "../../utils/logger.js";
import { ok, fail, requireClient, defaultRange } from "./tool-helpers.js";

const log = childLogger({ module: "research-tools" });
const clientId = z.string().describe("The client to research. Uses its stored business profile.");

export function registerResearchTools(server: McpServer) {
  server.tool(
    "analyze_website",
    "READ-ONLY. Analyzes the client's website (or a supplied URL) for conversion-path signals, claims (labeled VERIFIED / INFERRED / UNKNOWN) and mixed-intent messaging based on the client's own configured custom intents. If the site blocks automated access this is reported as BLOCKED, never as an empty page.",
    { clientId, url: z.string().url().optional().describe("Defaults to the website stored on the client profile.") },
    async ({ clientId: cid, url }) => {
      try {
        const c = await requireClient(cid);
        const result = await analyzeClientWebsite({ clientId: cid, profile: c.profile, config: c.optimizationConfig }, url);
        return ok({ clientId: cid, result });
      } catch (err) {
        log.error({ err, clientId: cid }, "analyze_website failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "research_trends",
    "READ-ONLY. Researches demand trends for the client's products/services via the configured TrendProvider (interest over time, geographic interest, related queries and topics). With no TrendProvider configured it returns PROVIDER_NOT_CONFIGURED and no numbers. A rising trend is a demand signal only — it is NOT evidence of a profitable Google Ads opportunity.",
    {
      clientId,
      topics: z.array(z.string()).optional().describe("Defaults to the client's stored productsOrServices."),
      geography: z.string().optional().describe("Defaults to the client's first target country/location."),
      timeframeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      timeframeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    async ({ clientId: cid, topics, geography, timeframeStart, timeframeEnd }) => {
      try {
        const c = await requireClient(cid);
        const out = await researchClientTrends({ clientId: cid, profile: c.profile, config: c.optimizationConfig }, getResearchProviderRegistry(), {
          topics,
          geography,
          timeframe: timeframeStart && timeframeEnd ? { start: timeframeStart, end: timeframeEnd } : undefined,
        });
        return ok({ clientId: cid, ...out });
      } catch (err) {
        log.error({ err, clientId: cid }, "research_trends failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "research_keywords",
    "READ-ONLY. Builds keyword candidates from (a) real search-term data of a Google Ads account linked to this client, if customerId is supplied, and (b) the configured KeywordResearchProvider, if any. Search volume appears ONLY when a provider reported it. Every candidate carries a multi-dimensional opportunity assessment (trend, intent, relevance, Ads evidence, conversions, economics, confidence) — provider ideas are hypotheses, never proven demand.",
    {
      clientId,
      customerId: z.string().optional().describe("Optional linked Google Ads customer ID for real search-term evidence."),
      lookbackDays: z.number().int().min(1).max(365).default(90),
      seedKeywords: z.array(z.string()).optional().describe("Defaults to the client's stored productsOrServices."),
      geography: z.string().optional(),
      language: z.string().optional(),
    },
    async ({ clientId: cid, customerId, lookbackDays, seedKeywords, geography, language }) => {
      try {
        const c = await requireClient(cid);
        let searchTermRows;
        if (customerId) {
          const account = await assertAccountBelongsToClient(cid, customerId);
          searchTermRows = await getSearchTermReport(account.customerId, defaultRange(lookbackDays));
        }
        const out = await researchClientKeywords({ clientId: cid, profile: c.profile, config: c.optimizationConfig }, getResearchProviderRegistry(), {
          seedKeywords,
          geography,
          language,
          searchTermRows,
        });
        return ok({ clientId: cid, ...out });
      } catch (err) {
        log.error({ err, clientId: cid, customerId }, "research_keywords failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "research_competitors",
    "READ-ONLY. Finds SERP competitors for a query via the configured CompetitorResearchProvider. With none configured it returns PROVIDER_NOT_CONFIGURED and no competitor data. SERP presence alone is classified SERP_COMPETITOR, never DIRECT_COMPETITOR.",
    {
      clientId,
      query: z.string().optional().describe("Defaults to the client's first product/service, industry, or name."),
      geography: z.string().optional(),
    },
    async ({ clientId: cid, query, geography }) => {
      try {
        const c = await requireClient(cid);
        const out = await researchClientCompetitors({ clientId: cid, profile: c.profile, config: c.optimizationConfig }, getResearchProviderRegistry(), { query, geography });
        return ok({ clientId: cid, ...out });
      } catch (err) {
        log.error({ err, clientId: cid }, "research_competitors failed");
        return fail(err);
      }
    }
  );
}
