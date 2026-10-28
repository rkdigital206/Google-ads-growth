/**
 * Generic business profile — what the onboarding engine (future phase)
 * collects or discovers about ANY client, not just the pilot.
 *
 * Nothing here assumes an industry, a country, a currency, or a specific
 * conversion type. Unknown fields are `null`/omitted rather than guessed —
 * per the brief's "never invent missing economics" rule, that discipline
 * belongs at the type level too: every optional field here is genuinely
 * optional, not defaulted to a plausible-looking value.
 */

import type { CustomIntentDefinition } from "./intent.js";

export interface BusinessLocation {
  city: string;
  region?: string;
  country: string;
  /** Free-form service radius description, e.g. "citywide", "50km radius". Unknown if not configured. */
  serviceRadius?: string;
}

/**
 * Broad business type — used by the onboarding engine (onboarding/engine.ts)
 * to decide which follow-up questions to ask. Deliberately coarse; a
 * business can be more than one of these (e.g. an ecommerce business that
 * also does local pickup) — this is a primary classification, not an
 * exhaustive one.
 */
export const BUSINESS_TYPES = [
  "ECOMMERCE",
  "LEAD_GENERATION",
  "LOCAL_SERVICE",
  "SAAS",
  "B2B",
  "MARKETPLACE",
  "PROFESSIONAL_SERVICES",
  "EDUCATION",
  "HEALTHCARE",
  "REAL_ESTATE",
  "TRAVEL",
  "OTHER",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const GROWTH_GOALS = [
  "INCREASE_REVENUE",
  "INCREASE_LEAD_VOLUME",
  "INCREASE_LEAD_QUALITY",
  "REDUCE_CAC",
  "ENTER_NEW_MARKET",
  "LAUNCH_NEW_PRODUCT",
  "IMPROVE_ROAS",
  "OTHER",
] as const;

export type GrowthGoal = (typeof GROWTH_GOALS)[number];

export const TRACKING_STATUSES = ["NOT_CONFIGURED", "PARTIALLY_CONFIGURED", "CONFIGURED_UNVERIFIED", "CONFIGURED_VERIFIED", "UNKNOWN"] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

/**
 * The business outcome Google Ads should be optimized toward. Deliberately
 * NOT defaulted to ROAS or CPA — the objective must come from the client's
 * actual business model (brief section 33).
 */
export const CONVERSION_GOAL_TYPES = [
  "LEAD_GENERATION",
  "ECOMMERCE_REVENUE",
  "PROFIT",
  "ROAS",
  "CPA",
  "CONVERSION_VOLUME",
  "QUALIFIED_LEADS",
  "PHONE_CALLS",
  "BOOKINGS",
  "STORE_VISITS",
] as const;

export type ConversionGoalType = (typeof CONVERSION_GOAL_TYPES)[number];

export interface BusinessProfile {
  clientName: string;
  website: string | null;
  industry: string | null;
  subIndustry: string | null;
  businessType: BusinessType | null;
  businessModel: string | null;
  productsOrServices: string[];
  primaryOffers: string[];
  locations: BusinessLocation[];
  targetCountries: string[];
  languages: string[];
  currency: string | null;

  /** Primary business goal for Google Ads — see ConversionGoalType. Null until onboarding confirms it. */
  primaryConversionGoal: ConversionGoalType | null;
  secondaryConversions: string[];
  growthGoal: GrowthGoal | null;
  /** Free-form description of the typical sales cycle length, e.g. "same-day", "2-4 weeks". Null if unknown. */
  salesCycle: string | null;
  /** Free-form seasonality notes the client has reported — NOT a substitute for the trend engine's own seasonality detection (research/engines/trend-intelligence.ts), which derives seasonality from actual data. */
  reportedSeasonality: string | null;
  brandVoice: string | null;
  trackingStatus: TrackingStatus;
  /** Things the agent must not do for this client (e.g. "never mention discounts", "do not target competitor brand terms"). */
  restrictions: string[];

  /**
   * Client-specific business intents beyond the standard IntentType set
   * (e.g. Murooj's BUY vs SELL). Empty array is valid and common — most
   * clients will rely on STANDARD_INTENT_TYPES alone.
   */
  customIntents: CustomIntentDefinition[];

  /**
   * Findings populated by the actual account/website audit, never assumed
   * up front. Left empty at onboarding time.
   */
  knownBottlenecks: string[];

  /** Open questions the audit must resolve before optimization recommendations can be trusted for this client. */
  openQuestionsForAudit: string[];
}

/** Convenience constructor enforcing the "don't invent defaults" rule at the call site. */
export function createBusinessProfile(input: {
  clientName: string;
  website?: string;
  industry?: string;
  subIndustry?: string;
  businessType?: BusinessType;
  businessModel?: string;
  productsOrServices?: string[];
  primaryOffers?: string[];
  locations?: BusinessLocation[];
  targetCountries?: string[];
  languages?: string[];
  currency?: string;
  primaryConversionGoal?: ConversionGoalType;
  secondaryConversions?: string[];
  growthGoal?: GrowthGoal;
  salesCycle?: string;
  reportedSeasonality?: string;
  brandVoice?: string;
  trackingStatus?: TrackingStatus;
  restrictions?: string[];
  customIntents?: CustomIntentDefinition[];
  openQuestionsForAudit?: string[];
}): BusinessProfile {
  return {
    clientName: input.clientName,
    website: input.website ?? null,
    industry: input.industry ?? null,
    subIndustry: input.subIndustry ?? null,
    businessType: input.businessType ?? null,
    businessModel: input.businessModel ?? null,
    productsOrServices: input.productsOrServices ?? [],
    primaryOffers: input.primaryOffers ?? [],
    locations: input.locations ?? [],
    targetCountries: input.targetCountries ?? [],
    languages: input.languages ?? [],
    currency: input.currency ?? null,
    primaryConversionGoal: input.primaryConversionGoal ?? null,
    secondaryConversions: input.secondaryConversions ?? [],
    growthGoal: input.growthGoal ?? null,
    salesCycle: input.salesCycle ?? null,
    reportedSeasonality: input.reportedSeasonality ?? null,
    brandVoice: input.brandVoice ?? null,
    trackingStatus: input.trackingStatus ?? "UNKNOWN",
    restrictions: input.restrictions ?? [],
    customIntents: input.customIntents ?? [],
    knownBottlenecks: [],
    openQuestionsForAudit: input.openQuestionsForAudit ?? [],
  };
}
