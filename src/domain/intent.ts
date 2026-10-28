/**
 * Generic search/keyword intent model.
 *
 * Phase 1 hardcoded a Murooj-only `SearchIntent = "BUY" | "SELL" | "UNCLASSIFIED"`
 * union with hardcoded signal-word arrays (`BUY_SIGNALS`, `SELL_SIGNALS`) baked
 * directly into strategy/campaign-strategy.ts. That is exactly the kind of
 * industry-specific assumption the multi-client architecture must not repeat.
 *
 * Two things change here:
 *   1. A fixed set of STANDARD_INTENT_TYPES that apply across any business
 *      (transactional, informational, brand, competitor, etc.) — the same
 *      categories any Google Ads account can be reasoned about with.
 *   2. CLIENT-DEFINED custom intents (e.g. Murooj's BUY vs SELL) are now
 *      data, not code. A client's onboarding config supplies a list of
 *      CustomIntentDefinition objects, each carrying its own signal words.
 *      The classifier below is generic — it has no idea what "BUY" or
 *      "SELL" mean, it just matches against whatever signal words the
 *      client's config supplies.
 *
 * This is still a first-pass, conservative, keyword-signal classifier — the
 * same limitation the original had. True semantic classification (LLM-based
 * or otherwise) is Phase F (Keyword + Intent Intelligence) work, not this
 * phase. Ambiguous or unmatched terms return "UNKNOWN" rather than a guess.
 */

export const STANDARD_INTENT_TYPES = [
  "TRANSACTIONAL",
  "COMMERCIAL",
  "INFORMATIONAL",
  "NAVIGATIONAL",
  "LOCAL",
  "BRAND",
  "COMPETITOR",
  "PRODUCT",
  "SERVICE",
  "RESEARCH",
  "IRRELEVANT",
  "UNKNOWN",
] as const;

export type StandardIntentType = (typeof STANDARD_INTENT_TYPES)[number];

/**
 * A client-specific business intent, defined during onboarding — not baked
 * into the type system. Example (Murooj): { key: "BUY", signalWords: [...] }
 * and { key: "SELL", signalWords: [...] }. A different client (e.g. a SaaS
 * business) might define "TRIAL_INTENT" / "ENTERPRISE_INTENT" instead, or
 * define none at all and rely purely on STANDARD_INTENT_TYPES.
 */
export interface CustomIntentDefinition {
  /** Short unique key, e.g. "BUY". Used as the classification result value. */
  key: string;
  label: string;
  description: string;
  /** Example queries, for documentation/onboarding review — not used by the classifier. */
  exampleQueries: string[];
  /** What "converting well" means for this intent — feeds optimization thresholds later. */
  conversionGoal: string;
  /**
   * Lowercase substrings/phrases that signal this intent when found in a
   * search term. This is the client-supplied replacement for what used to
   * be a hardcoded array in code.
   */
  signalWords: string[];
}

/**
 * IntentType is deliberately widened to `string` beyond the standard set —
 * TypeScript can't express "one of N known values plus whatever custom keys
 * this particular client configured" as a closed union without generics
 * that would leak client identity into every consumer. Runtime code that
 * needs to validate a classification result against a specific client's
 * configuration should check it against that client's CustomIntentDefinition
 * list (see isKnownIntent below), not assume the string is one of the
 * standard values.
 */
export type IntentType = StandardIntentType | string;

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  matchedSignals: string[];
}

/**
 * Generic term-vs-custom-intents classifier. Replaces the old
 * classifySearchTermIntent's hardcoded BUY_SIGNALS/SELL_SIGNALS logic with
 * the same conservative approach, driven entirely by whatever intents are
 * passed in.
 *
 * Behavior, unchanged from Phase 1's logic:
 *   - If exactly one custom intent's signal words match (and no other
 *     intent's signal words also match), classify as that intent, with
 *     confidence that increases (capped) with more matching signals.
 *   - If zero or multiple intents match, return "UNKNOWN" with confidence 0
 *     rather than guessing — ambiguity must not be silently resolved.
 */
export function classifyTermAgainstIntents(
  term: string,
  customIntents: CustomIntentDefinition[]
): IntentClassification {
  const lower = term.toLowerCase();

  const matchesByIntent = customIntents
    .map((def) => ({
      key: def.key,
      matches: def.signalWords.filter((signal) => lower.includes(signal.toLowerCase())),
    }))
    .filter((m) => m.matches.length > 0);

  if (matchesByIntent.length === 1) {
    const only = matchesByIntent[0];
    if (only) {
      const confidence = Math.min(0.5 + only.matches.length * 0.1, 0.9);
      return { intent: only.key, confidence, matchedSignals: only.matches };
    }
  }

  // Zero matches, or more than one custom intent's signals matched
  // (genuinely ambiguous) — don't fabricate a classification.
  const allMatched = matchesByIntent.flatMap((m) => m.matches);
  return { intent: "UNKNOWN", confidence: 0, matchedSignals: allMatched };
}

/** True if `intent` is either a standard type or defined in the client's custom intent list. */
export function isKnownIntent(intent: IntentType, customIntents: CustomIntentDefinition[]): boolean {
  return (
    (STANDARD_INTENT_TYPES as readonly string[]).includes(intent) ||
    customIntents.some((def) => def.key === intent)
  );
}
