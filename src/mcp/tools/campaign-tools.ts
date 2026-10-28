import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchCampaign, updateCampaignBudget, pauseCampaign } from "../../google-ads/campaign-service.js";
import { addNegativeKeywords } from "../../google-ads/keyword-service.js";
import { ApprovalRequiredError, ValidationError } from "../../utils/errors.js";
import { toToolErrorMessage } from "../../utils/errors.js";
import { assertMutationTarget, assertResourceBelongsToCustomer } from "../../database/repositories/account-repo.js";
import { STANDARD_INTENT_TYPES, isKnownIntent } from "../../domain/intent.js";
import { requireClient } from "./tool-helpers.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ module: "campaign-tools" });

/**
 * Every mutation tool follows the same response contract: on
 * ApprovalRequiredError, return a normal (non-error) tool result explaining
 * that human approval is pending and how to grant it — this is expected
 * control flow the calling model should relay to the user, not a failure.
 */
function handleGuardedResult(err: unknown) {
  if (err instanceof ApprovalRequiredError) {
    return {
      content: [
        {
          type: "text" as const,
          text: `PENDING APPROVAL (${err.approvalRequestId}): ${err.message}`,
        },
      ],
    };
  }
  log.error({ err }, "Mutation tool failed");
  return { content: [{ type: "text" as const, text: toToolErrorMessage(err) }], isError: true };
}

/**
 * Identity fields every mutation tool must carry. The client, the Google
 * customer ID and the internal account record must all agree and the account
 * must be a linked CLIENT account (assertMutationTarget) BEFORE the existing
 * risk-engine → approval-policy → mutation-guard chain runs. That chain is
 * unchanged and still decides risk, approval and execution.
 */
const targetShape = {
  clientId: z.string().describe("The client that owns the account being changed."),
  customerId: z.string(),
  accountId: z.string().describe("Internal database ID of the linked GoogleAdsAccount record, not the Google customer ID."),
};

export function registerCampaignTools(server: McpServer) {
  server.tool(
    "create_search_campaign",
    "Proposes creating a new PAUSED Search campaign with its own budget. ALWAYS requires human approval regardless of settings (campaign creation is always HIGH risk). The campaign is tagged with an intent that must be one of the client's configured custom intents or a standard intent type. The target account must be linked to the given client.",
    {
      ...targetShape,
      campaignName: z.string(),
      dailyBudget: z.number().positive(),
      intent: z.string().min(1).describe("A custom intent key configured for this client, or a standard intent type (e.g. TRANSACTIONAL)."),
      biddingStrategy: z.enum(["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE", "MANUAL_CPC"]),
      reasoning: z.string().min(10, "Explain why this campaign is being proposed."),
    },
    async ({ clientId, ...args }) => {
      try {
        await assertMutationTarget({ clientId, customerId: args.customerId, accountId: args.accountId });
        const client = await requireClient(clientId);
        if (!isKnownIntent(args.intent, client.customIntents)) {
          throw new ValidationError(
            `Intent "${args.intent}" is not configured for this client. Use one of: ${[...client.customIntents.map((i) => i.key), ...STANDARD_INTENT_TYPES].join(", ")}.`
          );
        }
        const result = await createSearchCampaign({ ...args, requestedByTool: "create_search_campaign" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return handleGuardedResult(err);
      }
    }
  );

  server.tool(
    "update_campaign_budget",
    "Proposes changing a campaign's daily budget. Small changes (within the configured auto-approve % threshold) execute immediately; larger changes require human approval.",
    {
      ...targetShape,
      campaignId: z.string(),
      campaignResourceName: z.string(),
      budgetResourceName: z.string(),
      currentDailyBudget: z.number().positive(),
      newDailyBudget: z.number().positive(),
      affectsTopPerformer: z.boolean().default(false),
      reasoning: z.string().min(10),
    },
    async ({ clientId, ...args }) => {
      try {
        await assertMutationTarget({ clientId, customerId: args.customerId, accountId: args.accountId });
        assertResourceBelongsToCustomer(args.customerId, args.campaignResourceName);
        assertResourceBelongsToCustomer(args.customerId, args.budgetResourceName);
        const result = await updateCampaignBudget({ ...args, requestedByTool: "update_campaign_budget" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return handleGuardedResult(err);
      }
    }
  );

  server.tool(
    "pause_campaign",
    "Proposes pausing a campaign. LOW risk (and executes immediately) unless affectsTopPerformer is true, in which case it always requires human approval.",
    {
      ...targetShape,
      campaignResourceName: z.string(),
      affectsTopPerformer: z.boolean().default(false),
      reasoning: z.string().min(10),
    },
    async ({ clientId, ...args }) => {
      try {
        await assertMutationTarget({ clientId, customerId: args.customerId, accountId: args.accountId });
        assertResourceBelongsToCustomer(args.customerId, args.campaignResourceName);
        const result = await pauseCampaign({ ...args, requestedByTool: "pause_campaign" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return handleGuardedResult(err);
      }
    }
  );

  server.tool(
    "add_negative_keywords",
    "Adds negative keywords at ad-group or campaign scope. LOW risk — executes immediately even in hard approval mode, since negatives can only exclude traffic. Use analyze_search_terms first to find candidates. The target must belong to a linked account of the given client.",
    {
      ...targetShape,
      targetResourceName: z.string(),
      scope: z.enum(["AD_GROUP", "CAMPAIGN"]),
      keywords: z.array(z.object({ text: z.string(), matchType: z.enum(["EXACT", "PHRASE", "BROAD"]) })).min(1),
      reasoning: z.string().min(10),
    },
    async ({ clientId, ...args }) => {
      try {
        await assertMutationTarget({ clientId, customerId: args.customerId, accountId: args.accountId });
        assertResourceBelongsToCustomer(args.customerId, args.targetResourceName);
        const result = await addNegativeKeywords({ ...args, requestedByTool: "add_negative_keywords" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return handleGuardedResult(err);
      }
    }
  );
}
