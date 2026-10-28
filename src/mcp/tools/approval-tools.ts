import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma } from "../../database/repositories/prisma-client.js";
import { toToolErrorMessage } from "../../utils/errors.js";

export function registerApprovalTools(server: McpServer) {
  server.tool(
    "list_pending_approvals",
    "Lists all pending (PROPOSED status) approval requests, optionally filtered to an account. Use this to see what changes are awaiting a human decision before proceeding with other work.",
    { accountId: z.string().optional() },
    async ({ accountId }) => {
      try {
        const pending = await prisma.approvalRequest.findMany({
          where: { status: "PROPOSED", ...(accountId ? { accountId } : {}) },
          orderBy: { createdAt: "asc" },
        });
        return { content: [{ type: "text", text: JSON.stringify(pending, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: toToolErrorMessage(err) }], isError: true };
      }
    }
  );

  server.tool(
    "get_change_log",
    "Returns the audit trail of proposed and executed changes for an account — every mutation the system has ever attempted, whether it executed, and why. Use this for reporting or to answer 'what has this system done to my account'.",
    { accountId: z.string(), limit: z.number().int().positive().max(200).default(50) },
    async ({ accountId, limit }) => {
      try {
        const entries = await prisma.changeLogEntry.findMany({
          where: { accountId },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: toToolErrorMessage(err) }], isError: true };
      }
    }
  );

  // NOTE: approve_change / reject_change tools that actually re-execute a
  // mutation via safety/mutation-guard.ts#resolveApproval need to be wired
  // per-resource-type (the "execute" closure differs for a campaign create
  // vs. a budget update). Wire these once the first real approval queue
  // exists for a real linked account — implementing generic "replay this JSON
  // blob against the API" now would mean guessing at payload shapes for
  // mutation types that haven't been exercised yet, which is exactly the
  // kind of invented-API-behavior this project explicitly wants avoided.
  server.tool(
    "decide_approval",
    "Records a human decision (approve or reject) on a pending approval request. NOTE: current implementation records the decision and updates status; re-executing the underlying mutation on APPROVE currently requires calling the original mutation tool again — see code comments in mcp/tools/approval-tools.ts for the planned resolveApproval() wiring.",
    {
      approvalRequestId: z.string(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      decidedBy: z.string().describe("Name/identifier of the human approver."),
      decisionNote: z.string().optional(),
    },
    async ({ approvalRequestId, decision, decidedBy, decisionNote }) => {
      try {
        const approval = await prisma.approvalRequest.update({
          where: { id: approvalRequestId },
          data: { status: decision, decidedBy, decidedAt: new Date(), decisionNote },
        });
        return {
          content: [
            {
              type: "text",
              text:
                decision === "APPROVED"
                  ? `Approval ${approvalRequestId} marked APPROVED by ${decidedBy}. Re-run the original mutation tool call now to execute it — the risk engine will pass it through automatically since it's now approved. (${JSON.stringify(approval)})`
                  : `Approval ${approvalRequestId} marked REJECTED by ${decidedBy}. No changes were made to the live account.`,
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: toToolErrorMessage(err) }], isError: true };
      }
    }
  );
}
