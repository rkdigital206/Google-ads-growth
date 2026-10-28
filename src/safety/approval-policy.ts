import type { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../database/repositories/prisma-client.js";
import { assessRisk, type ProposedMutation } from "./risk-engine.js";
import { ApprovalRequiredError } from "../utils/errors.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "approval-policy" });

export interface PolicyCheckInput {
  accountId: string; // internal GoogleAdsAccount.id (not the Google customer ID)
  mutation: ProposedMutation;
  proposedState: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  reasoning: string;
  requestedByTool: string;
}

export interface PolicyCheckResult {
  allowed: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  changeLogEntryId: string;
  approvalRequestId?: string;
}

/**
 * Single choke point every mutation MUST pass through before touching the
 * live Google Ads API. This function:
 *   1. Classifies risk (risk-engine.ts)
 *   2. Writes an audit row (ChangeLogEntry) regardless of outcome
 *   3. For LOW risk: allows execution immediately
 *   4. For MEDIUM/HIGH: creates an ApprovalRequest and blocks, UNLESS
 *      APPROVAL_MODE=soft (dev/sandbox only — never use against a live
 *      client account)
 *
 * Callers should treat an ApprovalRequiredError as a normal, expected
 * outcome to report back to the model/user — not a bug.
 */
export async function checkPolicy(input: PolicyCheckInput): Promise<PolicyCheckResult> {
  const { riskLevel, reasons } = assessRisk(input.mutation);

  const changeLog = await prisma.changeLogEntry.create({
    data: {
      accountId: input.accountId,
      resourceType: input.mutation.resourceType,
      operation: input.mutation.operation,
      riskLevel,
      status: "PROPOSED",
      beforeState: (input.beforeState ?? undefined) as Prisma.InputJsonValue | undefined,
      proposedState: input.proposedState as Prisma.InputJsonValue,
      reasoning: input.reasoning,
      requestedByTool: input.requestedByTool,
    },
  });

  log.info(
    { changeLogEntryId: changeLog.id, riskLevel, reasons, tool: input.requestedByTool },
    "Mutation evaluated by risk engine"
  );

  if (riskLevel === "LOW") {
    return { allowed: true, riskLevel, changeLogEntryId: changeLog.id };
  }

  if (env.APPROVAL_MODE === "soft") {
    log.warn(
      { changeLogEntryId: changeLog.id, riskLevel },
      "APPROVAL_MODE=soft — allowing risky mutation WITHOUT human approval. Never run this against a live client account."
    );
    return { allowed: true, riskLevel, changeLogEntryId: changeLog.id };
  }

  // hard mode (default, and the only acceptable mode for a real client account)
  const approval = await prisma.approvalRequest.create({
    data: {
      accountId: input.accountId,
      summary: `${input.mutation.operation} ${input.mutation.resourceType}: ${input.reasoning}`,
      detailJson: {
        mutation: input.mutation,
        proposedState: input.proposedState,
        beforeState: input.beforeState ?? null,
        riskReasons: reasons,
      } as unknown as Prisma.InputJsonValue,
      riskLevel,
      status: "PROPOSED",
    },
  });

  await prisma.changeLogEntry.update({
    where: { id: changeLog.id },
    data: { approvalRequestId: approval.id },
  });

  throw new ApprovalRequiredError(
    `This ${input.mutation.operation} on ${input.mutation.resourceType} is risk level ${riskLevel} and requires human approval before it will execute. ` +
      `Reasons: ${reasons.join(" ")} Call the approve_change tool with approvalRequestId="${approval.id}" to proceed, or reject_change to discard it.`,
    approval.id
  );
}
