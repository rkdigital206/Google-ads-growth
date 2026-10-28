/**
 * Lightweight landing-page audit: fetches a URL and checks for the basic
 * signals that determine whether paid traffic can actually convert once it
 * lands (this matters more than any bid optimization if it's broken).
 *
 * Generic across any client — no business/industry/intent assumptions are
 * baked in here. Intent-specific mixed-messaging detection (e.g. Murooj's
 * BUY vs SELL) is layered on top by
 * research/engines/website-intelligence.ts using the client's own
 * CustomIntentDefinition[] signal words, not hardcoded here.
 *
 * KNOWN LIMITATION: some sites (e.g. the pilot client's,
 * mrusedappliances.com) block automated fetches (robots.txt / bot
 * protection). This function throws a clear, typed error in that case
 * rather than silently returning empty data — do not let a caller mistake
 * "blocked" for "page has no phone number."
 */

export interface LandingPageAuditResult {
  url: string;
  hasVisiblePhoneNumber: boolean;
  hasWhatsAppLink: boolean;
  hasContactForm: boolean;
  titleTag: string | null;
  metaDescription: string | null;
  /** Raw lowercased page text, kept for downstream claim extraction (research/engines/website-intelligence.ts). Not re-fetched there. */
  rawTextLower: string;
  warnings: string[];
}

export class WebsiteFetchBlockedError extends Error {
  constructor(url: string, cause?: unknown) {
    super(
      `Could not fetch ${url} — the site blocked automated access (robots.txt or bot protection). ` +
        `Audit this page manually, or run this analyzer from an environment/IP the site permits.`
    );
    this.name = "WebsiteFetchBlockedError";
    this.cause = cause as Error | undefined;
  }
}

export async function auditLandingPage(url: string): Promise<LandingPageAuditResult> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GrowthAuditBot/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    html = await res.text();
  } catch (err) {
    throw new WebsiteFetchBlockedError(url, err);
  }

  const lower = html.toLowerCase();
  const warnings: string[] = [];

  const hasVisiblePhoneNumber = /\+?\d[\d\s\-()]{7,}\d/.test(html);
  const hasWhatsAppLink = lower.includes("wa.me") || lower.includes("whatsapp");
  const hasContactForm = lower.includes("<form");

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);

  if (!hasVisiblePhoneNumber && !hasWhatsAppLink) {
    warnings.push(
      "No obvious phone number or WhatsApp link detected via this regex-based check — this has false negatives, verify manually whether the page has a working conversion/contact path."
    );
  }

  return {
    url,
    hasVisiblePhoneNumber,
    hasWhatsAppLink,
    hasContactForm,
    titleTag: titleMatch?.[1]?.trim() ?? null,
    metaDescription: descMatch?.[1]?.trim() ?? null,
    rawTextLower: lower,
    warnings,
  };
}
