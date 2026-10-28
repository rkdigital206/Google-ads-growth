import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient, updateClientFields, getClientById, toLoadedClient, type ClientProfileInput } from "../../database/repositories/client-repo.js";
import { assessOnboardingCompleteness } from "../../onboarding/engine.js";
import { BUSINESS_TYPES, CONVERSION_GOAL_TYPES, GROWTH_GOALS, TRACKING_STATUSES } from "../../domain/business-profile.js";
import { toToolErrorMessage } from "../../utils/errors.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ module: "onboarding-tools" });

const locationSchema = z.object({
  city: z.string().min(1),
  region: z.string().optional(),
  country: z.string().min(1),
  serviceRadius: z.string().optional().describe('Free-form, e.g. "citywide" or "50km radius".'),
});

const customIntentSchema = z.object({
  key: z.string().min(1).describe('Short unique key, e.g. "TRIAL_INTENT" or "EMERGENCY".'),
  label: z.string(),
  description: z.string(),
  exampleQueries: z.array(z.string()).default([]),
  conversionGoal: z.string(),
  signalWords: z.array(z.string()).describe("Lowercase phrases that signal this intent in a search term."),
});

/**
 * The complete set of persistable onboarding fields. Shared by onboard_client
 * and update_client_profile so the two can never drift apart. Everything is
 * optional here; onboard_client adds the required `name`.
 */
const profileFieldsShape = {
  website: z.string().url().optional(),
  industry: z.string().optional(),
  subIndustry: z.string().optional(),
  businessType: z.enum(BUSINESS_TYPES).optional().describe("Coarse classification — drives which follow-up questions apply."),
  businessModel: z.string().optional(),
  productsOrServices: z.array(z.string()).optional().describe("REPLACES the stored list when supplied."),
  primaryOffers: z.array(z.string()).optional().describe("REPLACES the stored list when supplied."),
  locations: z.array(locationSchema).optional().describe("REPLACES all stored locations when supplied. Pass [] to clear."),
  targetCountries: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  currency: z.string().length(3).optional().describe("ISO 4217 code, e.g. USD, AED, PKR."),
  primaryConversionGoal: z.enum(CONVERSION_GOAL_TYPES).optional(),
  secondaryConversions: z.array(z.string()).optional(),
  growthGoal: z.enum(GROWTH_GOALS).optional(),
  salesCycle: z.string().optional(),
  reportedSeasonality: z.string().optional(),
  brandVoice: z.string().optional(),
  trackingStatus: z.enum(TRACKING_STATUSES).optional(),
  restrictions: z.array(z.string()).optional(),
  customIntents: z.array(customIntentSchema).optional().describe("REPLACES the client's custom intent definitions when supplied."),

  // Economics — each field is semantically distinct; none is ever derived from another here.
  targetCPA: z.number().positive().optional(),
  targetROAS: z.number().positive().optional(),
  averageOrderValue: z.number().positive().optional(),
  grossMargin: z.number().gt(0).lte(1).optional().describe("Fraction in (0,1], e.g. 0.35 for 35%."),
  profitPerSale: z.number().positive().optional(),
  leadValue: z.number().positive().optional().describe("Expected value of ONE lead. Not lifetime value."),
  lifetimeValue: z.number().positive().optional().describe("Customer lifetime value. Not the value of one lead."),
  leadToSaleRate: z.number().gt(0).lte(1).optional().describe("Fraction in (0,1]."),
  monthlyBudget: z.number().positive().optional(),

  // Optimization thresholds
  minimumClicks: z.number().int().nonnegative().optional(),
  minimumImpressions: z.number().int().nonnegative().optional(),
  minimumSpend: z.number().nonnegative().optional(),
  minimumConversions: z.number().int().nonnegative().optional(),
  minimumDays: z.number().int().positive().optional(),
  budgetChangeLimitPct: z.number().positive().max(100).optional(),
} as const;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

export function registerOnboardingTools(server: McpServer) {
  server.tool(
    "onboard_client",
    "Creates a new generic client with whatever onboarding fields are already known. Every supported profile, economics and threshold field persists (products/services, locations, offers, languages, restrictions, custom intents, tracking status, ...). Only supplied fields are set — nothing is guessed. Returns the stored client plus an OnboardingCompletenessReport listing exactly what to ask next. Works for any business type; nothing here is specific to one client.",
    { name: z.string().min(1).describe("Business name."), ...profileFieldsShape },
    async (input) => {
      try {
        const row = await createClient(input as unknown as Parameters<typeof createClient>[0]);
        const loaded = toLoadedClient(row);
        const completeness = assessOnboardingCompleteness(loaded.profile, loaded.optimizationConfig);
        return text({ clientId: row.id, profile: loaded.profile, optimizationConfig: loaded.optimizationConfig, onboardingCompleteness: completeness });
      } catch (err) {
        log.error({ err }, "onboard_client failed");
        return { ...text(toToolErrorMessage(err)), isError: true };
      }
    }
  );

  server.tool(
    "get_client_profile",
    "Returns the full stored business profile (including products/services and locations), optimization config, linked-account-independent economics inputs, and current onboarding completeness for a client ID.",
    { clientId: z.string() },
    async ({ clientId }) => {
      try {
        const result = await getClientById(clientId);
        if (!result) return { ...text(`No client found with id ${clientId}`), isError: true };
        const completeness = assessOnboardingCompleteness(result.profile, result.optimizationConfig);
        return text({ clientId, profile: result.profile, optimizationConfig: result.optimizationConfig, onboardingCompleteness: completeness });
      } catch (err) {
        log.error({ err, clientId }, "get_client_profile failed");
        return { ...text(toToolErrorMessage(err)), isError: true };
      }
    }
  );

  server.tool(
    "update_client_profile",
    "PARTIAL update of any onboarding field on an existing client: only the fields you supply change; everything else is left untouched. List-valued fields (productsOrServices, primaryOffers, locations, targetCountries, languages, secondaryConversions, restrictions, customIntents) REPLACE the stored list when supplied — send the full desired list, or [] to clear. No need to recreate a client to add products, locations, offers, intents, thresholds, etc.",
    { clientId: z.string(), name: z.string().min(1).optional(), ...profileFieldsShape },
    async ({ clientId, ...fields }) => {
      try {
        const existing = await getClientById(clientId);
        if (!existing) return { ...text(`No client found with id ${clientId}`), isError: true };
        const row = await updateClientFields(clientId, fields as ClientProfileInput);
        const loaded = toLoadedClient(row);
        const completeness = assessOnboardingCompleteness(loaded.profile, loaded.optimizationConfig);
        return text({ clientId, profile: loaded.profile, optimizationConfig: loaded.optimizationConfig, onboardingCompleteness: completeness });
      } catch (err) {
        log.error({ err, clientId }, "update_client_profile failed");
        return { ...text(toToolErrorMessage(err)), isError: true };
      }
    }
  );
}
