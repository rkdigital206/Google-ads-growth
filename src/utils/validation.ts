/**
 * Google Ads API represents all currency amounts in "micros"
 * (1 unit of currency = 1,000,000 micros). Every budget/bid value crossing
 * the boundary into the API MUST go through this — a missed conversion is
 * the single most common (and most expensive) bug class in Google Ads
 * integrations, since it's off by a factor of a million, not ten.
 */
export function toMicros(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid currency amount for micros conversion: ${amount}`);
  }
  return Math.round(amount * 1_000_000);
}

export function fromMicros(micros: number | string): number {
  const n = typeof micros === "string" ? Number(micros) : micros;
  return n / 1_000_000;
}

export function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}
