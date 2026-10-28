/**
 * SEED / FIXTURE DATA — NOT a hardcoded architecture dependency.
 *
 * Murooj Al Rabee Used Appliances is the pilot client used to validate this
 * system. This file expresses that client entirely as data on the GENERIC
 * domain model (BusinessProfile + CustomIntentDefinition) — nothing in
 * src/domain/ or src/performance/ knows Murooj, "BUY", "SELL", "used
 * appliances", Dubai, or AED exist. Delete this file and the rest of the
 * system still compiles and works for any other client.
 *
 * This is also currently the source that strategy/business-analysis.ts
 * re-exports as PILOT_CLIENT, to keep audit-tools.ts and
 * search-term-optimizer.ts compiling unchanged in this phase. Once client
 * data moves into the database (database/repositories/client-repo.ts),
 * this fixture should remain only as test data, clearly marked as such —
 * per the brief's instruction not to use fabricated test data as real
 * client performance.
 */

import { createBusinessProfile, type BusinessProfile } from "../business-profile.js";
import type { CustomIntentDefinition } from "../intent.js";
import { emptyOptimizationConfig, type OptimizationConfig } from "../optimization-config.js";

const MUROOJ_BUY_INTENT: CustomIntentDefinition = {
  key: "BUY",
  label: "Buy",
  description: "Consumer wants to purchase a used appliance.",
  exampleQueries: [
    "used fridge dubai",
    "second hand refrigerator dubai",
    "used washing machine dubai",
    "used appliances dubai",
    "cheap used appliances dubai",
  ],
  conversionGoal: "Phone call, WhatsApp inquiry, or store visit lead for a purchase — commercial buy-side conversion.",
  signalWords: ["buy", "used", "second hand", "cheap", "price", "for sale", "shop"],
};

const MUROOJ_SELL_INTENT: CustomIntentDefinition = {
  key: "SELL",
  label: "Sell",
  description: "Consumer wants to sell their used appliance to the business.",
  exampleQueries: [
    "sell used fridge dubai",
    "sell washing machine dubai",
    "used appliance buyer dubai",
    "where to sell used appliances dubai",
    "sell second hand appliances dubai",
  ],
  conversionGoal: "Phone call or WhatsApp inquiry offering to sell an appliance — supply-side lead, feeds inventory.",
  signalWords: ["sell", "sale my", "buyer", "who buys", "cash for", "where to sell", "pickup"],
};

export const MUROOJ_PROFILE: BusinessProfile = createBusinessProfile({
  clientName: "Murooj Al Rabee Used Appliances",
  website: "https://www.mrusedappliances.com/",
  industry: "Used / second-hand home appliances (refrigerators, washing machines, ovens, cookers, dishwashers)",
  businessModel:
    "Dealer in used home appliances — sells refurbished/second-hand units to consumers, and separately buys used appliances from consumers to resell.",
  productsOrServices: ["Refrigerators", "Washing Machines", "Ovens & Cookers", "Dishwashers"],
  locations: [{ city: "Dubai", country: "United Arab Emirates" }],
  customIntents: [MUROOJ_BUY_INTENT, MUROOJ_SELL_INTENT],
  openQuestionsForAudit: [
    "Are BUY and SELL intent currently in separate campaigns, or mixed within the same 2 existing campaigns?",
    "Is there a working conversion action for phone calls / WhatsApp clicks, or only a generic 'page view' style goal?",
    "Does the landing page differ for BUY vs SELL traffic, or does all traffic land on the same homepage?",
    "What is the actual sale value / margin per appliance category? Needed to set a real CPA or ROAS target instead of optimizing to clicks.",
    "Is Search Partners / Display currently enabled on either campaign, diluting Search intent data?",
  ],
});

// Deliberately left as an empty/unknown config — Murooj's actual targetCPA,
// AOV, margin, etc. have not been supplied yet. Per the "never invent
// missing economics" rule, this stays all-null until the client actually
// configures it, not until it would be convenient for a demo.
export const MUROOJ_OPTIMIZATION_CONFIG: OptimizationConfig = emptyOptimizationConfig();
