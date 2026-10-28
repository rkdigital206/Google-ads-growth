/**
 * Business economics engine (Phase E section 14).
 *
 * Every function here is pure math over whatever OptimizationConfig fields
 * are actually filled in — no missing input is ever defaulted to a
 * plausible-looking number. A calculation that needs a null input returns
 * a result with `calculable: false` and states exactly which input is
 * missing, rather than silently omitting the figure or guessing.
 */

import type { OptimizationConfig } from "../domain/optimization-config.js";
import type { BusinessType } from "../domain/business-profile.js";

export interface EconomicsResult {
  metric: string;
  value: number | null;
  calculable: boolean;
  formula: string;
  assumptionsUsed: Record<string, number>;
  missingInputs: string[];
}

/**
 * Break-even ROAS = 1 / grossMargin. Below this ROAS, ad spend costs more
 * than the margin it generates — a foundational ecommerce number the
 * brief explicitly calls out (section 14).
 */
export function calculateBreakEvenRoas(config: OptimizationConfig): EconomicsResult {
  if (config.grossMargin === null) {
    return { metric: "breakEvenRoas", value: null, calculable: false, formula: "1 / grossMargin", assumptionsUsed: {}, missingInputs: ["grossMargin"] };
  }
  if (config.grossMargin <= 0 || config.grossMargin > 1) {
    return { metric: "breakEvenRoas", value: null, calculable: false, formula: "1 / grossMargin", assumptionsUsed: {}, missingInputs: ["grossMargin (must be expressed as a fraction between 0 and 1, e.g. 0.35 for 35%)"] };
  }
  return {
    metric: "breakEvenRoas",
    value: 1 / config.grossMargin,
    calculable: true,
    formula: "1 / grossMargin",
    assumptionsUsed: { grossMargin: config.grossMargin },
    missingInputs: [],
  };
}

/** Recommended target ROAS with a margin buffer above break-even, since bidding exactly at break-even leaves no room for measurement error or non-ad costs. */
export function calculateTargetRoas(config: OptimizationConfig, bufferMultiplier = 1.3): EconomicsResult {
  const breakEven = calculateBreakEvenRoas(config);
  if (!breakEven.calculable || breakEven.value === null) {
    return { metric: "targetRoas", value: null, calculable: false, formula: `breakEvenRoas × ${bufferMultiplier}`, assumptionsUsed: {}, missingInputs: breakEven.missingInputs };
  }
  if (config.targetROAS !== null) {
    // The client already told us their target — use it, don't override with our own derived number.
    return { metric: "targetRoas", value: config.targetROAS, calculable: true, formula: "client-configured targetROAS (not derived)", assumptionsUsed: {}, missingInputs: [] };
  }
  return {
    metric: "targetRoas",
    value: breakEven.value * bufferMultiplier,
    calculable: true,
    formula: `breakEvenRoas (${breakEven.value.toFixed(2)}) × buffer (${bufferMultiplier})`,
    assumptionsUsed: { grossMargin: config.grossMargin ?? 0, bufferMultiplier },
    missingInputs: [],
  };
}

/** Max CPA a lead-gen/service business can afford = leadValue × leadToSaleRate, i.e. the expected customer value per lead. */
export function calculateMaxCpa(config: OptimizationConfig): EconomicsResult {
  const missing: string[] = [];
  if (config.leadValue === null) missing.push("leadValue");
  if (config.leadToSaleRate === null) missing.push("leadToSaleRate");
  if (missing.length > 0) {
    return { metric: "maxCpa", value: null, calculable: false, formula: "leadValue × leadToSaleRate", assumptionsUsed: {}, missingInputs: missing };
  }
  const value = (config.leadValue as number) * (config.leadToSaleRate as number);
  return {
    metric: "maxCpa",
    value,
    calculable: true,
    formula: "leadValue × leadToSaleRate",
    assumptionsUsed: { leadValue: config.leadValue as number, leadToSaleRate: config.leadToSaleRate as number },
    missingInputs: [],
  };
}

/** Recommended target CPA with a safety margin below max CPA (bidding right up to max CPA leaves zero room for measurement noise or non-ad costs). */
export function calculateTargetCpa(config: OptimizationConfig, safetyMargin = 0.8): EconomicsResult {
  if (config.targetCPA !== null) {
    return { metric: "targetCpa", value: config.targetCPA, calculable: true, formula: "client-configured targetCPA (not derived)", assumptionsUsed: {}, missingInputs: [] };
  }
  const maxCpa = calculateMaxCpa(config);
  if (!maxCpa.calculable || maxCpa.value === null) {
    return { metric: "targetCpa", value: null, calculable: false, formula: `maxCpa × ${safetyMargin}`, assumptionsUsed: {}, missingInputs: maxCpa.missingInputs };
  }
  return {
    metric: "targetCpa",
    value: maxCpa.value * safetyMargin,
    calculable: true,
    formula: `maxCpa (${maxCpa.value.toFixed(2)}) × safetyMargin (${safetyMargin})`,
    assumptionsUsed: { leadValue: config.leadValue as number, leadToSaleRate: config.leadToSaleRate as number, safetyMargin },
    missingInputs: [],
  };
}

/**
 * Max customer-acquisition cost = lifetimeValue × leadToSaleRate.
 *
 * lifetimeValue and leadToSaleRate must BOTH be explicitly configured.
 * Phase E treated leadValue as LTV and defaulted leadToSaleRate to 1.0;
 * E.1 removes both silent substitutions. leadValue (value of one lead) and
 * lifetimeValue (value of a whole customer relationship) are different
 * quantities and are never interchanged.
 */
export function calculateMaxCac(config: OptimizationConfig): EconomicsResult {
  const formula = "lifetimeValue × leadToSaleRate";
  const missing: string[] = [];
  if (config.lifetimeValue === null) missing.push("lifetimeValue");
  if (config.leadToSaleRate === null) missing.push("leadToSaleRate");
  if (missing.length > 0) {
    return { metric: "maxCac", value: null, calculable: false, formula, assumptionsUsed: {}, missingInputs: missing };
  }
  const lifetimeValue = config.lifetimeValue as number;
  const leadToSaleRate = config.leadToSaleRate as number;
  return {
    metric: "maxCac",
    value: lifetimeValue * leadToSaleRate,
    calculable: true,
    formula,
    assumptionsUsed: { lifetimeValue, leadToSaleRate },
    missingInputs: [],
  };
}

export interface BusinessEconomicsSummary {
  businessType: BusinessType | null;
  breakEvenRoas: EconomicsResult | null;
  targetRoas: EconomicsResult | null;
  maxCpa: EconomicsResult | null;
  targetCpa: EconomicsResult | null;
  maxCac: EconomicsResult | null;
}

/** Runs the subset of calculations relevant to the client's declared business type — an ecommerce client doesn't need a CAC/LTV calculation and vice versa. */
export function calculateBusinessEconomics(businessType: BusinessType | null, config: OptimizationConfig): BusinessEconomicsSummary {
  const isEcommerceLike = businessType === "ECOMMERCE" || businessType === "MARKETPLACE";
  const isLeadLike = businessType === "LEAD_GENERATION" || businessType === "LOCAL_SERVICE" || businessType === "PROFESSIONAL_SERVICES" || businessType === "REAL_ESTATE" || businessType === "B2B" || businessType === "EDUCATION" || businessType === "HEALTHCARE";
  const isSaasLike = businessType === "SAAS";

  return {
    businessType,
    breakEvenRoas: isEcommerceLike ? calculateBreakEvenRoas(config) : null,
    targetRoas: isEcommerceLike ? calculateTargetRoas(config) : null,
    maxCpa: isLeadLike ? calculateMaxCpa(config) : null,
    targetCpa: isLeadLike ? calculateTargetCpa(config) : null,
    maxCac: isSaasLike ? calculateMaxCac(config) : null,
  };
}
