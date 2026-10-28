import type { Customer } from "google-ads-api";
import { getCustomerClient } from "./auth.js";
import { GoogleAdsApiError } from "../utils/errors.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "google-ads-client" });

const RETRYABLE_STATUS_HINTS = ["RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "429", "503"];

function isRetryable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return RETRYABLE_STATUS_HINTS.some((hint) => message.includes(hint));
}

/**
 * Runs a GAQL query against a customer account with basic exponential
 * backoff on transient/quota errors. Every read path in google-ads/*.ts
 * should go through this rather than calling customer.query() directly, so
 * retry/error behavior stays consistent in one place.
 */
export async function runQuery<T = Record<string, unknown>>(
  customerId: string,
  gaql: string,
  opts: { maxRetries?: number; loginCustomerId?: string } = {}
): Promise<T[]> {
  const customer = getCustomerClient(customerId, opts.loginCustomerId);
  const maxRetries = opts.maxRetries ?? 3;

  let attempt = 0;
  while (true) {
    try {
      log.debug({ customerId, gaql }, "Running GAQL query");
      const rows = (await customer.query(gaql)) as unknown as T[];
      return rows;
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isRetryable(err)) {
        throw new GoogleAdsApiError(
          `GAQL query failed for customer ${customerId} after ${attempt} attempt(s): ${gaql}`,
          err
        );
      }
      const backoffMs = 2 ** attempt * 250;
      log.warn(
        { customerId, attempt, backoffMs },
        "Transient Google Ads API error, retrying"
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

/**
 * Returns the raw Customer instance for services that need mutate
 * operations (campaigns, ad groups, keywords, ads) rather than just GAQL
 * reads. Mutations must ALWAYS go through safety/mutation-guard.ts first —
 * never call customer.mutateResources directly from a tool handler.
 */
export function getCustomer(customerId: string): Customer {
  return getCustomerClient(customerId);
}
