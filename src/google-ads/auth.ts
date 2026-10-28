/**
 * IMPORTANT — read before touching this file:
 *
 * Google does not publish an official Node.js/TypeScript client library for
 * the Google Ads API (only Java, .NET, PHP, Python, Ruby are official).
 * This project uses `google-ads-api` (Opteo, MIT-licensed, actively
 * maintained, wraps the official gRPC/REST surface) as the de facto
 * community standard — the same one referenced throughout current Google
 * Ads + TypeScript tutorials. If Google ever ships an official Node client,
 * this is the file (plus client.ts) to swap it in — nothing outside
 * src/google-ads/ should import from `google-ads-api` directly.
 *
 * Auth model: standard OAuth2 "installed app" flow, done ONCE per Google
 * account outside this server (via Google's OAuth playground or a small
 * local script) to obtain a long-lived refresh token. This server never
 * performs the interactive OAuth consent screen itself — it only uses the
 * refresh token to mint short-lived access tokens.
 *
 * Required credentials (see .env.example):
 *   - developer_token: from the MCC's API Center. Google gates production
 *     (non-test-account) access behind a Basic/Standard access review.
 *   - client_id / client_secret: OAuth2 client from Google Cloud Console.
 *   - refresh_token: obtained once via OAuth consent for the Google account
 *     that has access to the target Ads account(s).
 *   - login_customer_id: the MCC customer ID. Required whenever you're
 *     calling into a client account through a manager account — which you
 *     will be, for any multi-client setup. Omit only for a single
 *     directly-owned account.
 */

import { GoogleAdsApi, type Customer } from "google-ads-api";
import { env } from "../config/env.js";
import { GoogleAdsApiError } from "../utils/errors.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "google-ads-auth" });

let apiClient: GoogleAdsApi | null = null;

/** Returns the Google Ads credentials, or throws a clear error naming the missing variables. */
export function requireGoogleAdsCredentials() {
  const missing = (["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"] as const).filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new GoogleAdsApiError(`GOOGLE_ADS_NOT_CONFIGURED: Google Ads is not connected. Set ${missing.join(", ")} in the server environment.`);
  }
  return {
    clientId: env.GOOGLE_ADS_CLIENT_ID as string,
    clientSecret: env.GOOGLE_ADS_CLIENT_SECRET as string,
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN as string,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN as string,
  };
}

function getApiClient(): GoogleAdsApi {
  if (!apiClient) {
    const creds = requireGoogleAdsCredentials();
    apiClient = new GoogleAdsApi({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      developer_token: creds.developerToken,
    });
    log.info("Google Ads API client initialized");
  }
  return apiClient;
}

/**
 * Account DISCOVERY — lists every customer ID the configured refresh token
 * has access to (directly, or through the login/manager account). This is
 * distinct from getCustomerClient() below, which requires already knowing
 * a specific customer ID; this is how the agent finds out which accounts
 * exist in the first place (Phase E section 6).
 *
 * VERIFIED against the installed typings (google-ads-api 25.1.0, also 19.x and
 * 23.x): `Client#listAccessibleCustomers(refreshToken: string):
 * Promise<services.ListAccessibleCustomersResponse>`, whose `resource_names`
 * is `string[]` of "customers/<id>". Verified at type level and by `tsc`
 * only — NOT exercised against the live Google Ads API.
 */
export async function listAccessibleCustomerIds(): Promise<string[]> {
  try {
    const result = await getApiClient().listAccessibleCustomers(requireGoogleAdsCredentials().refreshToken);
    // Each resource_name looks like "customers/1234567890" — extract the
    // digits-only ID that the rest of this codebase expects everywhere else.
    return result.resource_names.map((rn: string) => rn.replace("customers/", ""));
  } catch (err) {
    throw new GoogleAdsApiError("Failed to list accessible Google Ads customer IDs for the configured refresh token", err);
  }
}

/**
 * Returns a `Customer` instance scoped to a specific Google Ads account
 * (customerId). This is the object every service in src/google-ads/ should
 * use to make GAQL queries and mutate operations.
 *
 * @param customerId - digits-only Google Ads customer ID for the TARGET
 *   account (a linked client account), not the manager account.
 */
export function getCustomerClient(customerId: string, loginCustomerIdOverride?: string): Customer {
  const sanitized = customerId.replace(/-/g, "");
  if (!/^\d{6,12}$/.test(sanitized)) {
    throw new GoogleAdsApiError(
      `Invalid Google Ads customer ID: "${customerId}". Expected 6-12 digits, no dashes.`
    );
  }

  const { refreshToken } = requireGoogleAdsCredentials();
  try {
    return getApiClient().Customer({
      customer_id: sanitized,
      // loginCustomerIdOverride is used for manager-hierarchy traversal, where the
      // query must be issued AS the manager being traversed.
      login_customer_id: (loginCustomerIdOverride ?? env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)?.replace(/-/g, ""),
      refresh_token: refreshToken,
    });
  } catch (err) {
    throw new GoogleAdsApiError(
      `Failed to construct Google Ads customer client for ${sanitized}`,
      err
    );
  }
}
