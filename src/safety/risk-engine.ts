import { env } from "../config/env.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ProposedMutation {
  resourceType:
    | "campaign"
    | "ad_group"
    | "keyword"
    | "negative_keyword"
    | "ad"
    | "budget"
    | "bid_strategy";
  operation: "CREATE" | "UPDATE" | "PAUSE" | "REMOVE" | "ENABLE";
  /** Only relevant for budget/bid UPDATE operations. */
  changePct?: number;
  /** Only relevant for budget UPDATE/CREATE — absolute new daily budget in account currency. */
  newDailyBudget?: number;
  /** Was this campaign/ad group flagged as a top performer in the last snapshot? */
  affectsTopPerformer?: boolean;
}

export interface RiskAssessment {
  riskLevel: RiskLevel;
  reasons: string[];
}

/**
 * Pure, deterministic risk classification. No I/O, no Google Ads calls —
 * this makes it trivially unit-testable and means the risk logic can never
 * be silently bypassed by a network error.
 *
 * The policy encoded here reflects the priority stated in the project brief:
 * never blindly optimize clicks/CTR, and never let an agent make an
 * unsupervised change with outsized blast radius on a live client account.
 */
export function assessRisk(mutation: ProposedMutation): RiskAssessment {
  const reasons: string[] = [];

  // Campaign creation and removal are always HIGH — new spend commitment
  // or the permanent loss of historical optimization data.
  if (mutation.resourceType === "campaign") {
    if (mutation.operation === "CREATE") {
      reasons.push("Creating a new campaign commits new budget and cannot be silently undone.");
      return { riskLevel: "HIGH", reasons };
    }
    if (mutation.operation === "REMOVE") {
      reasons.push("Removing a campaign is destructive and loses historical performance context.");
      return { riskLevel: "HIGH", reasons };
    }
  }

  // Pausing anything already flagged as a top performer is HIGH regardless
  // of resource type — this is the classic "AI optimized away the thing
  // that was actually working" failure mode.
  if (mutation.operation === "PAUSE" && mutation.affectsTopPerformer) {
    reasons.push("Target is a flagged top performer; pausing it risks losing proven revenue/leads.");
    return { riskLevel: "HIGH", reasons };
  }

  // Budget changes: risk scales with magnitude, per AUTO_APPROVE_BUDGET_CHANGE_PCT_MAX.
  if (mutation.resourceType === "budget") {
    const pct = Math.abs(mutation.changePct ?? 0);
    if (mutation.newDailyBudget && mutation.newDailyBudget > env.DEFAULT_MAX_DAILY_BUDGET) {
      reasons.push(
        `Proposed daily budget (${mutation.newDailyBudget}) exceeds configured ceiling (${env.DEFAULT_MAX_DAILY_BUDGET}).`
      );
      return { riskLevel: "HIGH", reasons };
    }
    if (pct > env.AUTO_APPROVE_BUDGET_CHANGE_PCT_MAX) {
      reasons.push(
        `Budget change of ${pct}% exceeds auto-approve threshold of ${env.AUTO_APPROVE_BUDGET_CHANGE_PCT_MAX}%.`
      );
      return { riskLevel: "MEDIUM", reasons };
    }
    reasons.push(`Budget change of ${pct}% is within configured auto-approve bounds.`);
    return { riskLevel: "LOW", reasons };
  }

  // Bid strategy changes affect spend distribution across the whole
  // campaign — treat as MEDIUM by default.
  if (mutation.resourceType === "bid_strategy") {
    reasons.push("Bid strategy changes affect delivery across the whole campaign.");
    return { riskLevel: "MEDIUM", reasons };
  }

  // Ad group / keyword / ad create-update: MEDIUM by default, since these
  // affect live spend but at a smaller, more reversible blast radius.
  if (
    ["ad_group", "keyword", "ad"].includes(mutation.resourceType) &&
    ["CREATE", "UPDATE"].includes(mutation.operation)
  ) {
    reasons.push("Standard structural change within an existing campaign.");
    return { riskLevel: "MEDIUM", reasons };
  }

  // Pausing/enabling a keyword or ad (non-top-performer) is LOW — reversible,
  // narrow blast radius.
  if (
    ["ad_group", "keyword", "ad"].includes(mutation.resourceType) &&
    ["PAUSE", "ENABLE"].includes(mutation.operation)
  ) {
    reasons.push("Reversible status change on a single narrow-scope entity.");
    return { riskLevel: "LOW", reasons };
  }

  // Negative keywords are the safest category in the system — they can
  // only reduce wasted spend, never increase it or remove existing reach
  // that was actually converting.
  if (mutation.resourceType === "negative_keyword") {
    reasons.push("Negative keywords only exclude traffic; cannot increase spend or risk.");
    return { riskLevel: "LOW", reasons };
  }

  // Fail safe: anything not explicitly classified above defaults to HIGH.
  // An unrecognized mutation shape is exactly the situation where we do NOT
  // want a permissive default.
  reasons.push("Mutation shape did not match any known low/medium-risk pattern; defaulting to HIGH.");
  return { riskLevel: "HIGH", reasons };
}
