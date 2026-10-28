/**
 * READ-ONLY dashboard queries. Nothing here writes to the database or calls
 * Google Ads. Approving/rejecting changes stays in the MCP tools (decide_approval)
 * so the safety chain remains the single write path.
 */
import { prisma } from "../database/repositories/prisma-client.js";
import { toBusinessProfile, toOptimizationConfig } from "../database/repositories/client-repo.js";
import { assessOnboardingCompleteness } from "../onboarding/engine.js";
import { env } from "../config/env.js";

export const DASHBOARD_VIEWS = ["overview", "clients", "accounts", "approvals", "changes"] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function getOverview() {
  const [clients, accounts, managers, pendingApprovals, changes24h, executed] = await Promise.all([
    prisma.client.count(),
    prisma.googleAdsAccount.count(),
    prisma.googleAdsAccount.count({ where: { accountType: "MANAGER" } }),
    prisma.approvalRequest.count({ where: { status: "PROPOSED" } }),
    prisma.changeLogEntry.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.changeLogEntry.count({ where: { status: "EXECUTED" } }),
  ]);
  return {
    counts: { clients, accounts, managerAccounts: managers, pendingApprovals, changesLast24h: changes24h, executedChanges: executed },
    config: {
      approvalMode: env.APPROVAL_MODE,
      googleAdsConfigured: Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_REFRESH_TOKEN),
      loginCustomerIdSet: Boolean(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
    },
  };
}

export async function getClients() {
  const rows = await prisma.client.findMany({ include: { locations: true, accounts: { select: { customerId: true } } }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => {
    const profile = toBusinessProfile(row);
    const report = assessOnboardingCompleteness(profile, toOptimizationConfig(row));
    return {
      id: row.id,
      name: row.name,
      businessType: row.businessType,
      website: row.website,
      currency: row.currency,
      growthGoal: row.growthGoal,
      trackingStatus: row.trackingStatus,
      linkedAccounts: row.accounts.length,
      onboarding: {
        completenessPct: Math.round(report.completeness * 100),
        readyForResearch: report.readyForResearch,
        readyForEconomics: report.readyForEconomicsCalculation,
        missingCriticalFields: report.missingCriticalFields,
        nextQuestion: report.nextQuestions[0]?.question ?? null,
      },
    };
  });
}

export async function getAccounts() {
  const rows = await prisma.googleAdsAccount.findMany({ include: { client: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } });
  return rows.map((a) => ({
    customerId: a.customerId,
    name: a.descriptiveName,
    type: a.accountType,
    currency: a.currencyCode,
    timeZone: a.timeZone,
    managerAccountId: a.managerAccountId,
    client: a.client,
    linkedAt: iso(a.createdAt),
  }));
}

export async function getApprovals() {
  const rows = await prisma.approvalRequest.findMany({ include: { account: { select: { customerId: true, descriptiveName: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    riskLevel: r.riskLevel,
    summary: r.summary,
    account: r.account,
    createdAt: iso(r.createdAt),
    decidedBy: r.decidedBy,
    decidedAt: iso(r.decidedAt),
    decisionNote: r.decisionNote,
    proposedChange: r.detailJson,
  }));
}

export async function getChanges() {
  const rows = await prisma.changeLogEntry.findMany({ include: { account: { select: { customerId: true, descriptiveName: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((c) => ({
    id: c.id,
    createdAt: iso(c.createdAt),
    executedAt: iso(c.executedAt),
    account: c.account,
    resourceType: c.resourceType,
    operation: c.operation,
    riskLevel: c.riskLevel,
    status: c.status,
    reasoning: c.reasoning,
    tool: c.requestedByTool,
    errorMessage: c.errorMessage,
  }));
}

export async function getDashboardView(view: DashboardView) {
  switch (view) {
    case "overview": return getOverview();
    case "clients": return getClients();
    case "accounts": return getAccounts();
    case "approvals": return getApprovals();
    case "changes": return getChanges();
  }
}
