import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildClientAuditChecklist } from "../../audit/checklist.js";
import { getLinkedAccountsForClient } from "../../database/repositories/account-repo.js";
import { auditLandingPage, WebsiteFetchBlockedError } from "../../website/website-analyzer.js";
import { childLogger } from "../../utils/logger.js";
import { ok, fail, requireClient } from "./tool-helpers.js";

const log = childLogger({ module: "audit-tools" });

export function registerAuditTools(server: McpServer) {
  server.tool(
    "get_audit_checklist",
    "Returns the pre-audit checklist for a specific client, built entirely from that client's stored BusinessProfile, OptimizationConfig and linked Google Ads accounts (no industry, country or intent assumptions). Run it FIRST for a new engagement, or before proposing changes on an account that has not been audited recently. Items marked blocking should be resolved before trusting performance data.",
    { clientId: z.string().describe("The client to build the checklist for.") },
    async ({ clientId }) => {
      try {
        const client = await requireClient(clientId);
        const accounts = await getLinkedAccountsForClient(clientId);
        const checklist = buildClientAuditChecklist(
          client.profile,
          client.optimizationConfig,
          accounts.map((a) => ({ customerId: a.customerId, descriptiveName: a.descriptiveName, currencyCode: a.currencyCode }))
        );
        return ok({
          clientId,
          clientName: client.profile.clientName,
          linkedAccounts: accounts.length,
          blockingItems: checklist.filter((i) => i.blocking).length,
          checklist,
        });
      } catch (err) {
        log.error({ err, clientId }, "get_audit_checklist failed");
        return fail(err);
      }
    }
  );

  server.tool(
    "audit_landing_page",
    "Fetches and audits a landing page URL for basic conversion-readiness signals (visible phone number, WhatsApp link, contact form, title/meta). Reports clearly if the site blocks automated access rather than silently returning empty data. For client-intent-aware analysis (mixed-intent messaging) use analyze_website with a clientId.",
    { url: z.string().url() },
    async ({ url }) => {
      try {
        return ok(await auditLandingPage(url));
      } catch (err) {
        if (err instanceof WebsiteFetchBlockedError) return { content: [{ type: "text" as const, text: err.message }], isError: true as const };
        return fail(err);
      }
    }
  );
}
