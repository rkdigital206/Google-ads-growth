/**
 * Progressive onboarding engine (Phase E section 5).
 *
 * Does NOT ask a fixed 30-question form. Given whatever partial
 * BusinessProfile + OptimizationConfig the client has supplied so far,
 * this determines the SPECIFIC next questions needed — different for an
 * ecommerce business than for a local service business — and reports how
 * complete the profile currently is.
 *
 * This module has no side effects and does not persist anything; it's a
 * pure function over (BusinessProfile, OptimizationConfig) -> report. The
 * MCP tool layer (mcp/tools/onboarding-tools.ts, added this phase) is
 * responsible for actually calling client-repo.ts to persist answers.
 */

import type { BusinessProfile, BusinessType } from "../domain/business-profile.js";
import type { OptimizationConfig } from "../domain/optimization-config.js";

export interface OnboardingQuestion {
  field: string;
  question: string;
  /** Why this question matters for THIS business type, not generic filler copy. */
  rationale: string;
  required: boolean;
}

export interface OnboardingCompletenessReport {
  /** 0-1. Weighted by how many required-for-this-business-type fields are filled. */
  completeness: number;
  readyForResearch: boolean;
  readyForEconomicsCalculation: boolean;
  nextQuestions: OnboardingQuestion[];
  missingCriticalFields: string[];
}

/**
 * Business-type-specific required fields, beyond the universal minimum
 * (name, website, industry). This is the "intelligent progressive
 * onboarding" logic from section 5's examples — ecommerce needs AOV/margin,
 * lead-gen needs lead value/close rate, etc.
 */
function requiredEconomicsFieldsFor(businessType: BusinessType | null): {
  field: keyof OptimizationConfig;
  question: string;
  rationale: string;
}[] {
  switch (businessType) {
    case "ECOMMERCE":
      return [
        { field: "averageOrderValue", question: "What is your average order value?", rationale: "Needed to compute break-even ROAS and set a realistic target ROAS." },
        { field: "grossMargin", question: "What is your gross margin (%) on a typical order?", rationale: "Break-even ROAS is meaningless without margin — revenue ROAS alone can hide an unprofitable campaign." },
        { field: "targetROAS", question: "Do you have a target ROAS in mind, or should we calculate one from your margin?", rationale: "If you don't have one, the economics engine can derive a break-even ROAS from margin alone." },
      ];
    case "LEAD_GENERATION":
    case "LOCAL_SERVICE":
    case "PROFESSIONAL_SERVICES":
    case "REAL_ESTATE":
      return [
        { field: "leadValue", question: "What is a lead worth to you, on average?", rationale: "Required to set a defensible target CPA — without it, any CPA target is a guess." },
        { field: "leadToSaleRate", question: "What percentage of leads typically convert into paying customers?", rationale: "Lead value alone overstates profitability if most leads don't close — needed to compute true customer value." },
        { field: "targetCPA", question: "Do you have a target cost-per-lead/CPA already, or should we calculate one?", rationale: "If not supplied, the economics engine derives max CPA from lead value × close rate." },
      ];
    case "SAAS":
      return [
        { field: "lifetimeValue", question: "What is the average lifetime value (LTV) of a customer?", rationale: "SaaS economics (max CAC) require LTV — stored as lifetimeValue, never conflated with the value of a single lead." },
        { field: "leadToSaleRate", question: "What percentage of trial/demo signups convert to paying customers?", rationale: "Needed to translate a per-signup ad cost into a real CAC." },
      ];
    default:
      return [
        { field: "targetCPA", question: "Do you have a target cost-per-conversion or ROAS in mind?", rationale: "Without a business-type classification yet, we can't derive a specific economics question — this is a fallback." },
      ];
  }
}

export function assessOnboardingCompleteness(
  profile: BusinessProfile,
  config: OptimizationConfig
): OnboardingCompletenessReport {
  const universalRequired: { field: string; filled: boolean; question: OnboardingQuestion }[] = [
    {
      field: "clientName",
      filled: profile.clientName.trim().length > 0,
      question: { field: "clientName", question: "What is the business name?", rationale: "Universal minimum — needed for every downstream operation.", required: true },
    },
    {
      field: "website",
      filled: profile.website !== null,
      question: { field: "website", question: "What is the business website URL?", rationale: "Website intelligence (research/engines/website-intelligence.ts) cannot run without it.", required: true },
    },
    {
      field: "businessType",
      filled: profile.businessType !== null,
      question: {
        field: "businessType",
        question: "Which best describes the business: ecommerce, lead generation, local service, SaaS, B2B, marketplace, professional services, education, healthcare, real estate, or travel?",
        rationale: "Determines which economics questions and audit checks actually apply — asking ecommerce AOV questions to a lead-gen business wastes their time and yours.",
        required: true,
      },
    },
    {
      field: "primaryConversionGoal",
      filled: profile.primaryConversionGoal !== null,
      question: { field: "primaryConversionGoal", question: "What is the primary conversion goal for Google Ads (leads, sales, calls, bookings, etc.)?", rationale: "The optimization objective must come from the business, never be assumed (e.g. defaulting everyone to ROAS).", required: true },
    },
    {
      field: "currency",
      filled: profile.currency !== null,
      question: { field: "currency", question: "What currency should budgets/costs be reported in?", rationale: "Every cost figure downstream is meaningless without a confirmed currency — this should also be cross-checked against the actual Google Ads account currency during discovery, not just taken on faith.", required: true },
    },
    {
      field: "locations",
      filled: profile.locations.length > 0,
      question: { field: "locations", question: "Which locations/markets does the business serve?", rationale: "Needed for geographic trend relevance and to avoid recommending targeting outside the service area.", required: true },
    },
  ];

  const economicsQuestions = requiredEconomicsFieldsFor(profile.businessType).filter((q) => config[q.field] === null);

  const nextQuestions: OnboardingQuestion[] = [
    ...universalRequired.filter((u) => !u.filled).map((u) => u.question),
    ...economicsQuestions.map((q) => ({ field: q.field, question: q.question, rationale: q.rationale, required: false })),
  ];

  const filledUniversal = universalRequired.filter((u) => u.filled).length;
  const totalUniversal = universalRequired.length;
  const filledEconomics = requiredEconomicsFieldsFor(profile.businessType).length - economicsQuestions.length;
  const totalEconomics = requiredEconomicsFieldsFor(profile.businessType).length;

  const totalFields = totalUniversal + totalEconomics;
  const filledFields = filledUniversal + filledEconomics;
  const completeness = totalFields === 0 ? 0 : filledFields / totalFields;

  const missingCriticalFields = universalRequired.filter((u) => !u.filled).map((u) => u.field);

  return {
    completeness,
    // Research (website/trend/keyword/competitor) only needs the universal
    // minimum — it doesn't need economics numbers to run.
    readyForResearch: missingCriticalFields.length === 0,
    // Economics calculations specifically need the business-type-specific
    // fields filled too.
    readyForEconomicsCalculation: missingCriticalFields.length === 0 && economicsQuestions.length === 0,
    nextQuestions,
    missingCriticalFields,
  };
}
