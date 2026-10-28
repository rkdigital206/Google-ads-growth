/**
 * Generic pre-audit checklist (Phase E.1 section 12).
 *
 * Built ONLY from the client's stored BusinessProfile, OptimizationConfig and
 * linked Google Ads accounts. There are no industry, country, currency or
 * intent assumptions here — intent-related items appear only if the client
 * has configured custom intents, and economics items only for the inputs
 * that are actually missing.
 */

import type { BusinessProfile } from "../domain/business-profile.js";
import type { OptimizationConfig } from "../domain/optimization-config.js";
import { assessOnboardingCompleteness } from "../onboarding/engine.js";

export interface ChecklistAccount {
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
}

export interface ChecklistItem {
  id: string;
  /** Short imperative step. */
  action: string;
  /** Why this applies to THIS client. */
  reason: string;
  blocking: boolean;
}

export function buildClientAuditChecklist(profile: BusinessProfile, config: OptimizationConfig, accounts: ChecklistAccount[]): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (id: string, action: string, reason: string, blocking = false) => items.push({ id, action, reason, blocking });

  // --- Account linkage ---
  if (accounts.length === 0) {
    add("link-account", "Discover and link a Google Ads account (list_google_ads_accounts → link_google_ads_account).", `${profile.clientName} has no Google Ads account linked, so nothing account-specific can be audited.`, true);
  } else {
    for (const a of accounts) {
      const label = a.descriptiveName ? `${a.descriptiveName} (${a.customerId})` : a.customerId;
      add(
        `confirm-currency-${a.customerId}`,
        `Confirm the account currency and time zone for ${label} before interpreting any cost figure.`,
        profile.currency
          ? `Client currency is configured as ${profile.currency}; account reports ${a.currencyCode ?? "an unknown currency"} — these must agree.`
          : `No client currency is configured; account reports ${a.currencyCode ?? "an unknown currency"}.`,
        true
      );
    }
  }

  // --- Tracking ---
  add("verify-conversion-actions", "List conversion actions and verify each one's status and counting type before trusting any conversion metric.", "Every CPA/ROAS figure depends on tracking being correct.", true);
  if (profile.trackingStatus === "UNKNOWN" || profile.trackingStatus === "NOT_CONFIGURED" || profile.trackingStatus === "PARTIALLY_CONFIGURED" || profile.trackingStatus === "CONFIGURED_UNVERIFIED") {
    add("verify-tracking-fires", "Verify (via Tag Assistant or a test conversion) that conversion tags actually fire.", `Client tracking status is recorded as ${profile.trackingStatus}.`, true);
  }
  if (profile.primaryConversionGoal === null) {
    add("define-primary-goal", "Agree the primary conversion goal Google Ads should optimize for.", "No primaryConversionGoal is configured; the optimization objective must not be assumed.", true);
  }

  // --- Economics gaps (only the ones actually missing) ---
  const completeness = assessOnboardingCompleteness(profile, config);
  const economicsFields = new Set(["targetCPA", "targetROAS", "averageOrderValue", "grossMargin", "profitPerSale", "leadValue", "lifetimeValue", "leadToSaleRate", "monthlyBudget"]);
  for (const q of completeness.nextQuestions.filter((q) => economicsFields.has(q.field))) {
    add(`economics-${q.field}`, `Collect ${q.field}: ${q.question}`, q.rationale);
  }
  if (config.targetCPA === null && config.targetROAS === null) {
    add("performance-target", "Establish a CPA or ROAS target (client-stated, or derived via calculate_business_economics).", "Without a target the audit can only judge the account against itself, not against the business.");
  }

  // --- Performance review ---
  add("review-performance", "Pull campaign performance for the last 90 days and reconcile against any externally reported figures.", "Reported figures can be stale or measured differently.");
  add("review-search-terms", "Review the search term report for irrelevant or wasteful queries.", "Search terms reveal intent leakage and negative-keyword candidates.");

  // --- Intent (only if the client has configured custom intents) ---
  if (profile.customIntents.length > 1) {
    add(
      "check-intent-separation",
      `Check that the configured intents (${profile.customIntents.map((i) => i.key).join(", ")}) are not mixed within the same campaign or landing page.`,
      "This client defined multiple custom intents, which typically need separate campaign structure and messaging."
    );
  }

  // --- Landing pages ---
  if (profile.website) add("audit-landing-page", `Audit the landing page(s) on ${profile.website} for a clear conversion path.`, "Paid traffic is wasted if the landing page cannot convert.");
  else add("collect-website", "Collect the business website URL.", "Website intelligence and landing-page audits cannot run without it.", true);

  // --- Client-specific open questions and restrictions ---
  profile.openQuestionsForAudit.forEach((q, i) => add(`open-question-${i}`, q, "Open question recorded for this client."));
  if (profile.restrictions.length > 0) {
    add("respect-restrictions", `Respect client restrictions: ${profile.restrictions.join("; ")}.`, "Configured as things the agent must not do for this client.");
  }

  return items;
}
