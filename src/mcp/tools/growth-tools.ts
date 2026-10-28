import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditGoogleAdsAccount } from "../../audit/account-audit.js";
import { calculateBusinessEconomics } from "../../economics/economics-engine.js";
import { runBusinessResearch } from "../../research/orchestrator.js";
import { generateGrowthStrategyBrief } from "../../research/strategy-brief.js";
import { getResearchProviderRegistry } from "../../research/providers/registry.js";
import { assertAccountBelongsToClient, getLinkedAccountsForClient } from "../../database/repositories/account-repo.js";
import { childLogger } from "../../utils/logger.js";
import { ok, fail, requireClient, defaultRange } from "./tool-helpers.js";

const log = childLogger({ module: "growth-tools" });

const clientId = z.string().describe("The client these results are for.");
const customerIdRequired = z.string().describe("Google Ads customer ID. Must be linked to the given clientId (see link_google_ads_account).");

export function registerGrowthTools(server: McpServer) {
  server.tool(
    "audit_google_ads_account",
    "Runs the deterministic, READ-ONLY Google Ads account audit (tracking, structure, wasted spend, conversion performance vs the client's configured CPA/ROAS targets, budget utilization). Requires clientId AND customerId and refuses unless the account is linked to that client. Every component reports score, evidence, confidence, missingData and warnings; components that cannot be scored are excluded from the overall score, never defaulted.",
    { clientId, customerId: customerIdRequired, lookbackDays: z.number().int().min(1).max(365).default(90) },
    async ({ clientId: cid, customerId, lookbackDays }) => {
      try {
        const client = await requireClient(cid);
        const account = await assertAccountBelongsToClient(cid, customerId);
        const audit = await auditGoogleAdsAccount(account.customerId, defaultRange(lookbackDays), {
          targetCPA: client.optimizationConfig.targetCPA,
          targetROAS: client.optimizationConfig.targetROAS,
        });
        return ok({ clientId: cid, ...audit });
      } catch (err) {
        log.error({ err, clientId: cid, customerId }, "audit_google_ads_account failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "calculate_business_economics",
    "Calculates deterministic economics (break-even/target ROAS, max/target CPA, max CAC) from a client's configured OptimizationConfig. Every result states its formula, the inputs used and the inputs still missing. leadValue and lifetimeValue are distinct and never substituted for each other. Never invents a number the client hasn't provided.",
    { clientId },
    async ({ clientId: cid }) => {
      try {
        const client = await requireClient(cid);
        return ok({ clientId: cid, economics: calculateBusinessEconomics(client.profile.businessType, client.optimizationConfig) });
      } catch (err) {
        log.error({ err, clientId: cid }, "calculate_business_economics failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "run_growth_research",
    "Runs the full research orchestrator for a client: website intelligence, Google Ads account audit (only if a customerId linked to this client is supplied), trend research, keyword research, competitor research and economics, combined into one GrowthResearchReport whose findings are labeled FACT / INFERENCE / HYPOTHESIS / UNKNOWN. External providers come from the ResearchProviderRegistry; any capability without a configured provider reports PROVIDER_NOT_CONFIGURED rather than data. Read-only: no mutation, no campaign creation.",
    {
      clientId,
      customerId: z.string().optional().describe("Optional linked Google Ads customer ID. Omit to run without Ads data."),
      lookbackDays: z.number().int().min(1).max(365).default(90),
      trendTopics: z.array(z.string()).optional().describe("Defaults to the client's stored productsOrServices."),
    },
    async ({ clientId: cid, customerId, lookbackDays, trendTopics }) => {
      try {
        const client = await requireClient(cid);
        const account = customerId ? await assertAccountBelongsToClient(cid, customerId) : null;
        const report = await runBusinessResearch({
          clientId: cid,
          profile: client.profile,
          config: client.optimizationConfig,
          providers: getResearchProviderRegistry(),
          googleAdsAccount: account ? { customerId: account.customerId, dateRange: defaultRange(lookbackDays) } : undefined,
          trendTopics,
        });
        const linked = account ? [] : (await getLinkedAccountsForClient(cid)).map((a) => ({ customerId: a.customerId, descriptiveName: a.descriptiveName }));
        return ok({ ...report, linkedAccountsAvailable: linked });
      } catch (err) {
        log.error({ err, clientId: cid, customerId }, "run_growth_research failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "generate_growth_strategy",
    "Converts the client's research into a GrowthStrategyBrief: objectives, conversion-validated keyword themes, SEPARATE hypotheses to validate (a rising trend is a demand signal, not a profitable opportunity), unknowns, landing page requirements, budget/bidding stance, measurement requirements and risks. A PLAN ONLY — never creates or modifies anything in Google Ads. If customerId is given it must be linked to the clientId.",
    {
      clientId,
      customerId: z.string().optional(),
      lookbackDays: z.number().int().min(1).max(365).default(90),
      trendTopics: z.array(z.string()).optional(),
    },
    async ({ clientId: cid, customerId, lookbackDays, trendTopics }) => {
      try {
        const client = await requireClient(cid);
        const account = customerId ? await assertAccountBelongsToClient(cid, customerId) : null;
        const report = await runBusinessResearch({
          clientId: cid,
          profile: client.profile,
          config: client.optimizationConfig,
          providers: getResearchProviderRegistry(),
          googleAdsAccount: account ? { customerId: account.customerId, dateRange: defaultRange(lookbackDays) } : undefined,
          trendTopics,
        });
        return ok({ clientId: cid, research: report, strategy: generateGrowthStrategyBrief(client.profile, report) });
      } catch (err) {
        log.error({ err, clientId: cid, customerId }, "generate_growth_strategy failed");
        return fail(err);
      }
    }
  );
}
