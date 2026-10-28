import { getCustomer } from "../google-ads/client.js";
import { prisma } from "../database/repositories/prisma-client.js";
import { checkPolicy, type PolicyCheckInput } from "./approval-policy.js";
import { GoogleAdsApiError } from "../utils/errors.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "mutation-guard" });

export interface GuardedMutationInput extends PolicyCheckInput {
  /** The Google Ads customer ID (digits, not internal DB id) to mutate. */
  customerId: string;
  /**
   * The actual Google Ads API call to perform IF policy allows it.
   * Receives the raw Customer client. Must return the resource_name(s)
   * created/affected, for the audit log.
   */
  execute: (customer: ReturnType<typeof getCustomer>) => Promise<string[]>;
}

/**
 * The ONLY function in this codebase permitted to perform a live Google Ads
 * mutation. Every service module (campaign-service, keyword-service, etc.)
 * must route writes through this — never call customer.mutateResources
 * directly. This keeps "did this go through the approval policy?" a
 * structural guarantee rather than a code-review hope.
 */
export async function guardedMutate(input: GuardedMutationInput): Promise<{
  executed: boolean;
  resourceNames?: string[];
  changeLogEntryId: string;
  approvalRequestId?: string;
}> {
  // checkPolicy throws ApprovalRequiredError for MEDIUM/HIGH risk in hard
  // mode — we deliberately let that propagate to the tool handler.
  const policyResult = await checkPolicy(input);

  try {
    const resourceNames = await input.execute(getCustomer(input.customerId));

    await prisma.changeLogEntry.update({
      where: { id: policyResult.changeLogEntryId },
      data: {
        status: "EXECUTED",
        executedAt: new Date(),
        resourceId: resourceNames[0] ?? null,
      },
    });

    log.info(
      { changeLogEntryId: policyResult.changeLogEntryId, resourceNames },
      "Mutation executed against live Google Ads account"
    );

    return {
      executed: true,
      resourceNames,
      changeLogEntryId: policyResult.changeLogEntryId,
    };
  } catch (err) {
    await prisma.changeLogEntry.update({
      where: { id: policyResult.changeLogEntryId },
      data: {
        status: "EXECUTION_FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw new GoogleAdsApiError(
      `Mutation was approved by policy but failed on execution (changeLogEntryId=${policyResult.changeLogEntryId})`,
      err
    );
  }
}

/**
 * Called by the approve_change / reject_change MCP tools once a human has
 * made a decision on a MEDIUM/HIGH risk ApprovalRequest. On approval, this
 * re-runs the ORIGINAL proposed mutation stored on the ChangeLogEntry —
 * the model does not get to silently substitute a different mutation at
 * approval time.
 */
export async function resolveApproval(
  approvalRequestId: string,
  decision: "APPROVED" | "REJECTED",
  decidedBy: string,
  decisionNote: string | undefined,
  execute: (customer: ReturnType<typeof getCustomer>) => Promise<string[]>,
  customerId: string
) {
  const approval = await prisma.approvalRequest.findUniqueOrThrow({
    where: { id: approvalRequestId },
    include: { changeLogEntry: true },
  });

  if (approval.status !== "PROPOSED") {
    throw new GoogleAdsApiError(
      `Approval request ${approvalRequestId} has already been resolved (status=${approval.status})`
    );
  }

  await prisma.approvalRequest.update({
    where: { id: approvalRequestId },
    data: { status: decision, decidedBy, decidedAt: new Date(), decisionNote },
  });

  if (decision === "REJECTED") {
    if (approval.changeLogEntry) {
      await prisma.changeLogEntry.update({
        where: { id: approval.changeLogEntry.id },
        data: { status: "REJECTED" },
      });
    }
    return { executed: false };
  }

  // APPROVED — execute the original mutation now.
  try {
    const resourceNames = await execute(getCustomer(customerId));
    if (approval.changeLogEntry) {
      await prisma.changeLogEntry.update({
        where: { id: approval.changeLogEntry.id },
        data: { status: "EXECUTED", executedAt: new Date(), resourceId: resourceNames[0] ?? null },
      });
    }
    return { executed: true, resourceNames };
  } catch (err) {
    if (approval.changeLogEntry) {
      await prisma.changeLogEntry.update({
        where: { id: approval.changeLogEntry.id },
        data: {
          status: "EXECUTION_FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    }
    throw new GoogleAdsApiError(`Approved mutation failed on execution`, err);
  }
}
