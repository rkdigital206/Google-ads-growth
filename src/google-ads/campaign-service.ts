import { toMicros } from "../utils/validation.js";
import { guardedMutate } from "../safety/mutation-guard.js";
import type { PolicyCheckInput } from "../safety/approval-policy.js";

export interface CreateSearchCampaignInput {
  customerId: string;
  accountId: string; // internal DB id, for the audit trail
  campaignName: string;
  dailyBudget: number; // in the account's own currency
  /** The client-defined (or standard) intent this campaign targets, e.g. a custom-intent key. Validated against the client's intents by the calling tool. */
  intent: string;
  biddingStrategy: "MAXIMIZE_CONVERSIONS" | "MAXIMIZE_CONVERSION_VALUE" | "MANUAL_CPC";
  reasoning: string;
  requestedByTool: string;
}

/**
 * Creates a paused Search campaign + its budget. Deliberately created PAUSED
 * — enabling a brand-new campaign is a separate, explicit step, so nothing
 * ever starts spending purely as a side effect of "creation" being approved.
 *
 * This always classifies as HIGH risk (see risk-engine.ts) and will require
 * human approval in hard mode.
 */
export async function createSearchCampaign(input: CreateSearchCampaignInput) {
  // Naming convention enforces intent visibility even before any custom
  // label/taxonomy system is built: e.g. "SEARCH - <INTENT_KEY> - <name>"
  const namePrefix = `SEARCH - ${input.intent} -`;
  const fullName = input.campaignName.startsWith(namePrefix)
    ? input.campaignName
    : `${namePrefix} ${input.campaignName}`;

  const policyInput: Omit<PolicyCheckInput, "accountId"> = {
    mutation: { resourceType: "campaign", operation: "CREATE" },
    proposedState: {
      name: fullName,
      dailyBudgetMicros: toMicros(input.dailyBudget),
      biddingStrategy: input.biddingStrategy,
      intent: input.intent,
      status: "PAUSED",
    },
    reasoning: input.reasoning,
    requestedByTool: input.requestedByTool,
  };

  return guardedMutate({
    customerId: input.customerId,
    accountId: input.accountId,
    ...policyInput,
    execute: async (customer) => {
      const budgetResourceName = await customer.campaignBudgets.create([
        {
          name: `Budget - ${fullName}`,
          amount_micros: toMicros(input.dailyBudget),
          delivery_method: "STANDARD",
        },
      ]);

      const campaignResourceName = await customer.campaigns.create([
        {
          name: fullName,
          status: "PAUSED",
          advertising_channel_type: "SEARCH",
          campaign_budget: budgetResourceName.results[0]?.resource_name,
          // NOTE: exact bidding-strategy payload shape must be verified
          // against the live v25 API reference before first real run —
          // Maximize Conversions / Conversion Value require target
          // objects that differ from manual CPC. Left explicit here
          // rather than guessed.
          bidding_strategy_type: input.biddingStrategy,
          network_settings: {
            target_google_search: true,
            target_search_network: false, // conservative default: keep Search Partners off until proven
            target_content_network: false,
          },
        },
      ]);

      return campaignResourceName.results.map((r) => r.resource_name).filter((n): n is string => typeof n === "string");
    },
  });
}

export interface UpdateBudgetInput {
  customerId: string;
  accountId: string;
  campaignId: string;
  campaignResourceName: string;
  budgetResourceName: string;
  currentDailyBudget: number;
  newDailyBudget: number;
  affectsTopPerformer: boolean;
  reasoning: string;
  requestedByTool: string;
}

export async function updateCampaignBudget(input: UpdateBudgetInput) {
  const changePct =
    ((input.newDailyBudget - input.currentDailyBudget) / input.currentDailyBudget) * 100;

  return guardedMutate({
    customerId: input.customerId,
    accountId: input.accountId,
    mutation: {
      resourceType: "budget",
      operation: "UPDATE",
      changePct,
      newDailyBudget: input.newDailyBudget,
      affectsTopPerformer: input.affectsTopPerformer,
    },
    proposedState: {
      campaignId: input.campaignId,
      newDailyBudgetMicros: toMicros(input.newDailyBudget),
      changePct: Number(changePct.toFixed(1)),
    },
    beforeState: { currentDailyBudget: input.currentDailyBudget },
    reasoning: input.reasoning,
    requestedByTool: input.requestedByTool,
    execute: async (customer) => {
      const result = await customer.campaignBudgets.update([
        {
          resource_name: input.budgetResourceName,
          amount_micros: toMicros(input.newDailyBudget),
        },
      ]);
      return result.results.map((r) => r.resource_name).filter((n): n is string => typeof n === "string");
    },
  });
}

export interface PauseCampaignInput {
  customerId: string;
  accountId: string;
  campaignResourceName: string;
  affectsTopPerformer: boolean;
  reasoning: string;
  requestedByTool: string;
}

export async function pauseCampaign(input: PauseCampaignInput) {
  return guardedMutate({
    customerId: input.customerId,
    accountId: input.accountId,
    mutation: {
      resourceType: "campaign",
      operation: "PAUSE",
      affectsTopPerformer: input.affectsTopPerformer,
    },
    proposedState: { campaignResourceName: input.campaignResourceName, status: "PAUSED" },
    reasoning: input.reasoning,
    requestedByTool: input.requestedByTool,
    execute: async (customer) => {
      const result = await customer.campaigns.update([
        { resource_name: input.campaignResourceName, status: "PAUSED" },
      ]);
      return result.results.map((r) => r.resource_name).filter((n): n is string => typeof n === "string");
    },
  });
}
