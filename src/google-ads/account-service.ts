import { runQuery } from "./client.js";
import { listAccessibleCustomerIds } from "./auth.js";
import { enumName, CustomerStatusEnum, CampaignStatusEnum, ChannelTypeEnum } from "./enum-utils.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "account-discovery" });

export interface AccountSummary {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  /** String enum name, e.g. ENABLED / SUSPENDED / CANCELED / CLOSED. */
  status: string;
  /** True for a manager (MCC) account. Manager accounts hold no campaigns of their own. */
  isManager: boolean;
}

/**
 * Fetches core metadata for a single customer account. Use this before any
 * other operation to confirm which currency/timezone metrics are in — a
 * classic source of misread currency mistakes.
 *
 * `loginCustomerId` lets a caller query an account AS a specific manager
 * (needed for hierarchy traversal); omit it to use the server default.
 */
export async function getAccountSummary(customerId: string, opts: { loginCustomerId?: string } = {}): Promise<AccountSummary> {
  const rows = await runQuery<{
    customer: {
      id: string;
      descriptive_name: string;
      currency_code: string;
      time_zone: string;
      status: string | number;
      manager: boolean;
    };
  }>(
    customerId,
    `SELECT customer.id, customer.descriptive_name, customer.currency_code,
            customer.time_zone, customer.status, customer.manager
     FROM customer
     LIMIT 1`,
    opts
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`No account data returned for customer ${customerId}`);
  }

  return {
    customerId: String(row.customer.id),
    descriptiveName: row.customer.descriptive_name,
    currencyCode: row.customer.currency_code,
    timeZone: row.customer.time_zone,
    status: enumName(CustomerStatusEnum, row.customer.status),
    isManager: row.customer.manager === true,
  };
}

/** Lists non-removed campaigns (status/channel normalized to string enum names). */
export async function listCampaigns(customerId: string) {
  const rows = await runQuery<{
    campaign: { id: string; name: string; status: string | number; advertising_channel_type: string | number };
    campaign_budget: { amount_micros: string };
  }>(
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status,
            campaign.advertising_channel_type, campaign_budget.amount_micros
     FROM campaign
     WHERE campaign.status != 'REMOVED'
     ORDER BY campaign.name`
  );
  return rows.map((r) => ({
    campaign: {
      id: r.campaign.id,
      name: r.campaign.name,
      status: enumName(CampaignStatusEnum, r.campaign.status),
      advertising_channel_type: enumName(ChannelTypeEnum, r.campaign.advertising_channel_type),
    },
    campaign_budget: r.campaign_budget,
  }));
}

/** Lists non-removed ad groups — used by the audit to measure ad-group coverage per campaign. */
export async function listAdGroups(customerId: string) {
  return runQuery<{ ad_group: { id: string; name: string; status: string | number }; campaign: { id: string } }>(
    customerId,
    `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
     FROM ad_group
     WHERE ad_group.status != 'REMOVED'`
  );
}

// ---------------------------------------------------------------------------
// Discovery (Phase E.1 section 5)
// ---------------------------------------------------------------------------

export type AccountKind = "MANAGER" | "CLIENT" | "UNKNOWN";

export interface AccessPath {
  via: "DIRECT" | "MANAGER_HIERARCHY";
  /** For MANAGER_HIERARCHY: the manager account the account was found beneath. */
  managerId?: string;
  /** Depth below that manager (1 = direct child). The Google Ads API does not expose the immediate parent for deeper levels. */
  level?: number;
}

export interface DiscoveredAccount {
  customerId: string;
  /** INSPECTED = metadata was retrieved. INACCESSIBLE = this specific account could not be read (no access, suspended, revoked...). */
  inspection: "INSPECTED" | "INACCESSIBLE";
  accountType: AccountKind;
  summary: AccountSummary | null;
  /** True only for an ENABLED, non-manager account — i.e. one that can meaningfully be linked to a client and audited. */
  linkable: boolean;
  /** Why the account is not linkable, when it isn't. Null when linkable. */
  notLinkableReason: string | null;
  accessPaths: AccessPath[];
  /** Null if inspection succeeded. */
  error: string | null;
}

export interface DiscoveryDeps {
  listAccessibleIds: () => Promise<string[]>;
  getSummary: (customerId: string) => Promise<AccountSummary>;
  /** Lists every account beneath a manager (excluding the manager itself). */
  listManagerHierarchy: (managerId: string) => Promise<{ summary: AccountSummary; level: number }[]>;
}

export interface DiscoveryOptions {
  /** Walk each accessible MANAGER account and include its descendants. Default true. */
  traverseHierarchy?: boolean;
  /** Max parallel Google Ads calls. Default 5. */
  concurrency?: number;
}

/** Lists all accounts beneath `managerId` via customer_client, queried AS that manager. Excludes level 0 (the manager itself). */
export async function listManagerHierarchy(managerId: string): Promise<{ summary: AccountSummary; level: number }[]> {
  const rows = await runQuery<{
    customer_client: {
      id: string;
      descriptive_name: string;
      currency_code: string;
      time_zone: string;
      status: string | number;
      manager: boolean;
      level: string | number;
    };
  }>(
    managerId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
            customer_client.time_zone, customer_client.status, customer_client.manager, customer_client.level
     FROM customer_client
     WHERE customer_client.level > 0`,
    { loginCustomerId: managerId }
  );
  return rows.map((r) => ({
    level: Number(r.customer_client.level),
    summary: {
      customerId: String(r.customer_client.id),
      descriptiveName: r.customer_client.descriptive_name,
      currencyCode: r.customer_client.currency_code,
      timeZone: r.customer_client.time_zone,
      status: enumName(CustomerStatusEnum, r.customer_client.status),
      isManager: r.customer_client.manager === true,
    },
  }));
}

const defaultDeps: DiscoveryDeps = {
  listAccessibleIds: listAccessibleCustomerIds,
  getSummary: (id) => getAccountSummary(id),
  listManagerHierarchy,
};

/** Pure classification of one inspected (or failed) account. Exported for tests. */
export function classifyAccount(customerId: string, summary: AccountSummary | null, error: string | null, accessPaths: AccessPath[]): DiscoveredAccount {
  if (!summary) {
    return {
      customerId,
      inspection: "INACCESSIBLE",
      accountType: "UNKNOWN",
      summary: null,
      linkable: false,
      notLinkableReason: "Account could not be inspected (no access, suspended, revoked, or API error).",
      accessPaths,
      error,
    };
  }
  const accountType: AccountKind = summary.isManager ? "MANAGER" : "CLIENT";
  let notLinkableReason: string | null = null;
  if (accountType === "MANAGER") notLinkableReason = "Manager (MCC) accounts hold no campaigns; link one of its child client accounts instead.";
  else if (summary.status !== "ENABLED") notLinkableReason = `Account status is ${summary.status}, not ENABLED.`;
  return {
    customerId,
    inspection: "INSPECTED",
    accountType,
    summary,
    linkable: notLinkableReason === null,
    notLinkableReason,
    accessPaths,
    error: null,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Full discovery flow: list every directly accessible customer ID, inspect
 * each individually, and (optionally) walk each MANAGER account's hierarchy.
 *
 * Graceful degradation: one account failing to inspect, or one manager
 * failing to traverse, is recorded on that account and never aborts the
 * rest. Only failing to list accessible customers at all is fatal (there is
 * nothing to discover).
 *
 * Read-only. Nothing is persisted and no account is assigned to a client —
 * assignment is the explicit link_google_ads_account step.
 */
export async function discoverAccessibleAccounts(deps: DiscoveryDeps = defaultDeps, options: DiscoveryOptions = {}): Promise<DiscoveredAccount[]> {
  const traverse = options.traverseHierarchy ?? true;
  const concurrency = options.concurrency ?? 5;

  const directIds = [...new Set(await deps.listAccessibleIds())];

  const inspected = await mapWithConcurrency(directIds, concurrency, async (customerId) => {
    try {
      return { customerId, summary: await deps.getSummary(customerId), error: null as string | null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ customerId, err: message }, "Could not inspect account during discovery — continuing with remaining accounts");
      return { customerId, summary: null as AccountSummary | null, error: message };
    }
  });

  const byId = new Map<string, DiscoveredAccount>();
  for (const r of inspected) {
    byId.set(r.customerId, classifyAccount(r.customerId, r.summary, r.error, [{ via: "DIRECT" }]));
  }

  if (traverse) {
    const managers = [...byId.values()].filter((a) => a.accountType === "MANAGER" && a.summary?.status === "ENABLED");
    await mapWithConcurrency(managers, concurrency, async (manager) => {
      try {
        const descendants = await deps.listManagerHierarchy(manager.customerId);
        for (const d of descendants) {
          const path: AccessPath = { via: "MANAGER_HIERARCHY", managerId: manager.customerId, level: d.level };
          const existing = byId.get(d.summary.customerId);
          if (existing) {
            existing.accessPaths.push(path);
          } else {
            byId.set(d.summary.customerId, classifyAccount(d.summary.customerId, d.summary, null, [path]));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ managerId: manager.customerId, err: message }, "Could not traverse manager hierarchy — reporting the manager without its children");
        manager.error = `Hierarchy traversal failed: ${message}`;
      }
    });
  }

  return [...byId.values()];
}
