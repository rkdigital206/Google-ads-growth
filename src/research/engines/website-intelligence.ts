/**
 * Website intelligence engine (Phase D sections 5, 6, 7).
 *
 * Wraps website/website-analyzer.ts's raw fetch/regex pass with the
 * claim-verification discipline the brief requires: every extracted
 * business claim is either VERIFIED (directly observed on the page),
 * INFERRED (a reasonable conclusion the agent drew, not directly stated),
 * or UNKNOWN. Nothing here is industry-specific — mixed-intent detection
 * uses whatever CustomIntentDefinition[] the calling client configured
 * (e.g. Murooj's BUY/SELL), or none at all for a client with no custom
 * intents.
 */

import { auditLandingPage, WebsiteFetchBlockedError, type LandingPageAuditResult } from "../../website/website-analyzer.js";
import type { CustomIntentDefinition } from "../../domain/intent.js";
import type { ClaimStatus, ResearchResult } from "../types.js";

export interface WebsiteClaim {
  claim: string;
  status: ClaimStatus;
  /** The concrete signal that produced this claim, for auditability. */
  basis: string;
}

export interface MixedIntentSignal {
  /** The two (or more) custom intent keys whose signal words both appeared on the page. */
  intentKeys: string[];
  detail: string;
}

export interface WebsiteIntelligenceResult {
  url: string;
  claims: WebsiteClaim[];
  mixedIntentSignals: MixedIntentSignal[];
  titleTag: string | null;
  metaDescription: string | null;
  warnings: string[];
}

/**
 * Runs the raw audit and layers claim verification + generic mixed-intent
 * detection on top. Returns a ResearchResult so callers get an explicit
 * state (COMPLETE/BLOCKED) rather than having to catch an exception to
 * know whether website data is usable — per section 7's requirement that
 * "the final report must explicitly say website intelligence is
 * incomplete" when access fails.
 */
export async function analyzeWebsite(
  url: string,
  customIntents: CustomIntentDefinition[] = []
): Promise<ResearchResult<WebsiteIntelligenceResult>> {
  let raw: LandingPageAuditResult;
  try {
    raw = await auditLandingPage(url);
  } catch (err) {
    if (err instanceof WebsiteFetchBlockedError) {
      return {
        state: "BLOCKED",
        code: "ACCESS_BLOCKED",
        data: null,
        issues: ["WEBSITE_ACCESS_BLOCKED: " + err.message],
      };
    }
    return {
      state: "FAILED",
      code: "DATA_UNAVAILABLE",
      data: null,
      issues: [`WEBSITE_UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const claims: WebsiteClaim[] = [];

  // VERIFIED claims — directly observed signals, not conclusions drawn from them.
  if (raw.hasVisiblePhoneNumber) {
    claims.push({ claim: "Website has a visible phone number.", status: "VERIFIED", basis: "phone-number regex matched on page HTML" });
  }
  if (raw.hasWhatsAppLink) {
    claims.push({ claim: "Website has a WhatsApp contact link.", status: "VERIFIED", basis: "wa.me/WhatsApp reference found in page HTML" });
  }
  if (raw.hasContactForm) {
    claims.push({ claim: "Website has a contact form.", status: "VERIFIED", basis: "<form> tag present in page HTML" });
  }
  if (!raw.hasVisiblePhoneNumber && !raw.hasWhatsAppLink && !raw.hasContactForm) {
    claims.push({
      claim: "No phone number, WhatsApp link, or contact form was detected.",
      status: "UNKNOWN",
      basis: "regex-based detection has false negatives; a conversion path may exist that this check missed (e.g. JS-rendered content, chat widget)",
    });
  }

  // INFERRED claims — conclusions drawn from verified signals, explicitly
  // labeled as such per section 6's example ("customers probably want fast
  // delivery" must never be presented as fact).
  if (raw.hasWhatsAppLink && !raw.hasContactForm) {
    claims.push({
      claim: "This business likely prefers conversational/instant-response leads (WhatsApp) over form-based leads.",
      status: "INFERRED",
      basis: "WhatsApp link present without a contact form",
    });
  }

  // Generic mixed-intent detection — driven entirely by the client's own
  // CustomIntentDefinition[] signal words, not any hardcoded BUY/SELL logic.
  const mixedIntentSignals: MixedIntentSignal[] = [];
  const matchedIntents = customIntents.filter((intent) =>
    intent.signalWords.some((word) => raw.rawTextLower.includes(word.toLowerCase()))
  );
  if (matchedIntents.length > 1) {
    mixedIntentSignals.push({
      intentKeys: matchedIntents.map((i) => i.key),
      detail: `Page language matches signal words for multiple configured intents (${matchedIntents
        .map((i) => i.key)
        .join(", ")}) — confirm whether each intent is actually routed to its own dedicated page, or all traffic lands on one mixed-message page.`,
    });
  }

  return {
    state: "COMPLETE",
    data: {
      url: raw.url,
      claims,
      mixedIntentSignals,
      titleTag: raw.titleTag,
      metaDescription: raw.metaDescription,
      warnings: raw.warnings,
    },
    issues: [],
  };
}
