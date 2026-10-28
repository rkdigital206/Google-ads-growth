/**
 * Account ↔ client linking (Phase E.1 section 6 and 15).
 *
 * Flow: DISCOVER (list_google_ads_accounts) → INSPECT (account summary +
 * type) → ASSIGN (link_google_ads_account, explicit clientId + customerId) →
 * STORE (GoogleAdsAccount row) → AUDIT → STRATEGY.
 *
 * A discovered account is never auto-assigned. Every account-scoped tool
 * calls `assertAccountBelongsToClient` before returning client-specific
 * output, so a customerId that is unlinked, or linked to a DIFFERENT client,
 * is rejected.
 */

import type { GoogleAdsAccountType, GoogleAdsAccount } from "@prisma/client";
import { prisma } from "./prisma-client.js";
import { ValidationError, NotFoundError } from "../../utils/errors.js";

export function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/-/g, "").trim();
}

export interface LinkAccountInput {
  clientId: string;
  customerId: string;
  accountType: GoogleAdsAccountType;
  descriptiveName?: string | null;
  currencyCode?: string | null;
  timeZone?: string | null;
  managerAccountId?: string | null;
}

/**
 * Pure policy check, separated from the DB call so it is unit-testable.
 * MANAGER accounts hold no campaigns and cannot be an ad account for a client.
 */
export function assertLinkable(accountType: GoogleAdsAccountType, customerId: string): void {
  if (accountType === "MANAGER") {
    throw new ValidationError(
      `Customer ${customerId} is a MANAGER (MCC) account and cannot be linked to a client as an ad account. Link one of its child client accounts instead (see list_google_ads_accounts).`
    );
  }
  if (accountType === "UNKNOWN") {
    throw new ValidationError(
      `Customer ${customerId} could not be inspected, so its account type is UNKNOWN. Resolve access/inspection errors before linking it to a client.`
    );
  }
}

export async function linkGoogleAdsAccount(input: LinkAccountInput): Promise<GoogleAdsAccount> {
  const customerId = normalizeCustomerId(input.customerId);
  assertLinkable(input.accountType, customerId);

  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
  if (!client) throw new NotFoundError(`No client found with id ${input.clientId}`);

  const existing = await prisma.googleAdsAccount.findUnique({ where: { customerId } });
  if (existing && existing.clientId !== input.clientId) {
    throw new ValidationError(
      `Customer ${customerId} is already linked to a different client (${existing.clientId}). Unlink it first; accounts are never silently reassigned.`
    );
  }

  const data = {
    accountType: input.accountType,
    descriptiveName: input.descriptiveName ?? null,
    currencyCode: input.currencyCode ?? null,
    timeZone: input.timeZone ?? null,
    managerAccountId: input.managerAccountId ?? null,
    isManagerLinked: input.managerAccountId != null,
  };

  if (existing) {
    return prisma.googleAdsAccount.update({ where: { customerId }, data });
  }
  return prisma.googleAdsAccount.create({ data: { clientId: input.clientId, customerId, ...data } });
}

export async function getLinkedAccountsForClient(clientId: string): Promise<GoogleAdsAccount[]> {
  return prisma.googleAdsAccount.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
}

export async function getLinkedCustomerIds(): Promise<Map<string, string>> {
  const rows = await prisma.googleAdsAccount.findMany({ select: { customerId: true, clientId: true } });
  return new Map(rows.map((r) => [r.customerId, r.clientId]));
}

/** Returns the linked account row, or null if this customerId is not linked to THIS client. */
export async function verifyAccountBelongsToClient(clientId: string, customerId: string): Promise<GoogleAdsAccount | null> {
  const account = await prisma.googleAdsAccount.findUnique({ where: { customerId: normalizeCustomerId(customerId) } });
  if (!account || account.clientId !== clientId) return null;
  return account;
}

/**
 * Throws unless `customerId` is linked to `clientId`. Distinguishes
 * "unlinked" from "linked to someone else" in the message, without leaking
 * the other client's id.
 */
export async function assertAccountBelongsToClient(clientId: string, customerId: string): Promise<GoogleAdsAccount> {
  const normalized = normalizeCustomerId(customerId);
  const account = await prisma.googleAdsAccount.findUnique({ where: { customerId: normalized } });
  if (!account) {
    throw new ValidationError(
      `Customer ${normalized} is not linked to any client. Run list_google_ads_accounts, then link_google_ads_account to assign it to client ${clientId} before auditing or planning against it.`
    );
  }
  if (account.clientId !== clientId) {
    throw new ValidationError(
      `Customer ${normalized} is not linked to client ${clientId}. Refusing cross-client operation.`
    );
  }
  return account;
}

/**
 * Pure check: a Google Ads resource name ("customers/<id>/campaigns/<id>", ...)
 * must belong to the customer the caller says they are acting on. Prevents a
 * mutation request that names customer A but carries customer B's resource.
 */
export function assertResourceBelongsToCustomer(customerId: string, resourceName: string): void {
  const normalized = normalizeCustomerId(customerId);
  if (!resourceName.startsWith(`customers/${normalized}/`)) {
    throw new ValidationError(`Resource "${resourceName}" does not belong to customer ${normalized}. Refusing cross-account operation.`);
  }
}

/**
 * Gate for every account-mutating tool. The internal account record, the
 * Google customer ID and the client must all agree, and the account must be
 * a linked CLIENT account — an unassigned, ambiguous or manager account can
 * never be the target of a mutation plan. This runs BEFORE the existing
 * risk-engine → approval-policy → mutation-guard chain, which is unchanged.
 */
export async function assertMutationTarget(input: { clientId: string; customerId: string; accountId: string }): Promise<GoogleAdsAccount> {
  const account = await prisma.googleAdsAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new ValidationError(`Unknown account record ${input.accountId}. Link the account first (link_google_ads_account).`);
  if (account.clientId !== input.clientId) throw new ValidationError(`Account record ${input.accountId} is not linked to client ${input.clientId}. Refusing cross-client operation.`);
  if (account.customerId !== normalizeCustomerId(input.customerId)) {
    throw new ValidationError(`Account record ${input.accountId} is customer ${account.customerId}, not ${normalizeCustomerId(input.customerId)}. Refusing mismatched target.`);
  }
  if (account.accountType !== "CLIENT") {
    throw new ValidationError(`Account ${account.customerId} has type ${account.accountType}; only linked CLIENT accounts can be mutation targets.`);
  }
  return account;
}
