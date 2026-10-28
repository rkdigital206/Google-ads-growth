import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { discoverAccessibleAccounts, getAccountSummary } from "../../google-ads/account-service.js";
import { getLinkedAccountsForClient, getLinkedCustomerIds, linkGoogleAdsAccount, normalizeCustomerId } from "../../database/repositories/account-repo.js";
import { toToolErrorMessage } from "../../utils/errors.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ module: "discovery-tools" });

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

export function registerDiscoveryTools(server: McpServer) {
  server.tool(
    "list_google_ads_accounts",
    "STEP 1–2 of account onboarding (DISCOVER → INSPECT). Discovers every Google Ads customer reachable with the configured credentials, classifying each as MANAGER, CLIENT or UNKNOWN, noting whether it was inspected or inaccessible, whether it is linkable, how it was reached (direct or beneath a manager), and which client (if any) it is already linked to. Optionally walks manager hierarchies. Read-only: a discovered account is NEVER auto-assigned to a client — use link_google_ads_account for that. One failing account never fails the whole call.",
    { traverseHierarchy: z.boolean().default(true).describe("Also list accounts beneath each accessible, enabled manager account.") },
    async ({ traverseHierarchy }) => {
      try {
        const [accounts, linked] = await Promise.all([discoverAccessibleAccounts(undefined, { traverseHierarchy }), getLinkedCustomerIds()]);
        const annotated = accounts.map((a) => ({ ...a, linkedClientId: linked.get(a.customerId) ?? null }));
        return text({
          totalCount: annotated.length,
          managerCount: annotated.filter((a) => a.accountType === "MANAGER").length,
          clientCount: annotated.filter((a) => a.accountType === "CLIENT").length,
          unknownOrInaccessibleCount: annotated.filter((a) => a.accountType === "UNKNOWN").length,
          linkableUnassignedCount: annotated.filter((a) => a.linkable && a.linkedClientId === null).length,
          accounts: annotated,
          nextStep: "Pick an account with linkable=true and linkedClientId=null, then call link_google_ads_account with the intended clientId.",
        });
      } catch (err) {
        log.error({ err }, "list_google_ads_accounts failed");
        return { ...text(toToolErrorMessage(err)), isError: true };
      }
    }
  );

  server.tool(
    "link_google_ads_account",
    "STEP 3–4 (ASSIGN → STORE). Explicitly assigns a Google Ads customer account to a client. The server re-inspects the account itself (it does not trust caller-supplied metadata), refuses MANAGER accounts and accounts it cannot inspect, and refuses to move an account already linked to a different client. Does not modify anything in Google Ads.",
    {
      clientId: z.string().describe("The client that should own this Google Ads account."),
      customerId: z.string().describe("Google Ads customer ID (dashes allowed)."),
      managerAccountId: z.string().optional().describe("If the account is only reachable through a specific manager account, that manager's customer ID."),
    },
    async ({ clientId, customerId, managerAccountId }) => {
      try {
        const normalized = normalizeCustomerId(customerId);
        const manager = managerAccountId ? normalizeCustomerId(managerAccountId) : undefined;

        let summary = null;
        try {
          summary = await getAccountSummary(normalized, manager ? { loginCustomerId: manager } : {});
        } catch (err) {
          log.warn({ customerId: normalized, err }, "Account inspection failed during link");
        }

        const row = await linkGoogleAdsAccount({
          clientId,
          customerId: normalized,
          accountType: summary ? (summary.isManager ? "MANAGER" : "CLIENT") : "UNKNOWN",
          descriptiveName: summary?.descriptiveName,
          currencyCode: summary?.currencyCode,
          timeZone: summary?.timeZone,
          managerAccountId: manager ?? null,
        });
        return text({ linked: row, nextStep: "Run audit_google_ads_account (clientId + customerId), then run_growth_research / generate_growth_strategy." });
      } catch (err) {
        log.error({ err, clientId, customerId }, "link_google_ads_account failed");
        return { ...text(toToolErrorMessage(err)), isError: true };
      }
    }
  );

  server.tool(
    "get_linked_accounts",
    "Lists the Google Ads accounts stored for a client (the accounts that audit, research and strategy tools are allowed to act on for that client).",
    { clientId: z.string() },
    async ({ clientId }) => {
      try {
        return text({ clientId, accounts: await getLinkedAccountsForClient(clientId) });
      } catch (err) {
        log.error({ err, clientId }, "get_linked_accounts failed");
        return { ...text(toToolErrorMessage(err)), isError: true };
      }
    }
  );
}
