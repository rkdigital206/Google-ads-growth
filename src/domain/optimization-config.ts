/**
 * Client-configurable optimization economics and thresholds.
 *
 * Brief section 31 is explicit: "Do not hide critical business logic
 * inside arbitrary JSON. Use typed configuration." This is that typed
 * configuration — it mirrors the Prisma `Client` model fields added in
 * this same change (see prisma/schema.prisma) so the domain type and the
 * persisted row shape stay in lockstep.
 *
 * Every field is nullable. A null here must be treated as "unknown" by
 * every downstream engine — never substituted with a plausible-looking
 * default (e.g. never assume targetCPA if the client hasn't configured
 * one; fall back to a clearly-labeled HISTORICAL_BENCHMARK computed from
 * the account's own data instead, which is future-phase diagnostic work,
 * not this layer's job).
 */

export interface OptimizationConfig {
  // --- Economics (brief section 4 "Commercial"/"Economics", section 31) ---
  targetCPA: number | null;
  targetROAS: number | null;
  averageOrderValue: number | null;
  grossMargin: number | null;
  profitPerSale: number | null;
  /** Expected value of a single lead. Distinct from lifetimeValue — never substituted for it. */
  leadValue: number | null;
  /** Customer lifetime value. Only used by LTV-based formulas (e.g. maxCac); never inferred from leadValue. */
  lifetimeValue: number | null;
  leadToSaleRate: number | null;
  monthlyBudget: number | null;

  // --- Sample-size protection thresholds (brief section 16) ---
  minimumClicks: number | null;
  minimumImpressions: number | null;
  minimumSpend: number | null;
  minimumConversions: number | null;
  minimumDays: number | null;

  // --- Risk / change limits (brief section 19, 25) ---
  /** Max single-step budget change, as a percentage (e.g. 20 = +/-20%), before requiring higher approval. */
  budgetChangeLimitPct: number | null;
}

export const DEFAULT_SAMPLE_SIZE_THRESHOLDS: Pick<
  OptimizationConfig,
  "minimumClicks" | "minimumImpressions" | "minimumSpend" | "minimumConversions" | "minimumDays"
> = {
  // These are conservative starting defaults for when a client hasn't
  // configured its own thresholds yet — NOT a substitute for economics
  // like targetCPA, which must never be defaulted. Sample-size minimums
  // are a data-sufficiency question, not a business-economics question,
  // so a generic conservative default is defensible here in a way it
  // would not be for e.g. targetCPA.
  minimumClicks: 30,
  minimumImpressions: 500,
  minimumSpend: 20,
  minimumConversions: 1,
  minimumDays: 7,
};

export const DEFAULT_BUDGET_CHANGE_LIMIT_PCT = 20;

/** All-unknown config — the correct starting state for a newly onboarded client before any economics are configured. */
export function emptyOptimizationConfig(): OptimizationConfig {
  return {
    targetCPA: null,
    targetROAS: null,
    averageOrderValue: null,
    grossMargin: null,
    profitPerSale: null,
    leadValue: null,
    lifetimeValue: null,
    leadToSaleRate: null,
    monthlyBudget: null,
    minimumClicks: null,
    minimumImpressions: null,
    minimumSpend: null,
    minimumConversions: null,
    minimumDays: null,
    budgetChangeLimitPct: null,
  };
}

/** Merges an explicit client config with the conservative sample-size/budget-limit defaults for anything left unconfigured. */
export function resolveOptimizationConfig(config: OptimizationConfig): OptimizationConfig {
  return {
    ...config,
    minimumClicks: config.minimumClicks ?? DEFAULT_SAMPLE_SIZE_THRESHOLDS.minimumClicks,
    minimumImpressions: config.minimumImpressions ?? DEFAULT_SAMPLE_SIZE_THRESHOLDS.minimumImpressions,
    minimumSpend: config.minimumSpend ?? DEFAULT_SAMPLE_SIZE_THRESHOLDS.minimumSpend,
    minimumConversions: config.minimumConversions ?? DEFAULT_SAMPLE_SIZE_THRESHOLDS.minimumConversions,
    minimumDays: config.minimumDays ?? DEFAULT_SAMPLE_SIZE_THRESHOLDS.minimumDays,
    budgetChangeLimitPct: config.budgetChangeLimitPct ?? DEFAULT_BUDGET_CHANGE_LIMIT_PCT,
  };
}
