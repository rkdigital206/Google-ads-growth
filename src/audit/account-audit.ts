/**
 * Google Ads Account Audit + Health Score (Phase E sections 7-8, hardened in E.1).
 *
 * Deterministic and read-only. No component score is AI-guessed. Every
 * dimension exposes: score, evidence, confidence, missingData, warnings.
 * Where a dimension can't be evaluated, its score is null and it is EXCLUDED
 * from the weighted average rather than defaulted to a passing or failing
 * score — an unscoreable dimension must not silently drag the overall score
 * in either direction. Metrics that are unavailable are reported as missing,
 * never fabricated.
 */

import { enumName, AdGroupStatusEnum } from "../google-ads/enum-utils.js";
import { getAccountSummary, listCampaigns, listAdGroups, type AccountSummary } from "../google-ads/account-service.js";
import { getConversionActions, getCampaignPerformance, getSearchTermReport, type DateRange } from "../google-ads/reporting-service.js";
import { listKeywords } from "../google-ads/keyword-service.js";
import { normalizeCampaignPerformance } from "../performance/normalize.js";
import { sumMetrics, type NormalizedMetrics } from "../performance/metrics.js";
import type { OptimizationConfig } from "../domain/optimization-config.js";
import { fromMicros } from "../utils/validation.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger({ module: "account-audit" });

export interface AuditComponentScore {
  dimension: string;
  /** 0-100. Null if this dimension could not be scored (no data). */
  score: number | null;
  weight: number;
  evidence: string[];
  /** 0-1 trust in this score — lower when the sample is small or inputs are missing. */
  confidence: number;
  /** Inputs this dimension wanted but did not have. */
  missingData: string[];
  /** Cautions about interpreting the score (small samples, no business target configured, etc.). */
  warnings: string[];
}

export interface AuditDataSufficiency {
  clicks: number | null;
  impressions: number | null;
  conversions: number | null;
  spend: number | null;
  /** True only when volume is high enough that account-level rates are meaningful. */
  sufficientForConclusions: boolean;
  reasons: string[];
}

export interface AuditAccountStats {
  campaignCount: number;
  enabledCampaignCount: number;
  adGroupCount: number | null;
  keywordCount: number | null;
  conversionActionCount: number;
  enabledConversionActionCount: number;
  searchTermCount: number | null;
}

export interface GoogleAdsAccountAudit {
  customerId: string;
  account: AccountSummary | null;
  overallScore: number | null;
  components: AuditComponentScore[];
  accountStats: AuditAccountStats;
  accountMetrics: NormalizedMetrics | null;
  dataSufficiency: AuditDataSufficiency;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  missingData: string[];
  recommendedActions: string[];
  /** Overall confidence — the minimum of the component confidences that fed the overall score, since an audit is only as trustworthy as its weakest scored input. */
  confidence: number;
}

export type AuditTargets = Pick<OptimizationConfig, "targetCPA" | "targetROAS">;

const WEIGHTS: Record<string, number> = {
  tracking: 0.25,
  structure: 0.15,
  wastedSpend: 0.25,
  conversionPerformance: 0.2,
  budgetUtilization: 0.15,
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** `null` means the conversion action list could not be retrieved (distinct from `[]`: the account has none configured). */
export function scoreTracking(conversionActions: { conversion_action: { status: string; counting_type: string } }[] | null): AuditComponentScore {
  const w = WEIGHTS.tracking ?? 0;
  if (conversionActions === null) {
    return { dimension: "tracking", score: null, weight: w, evidence: ["Conversion action list could not be retrieved."], confidence: 0, missingData: ["Conversion actions."], warnings: [] };
  }
  if (conversionActions.length === 0) {
    return { dimension: "tracking", score: 0, weight: w, evidence: ["No conversion actions found on this account."], confidence: 0.9, missingData: [], warnings: ["Without conversion tracking no conversion-based metric on this account can be trusted."] };
  }
  const enabled = conversionActions.filter((a) => a.conversion_action.status === "ENABLED");
  const score = Math.round((enabled.length / conversionActions.length) * 100);
  const warnings: string[] = [];
  const missingData: string[] = [];
  if (enabled.length === 0) warnings.push("Conversion actions exist but none are ENABLED.");
  const unknownCounting = enabled.filter((a) => a.conversion_action.counting_type === "UNKNOWN" || a.conversion_action.counting_type === "UNSPECIFIED").length;
  if (unknownCounting > 0) missingData.push(`${unknownCounting} enabled conversion action(s) have an unreadable counting type.`);
  return {
    dimension: "tracking",
    score,
    weight: w,
    evidence: [`${enabled.length} of ${conversionActions.length} configured conversion action(s) are ENABLED.`],
    // Config presence says nothing about whether the tags actually fire — cap confidence accordingly.
    confidence: 0.7,
    missingData,
    warnings: [...warnings, "Only configuration is audited here; whether tags actually fire/record correctly is not verifiable from this data."],
  };
}

export interface AdGroupRef {
  ad_group: { id: string; status: string | number };
  campaign: { id: string };
}

/**
 * Structure score from campaign count/status plus (when available) ad group
 * and keyword coverage. `adGroups` / `keywords` of `null` mean "that data was
 * unavailable" — distinct from an empty list (the account truly has none).
 */
export function scoreStructure(
  campaigns: { campaign: { id?: string; status: string; advertising_channel_type: string } }[],
  adGroups: AdGroupRef[] | null = null,
  keywords: { ad_group: { id: string } }[] | null = null
): AuditComponentScore {
  const w = WEIGHTS.structure ?? 0;
  if (campaigns.length === 0) {
    return { dimension: "structure", score: null, weight: w, evidence: ["No campaigns found — cannot evaluate structure."], confidence: 0, missingData: [], warnings: [] };
  }
  const active = campaigns.filter((c) => c.campaign.status === "ENABLED");
  const evidence = [`${campaigns.length} campaign(s), ${active.length} ENABLED.`];
  const missingData: string[] = [];
  const warnings: string[] = [];

  if (active.length === 0) {
    return { dimension: "structure", score: 20, weight: w, evidence, confidence: 0.6, missingData, warnings: ["No campaign is ENABLED."] };
  }

  const signals: number[] = [];
  const activeIds = new Set(active.map((c) => c.campaign.id).filter((id): id is string => id !== undefined));
  const enabledAdGroups = adGroups === null ? null : adGroups.filter((g) => String(g.ad_group.status) === "ENABLED");

  if (enabledAdGroups === null) {
    missingData.push("Ad group list unavailable — ad group coverage not evaluated.");
  } else {
    const campaignsWithAdGroups = new Set(enabledAdGroups.map((g) => g.campaign.id));
    const covered = [...activeIds].filter((id) => campaignsWithAdGroups.has(id)).length;
    const coverage = activeIds.size === 0 ? 0 : covered / activeIds.size;
    signals.push(coverage);
    evidence.push(`${enabledAdGroups.length} enabled ad group(s); ${Math.round(coverage * 100)}% of enabled campaigns have at least one enabled ad group.`);
    if (coverage < 1) warnings.push("Some enabled campaigns have no enabled ad group and cannot serve ads.");
  }

  if (keywords === null) {
    missingData.push("Keyword list unavailable — keyword coverage not evaluated.");
  } else if (enabledAdGroups === null) {
    missingData.push("Ad groups unavailable — keyword coverage per ad group not evaluated.");
  } else {
    const adGroupsOfActive = enabledAdGroups.filter((g) => activeIds.has(g.campaign.id));
    const withKeywords = new Set(keywords.map((k) => k.ad_group.id));
    const covered = adGroupsOfActive.filter((g) => withKeywords.has(g.ad_group.id)).length;
    const coverage = adGroupsOfActive.length === 0 ? 0 : covered / adGroupsOfActive.length;
    signals.push(coverage);
    evidence.push(`${keywords.length} keyword(s); ${Math.round(coverage * 100)}% of enabled ad groups in enabled campaigns have at least one keyword (non-keyword campaign types legitimately may not).`);
  }

  if (signals.length === 0) {
    return { dimension: "structure", score: 70, weight: w, evidence: [...evidence, "Coarse campaign-status check only; ad group and keyword data were unavailable."], confidence: 0.3, missingData, warnings };
  }
  return { dimension: "structure", score: Math.round(40 + 60 * mean(signals)), weight: w, evidence, confidence: signals.length === 2 ? 0.65 : 0.5, missingData, warnings };
}

export function scoreWastedSpend(
  searchTerms: { metrics: { clicks: string; cost_micros: string; conversions: number } }[],
  minClicksForEvidence = 10
): AuditComponentScore {
  const w = WEIGHTS.wastedSpend ?? 0;
  const evaluable = searchTerms.filter((t) => Number(t.metrics.clicks) >= minClicksForEvidence);
  if (evaluable.length === 0) {
    return {
      dimension: "wastedSpend",
      score: null,
      weight: w,
      evidence: [`${searchTerms.length} search term(s) returned; none reached the ${minClicksForEvidence}-click evidence threshold.`],
      confidence: 0,
      missingData: ["Search terms with enough clicks for evidence-based evaluation."],
      warnings: [],
    };
  }
  const wasted = evaluable.filter((t) => t.metrics.conversions === 0);
  const wastedSpendAmount = wasted.reduce((sum, t) => sum + fromMicros(t.metrics.cost_micros), 0);
  const totalSpendAmount = evaluable.reduce((sum, t) => sum + fromMicros(t.metrics.cost_micros), 0);
  const wastedFraction = totalSpendAmount === 0 ? 0 : wastedSpendAmount / totalSpendAmount;
  const score = Math.round((1 - wastedFraction) * 100);
  const warnings: string[] = [];
  if (evaluable.length < 5) warnings.push(`Only ${evaluable.length} evidence-eligible search term(s) — treat this score as indicative.`);
  const converting = evaluable.length - wasted.length;
  return {
    dimension: "wastedSpend",
    score,
    weight: w,
    evidence: [
      `${wasted.length} of ${evaluable.length} evidence-eligible (≥${minClicksForEvidence} clicks) search terms have zero conversions, totalling ${wastedSpendAmount.toFixed(2)} of ${totalSpendAmount.toFixed(2)} evaluated spend.`,
      `Search term quality: ${converting} of ${evaluable.length} evaluated terms convert (${Math.round((converting / evaluable.length) * 100)}%).`,
    ],
    confidence: evaluable.length >= 20 ? 0.8 : evaluable.length >= 5 ? 0.65 : 0.4,
    missingData: [],
    warnings,
  };
}

/** Minimum total conversions before CPA/ROAS-vs-target comparisons are treated as meaningful. */
const MIN_CONVERSIONS_FOR_TARGET_COMPARISON = 10;

export function scoreConversionPerformance(
  campaignRows: Parameters<typeof normalizeCampaignPerformance>[0][],
  targets: AuditTargets = { targetCPA: null, targetROAS: null }
): AuditComponentScore {
  const w = WEIGHTS.conversionPerformance ?? 0;
  if (campaignRows.length === 0) {
    return { dimension: "conversionPerformance", score: null, weight: w, evidence: ["No campaign performance data available."], confidence: 0, missingData: ["Campaign performance for the audited period."], warnings: [] };
  }
  const normalized = campaignRows.map(normalizeCampaignPerformance);
  const account = sumMetrics(normalized.map((c) => c.metrics));
  const spending = normalized.filter((c) => (c.metrics.cost ?? 0) > 0);
  const converting = spending.filter((c) => (c.metrics.conversions ?? 0) > 0);

  const evidence: string[] = [];
  const missingData: string[] = [];
  const warnings: string[] = [];
  const parts: { value: number; weight: number }[] = [];

  if (spending.length > 0) {
    const coverage = (converting.length / spending.length) * 100;
    parts.push({ value: coverage, weight: 1 });
    evidence.push(`${converting.length} of ${spending.length} spending campaign(s) recorded at least one conversion in the period.`);
  } else {
    warnings.push("No campaign recorded spend in the period.");
  }

  const fmt = (n: number | null, d = 2) => (n === null ? "n/a" : n.toFixed(d));
  evidence.push(
    `Account totals: spend ${fmt(account.cost)}, clicks ${fmt(account.clicks, 0)}, conversions ${fmt(account.conversions)}, conversion rate ${account.conversionRate === null ? "n/a" : (account.conversionRate * 100).toFixed(2) + "%"}, avg CPC ${fmt(account.cost !== null && account.clicks ? account.cost / account.clicks : null)}, CPA ${fmt(account.costPerConversion)}, ROAS ${fmt(account.roas)}.`
  );

  const lowVolume = (account.conversions ?? 0) < MIN_CONVERSIONS_FOR_TARGET_COMPARISON;
  if (lowVolume) warnings.push(`Only ${fmt(account.conversions, 1)} conversion(s) in the period (<${MIN_CONVERSIONS_FOR_TARGET_COMPARISON}) — CPA/ROAS comparisons are statistically weak.`);

  if (targets.targetCPA === null) {
    missingData.push("targetCPA (CPA could not be judged against a business target).");
  } else if (account.costPerConversion === null) {
    missingData.push("Account CPA (no conversions or cost recorded) — cannot compare to targetCPA.");
  } else {
    const cpaScore = clamp(100 * (targets.targetCPA / account.costPerConversion));
    parts.push({ value: cpaScore, weight: 2 });
    evidence.push(`CPA ${account.costPerConversion.toFixed(2)} vs configured target ${targets.targetCPA.toFixed(2)} (score ${Math.round(cpaScore)}).`);
  }

  if (targets.targetROAS === null) {
    missingData.push("targetROAS (ROAS could not be judged against a business target).");
  } else if (account.roas === null) {
    missingData.push("Account ROAS (no conversion value or cost recorded) — cannot compare to targetROAS.");
  } else {
    const roasScore = clamp(100 * (account.roas / targets.targetROAS));
    parts.push({ value: roasScore, weight: 2 });
    evidence.push(`ROAS ${account.roas.toFixed(2)} vs configured target ${targets.targetROAS.toFixed(2)} (score ${Math.round(roasScore)}).`);
  }

  if (parts.length === 0) {
    return { dimension: "conversionPerformance", score: null, weight: w, evidence, confidence: 0, missingData, warnings };
  }
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight);
  const usedTarget = parts.some((p) => p.weight === 2);
  if (!usedTarget) warnings.push("No business target was available, so this score only measures whether campaigns convert at all — not whether they convert profitably.");
  let confidence = usedTarget ? 0.7 : 0.45;
  if (lowVolume) confidence = Math.min(confidence, 0.35);
  return { dimension: "conversionPerformance", score, weight: w, evidence, confidence, missingData, warnings };
}

/** A search budget-lost impression share above this is treated as a meaningful budget constraint. */
const BUDGET_LOST_IS_THRESHOLD = 0.1;

export function scoreBudgetUtilization(
  campaigns: { campaign: { id?: string; status: string }; campaign_budget: { amount_micros: string } }[],
  campaignPerfRows: Parameters<typeof normalizeCampaignPerformance>[0][] = []
): AuditComponentScore {
  const w = WEIGHTS.budgetUtilization ?? 0;
  const active = campaigns.filter((c) => c.campaign.status === "ENABLED");
  if (active.length === 0) {
    return { dimension: "budgetUtilization", score: null, weight: w, evidence: ["No active campaigns to evaluate budget utilization."], confidence: 0, missingData: [], warnings: [] };
  }
  const zeroBudget = active.filter((c) => fromMicros(c.campaign_budget.amount_micros) === 0);
  const baseScore = zeroBudget.length === 0 ? 80 : Math.round(((active.length - zeroBudget.length) / active.length) * 80);
  const evidence = [`${zeroBudget.length} of ${active.length} active campaign(s) have a zero-amount budget (likely a configuration error).`];
  const missingData: string[] = [];
  const warnings: string[] = [];

  const activeIds = new Set(active.map((c) => c.campaign.id).filter((id): id is string => id !== undefined));
  const perf = campaignPerfRows.map(normalizeCampaignPerformance).filter((c) => activeIds.has(c.campaignId));
  const withLostIs = perf.filter((c) => c.metrics.searchBudgetLostImpressionShare !== null);

  if (withLostIs.length === 0) {
    missingData.push("search_budget_lost_impression_share (not returned for the active campaigns — e.g. non-Search campaigns or no impressions).");
    return { dimension: "budgetUtilization", score: baseScore, weight: w, evidence, confidence: 0.4, missingData, warnings };
  }

  const constrained = withLostIs.filter((c) => (c.metrics.searchBudgetLostImpressionShare ?? 0) > BUDGET_LOST_IS_THRESHOLD);
  const fraction = constrained.length / withLostIs.length;
  const score = Math.round(baseScore * (1 - fraction * 0.15));
  evidence.push(
    `${constrained.length} of ${withLostIs.length} campaign(s) with impression-share data lose more than ${Math.round(BUDGET_LOST_IS_THRESHOLD * 100)}% of search impression share to budget.`
  );
  if (constrained.length > 0) {
    warnings.push(`Budget-constrained: ${constrained.map((c) => c.campaignName).join(", ")}. Raising budget only helps if those campaigns are profitable.`);
  }
  return { dimension: "budgetUtilization", score, weight: w, evidence, confidence: withLostIs.length === active.length ? 0.65 : 0.5, missingData, warnings };
}

export async function auditGoogleAdsAccount(
  customerId: string,
  range: DateRange,
  targets: AuditTargets = { targetCPA: null, targetROAS: null }
): Promise<GoogleAdsAccountAudit> {
  const missingData: string[] = [];
  let account: AccountSummary | null = null;

  try {
    account = await getAccountSummary(customerId);
  } catch (err) {
    log.warn({ customerId, err }, "Could not fetch account summary for audit");
    missingData.push("Account metadata (currency/timezone/status) could not be retrieved.");
  }

  const [campaignsResult, conversionActionsResult, campaignPerfResult, searchTermsResult, keywordsResult, adGroupsResult] = await Promise.allSettled([
    listCampaigns(customerId),
    getConversionActions(customerId),
    getCampaignPerformance(customerId, range),
    getSearchTermReport(customerId, range),
    listKeywords(customerId),
    listAdGroups(customerId),
  ]);

  const campaigns = campaignsResult.status === "fulfilled" ? campaignsResult.value : [];
  if (campaignsResult.status === "rejected") missingData.push(`Campaign list unavailable: ${String(campaignsResult.reason)}`);

  const conversionActions = conversionActionsResult.status === "fulfilled" ? conversionActionsResult.value : null;
  if (conversionActionsResult.status === "rejected") missingData.push(`Conversion actions unavailable: ${String(conversionActionsResult.reason)}`);

  const campaignPerf = campaignPerfResult.status === "fulfilled" ? campaignPerfResult.value : [];
  if (campaignPerfResult.status === "rejected") missingData.push(`Campaign performance unavailable: ${String(campaignPerfResult.reason)}`);

  const searchTerms = searchTermsResult.status === "fulfilled" ? searchTermsResult.value : [];
  if (searchTermsResult.status === "rejected") missingData.push(`Search term report unavailable: ${String(searchTermsResult.reason)}`);

  const keywords = keywordsResult.status === "fulfilled" ? keywordsResult.value : null;
  if (keywordsResult.status === "rejected") missingData.push(`Keyword list unavailable: ${String(keywordsResult.reason)}`);

  const adGroupsRaw = adGroupsResult.status === "fulfilled" ? adGroupsResult.value : null;
  if (adGroupsResult.status === "rejected") missingData.push(`Ad group list unavailable: ${String(adGroupsResult.reason)}`);
  const adGroups: AdGroupRef[] | null =
    adGroupsRaw === null
      ? null
      : adGroupsRaw.map((g) => ({ ad_group: { id: String(g.ad_group.id), status: enumName(AdGroupStatusEnum, g.ad_group.status) }, campaign: { id: String(g.campaign.id) } }));

  const components = [
    scoreTracking(conversionActions),
    scoreStructure(campaigns, adGroups, keywords),
    scoreWastedSpend(searchTerms),
    scoreConversionPerformance(campaignPerf, targets),
    scoreBudgetUtilization(campaigns, campaignPerf),
  ];

  for (const c of components) {
    if (c.score === null) missingData.push(`${c.dimension}: not scored — ${c.missingData.join("; ") || c.evidence[0] || "insufficient data"}`);
  }

  const scoreable = components.filter((c) => c.score !== null);
  const totalWeight = scoreable.reduce((sum, c) => sum + c.weight, 0);
  const overallScore =
    scoreable.length === 0
      ? null
      : Math.round(scoreable.reduce((sum, c) => sum + (c.score ?? 0) * c.weight, 0) / (totalWeight || 1));

  const strengths = components.filter((c) => c.score !== null && c.score >= 75).map((c) => `${c.dimension}: ${c.score}/100 — ${c.evidence[0] ?? ""}`);
  const weaknesses = components.filter((c) => c.score !== null && c.score < 50).map((c) => `${c.dimension}: ${c.score}/100 — ${c.evidence[0] ?? ""}`);

  // Account-level metrics + data sufficiency.
  const accountMetrics = campaignPerf.length > 0 ? sumMetrics(campaignPerf.map((r) => normalizeCampaignPerformance(r).metrics)) : null;
  const reasons: string[] = [];
  if (accountMetrics === null) reasons.push("No campaign performance rows returned.");
  else {
    if ((accountMetrics.clicks ?? 0) < 100) reasons.push(`Only ${accountMetrics.clicks ?? 0} click(s) in the period (<100).`);
    if ((accountMetrics.conversions ?? 0) < MIN_CONVERSIONS_FOR_TARGET_COMPARISON) reasons.push(`Only ${accountMetrics.conversions ?? 0} conversion(s) in the period (<${MIN_CONVERSIONS_FOR_TARGET_COMPARISON}).`);
  }
  const dataSufficiency: AuditDataSufficiency = {
    clicks: accountMetrics?.clicks ?? null,
    impressions: accountMetrics?.impressions ?? null,
    conversions: accountMetrics?.conversions ?? null,
    spend: accountMetrics?.cost ?? null,
    sufficientForConclusions: accountMetrics !== null && reasons.length === 0,
    reasons,
  };

  const accountStats: AuditAccountStats = {
    campaignCount: campaigns.length,
    enabledCampaignCount: campaigns.filter((c) => c.campaign.status === "ENABLED").length,
    adGroupCount: adGroups === null ? null : adGroups.filter((g) => g.ad_group.status === "ENABLED").length,
    keywordCount: keywords === null ? null : keywords.length,
    conversionActionCount: conversionActions?.length ?? 0,
    enabledConversionActionCount: conversionActions?.filter((a) => a.conversion_action.status === "ENABLED").length ?? 0,
    searchTermCount: searchTermsResult.status === "fulfilled" ? searchTerms.length : null,
  };

  const risks: string[] = [];
  const trackingComponent = components.find((c) => c.dimension === "tracking");
  if (trackingComponent && trackingComponent.score !== null && trackingComponent.score < 50) {
    risks.push("Weak conversion tracking undermines every other metric on this account — treat all conversion-based recommendations with reduced confidence until this is fixed.");
  }
  if (!dataSufficiency.sufficientForConclusions) {
    risks.push(`Data volume is low (${reasons.join(" ") || "no performance data"}) — performance conclusions are provisional.`);
  }

  const opportunities: string[] = [];
  const wastedSpendComponent = components.find((c) => c.dimension === "wastedSpend");
  if (wastedSpendComponent && wastedSpendComponent.score !== null && wastedSpendComponent.score < 70) {
    opportunities.push("Meaningful wasted spend detected in search terms with zero conversions — see optimization/search-term-optimizer.ts output for specific negative-keyword candidates.");
  }
  const budgetComponent = components.find((c) => c.dimension === "budgetUtilization");
  if (budgetComponent && budgetComponent.warnings.some((w) => w.startsWith("Budget-constrained"))) {
    opportunities.push("One or more campaigns lose search impression share to budget. Investigate profitability first; only then consider a (human-approved) budget change.");
  }

  const recommendedActions: string[] = [];
  if (missingData.length > 0) {
    recommendedActions.push("Re-run this audit once the unavailable data sources above are resolved — the current overall score excludes them, so it is a partial picture.");
  }
  if (targets.targetCPA === null && targets.targetROAS === null) {
    recommendedActions.push("Configure targetCPA or targetROAS (update_client_profile, or derive via calculate_business_economics) so performance can be judged against the business, not just against itself.");
  }

  const confidences = scoreable.map((c) => c.confidence);
  const confidence = confidences.length === 0 ? 0 : Math.min(...confidences);

  return {
    customerId,
    account,
    overallScore,
    components,
    accountStats,
    accountMetrics,
    dataSufficiency,
    strengths,
    weaknesses,
    risks,
    opportunities,
    missingData,
    recommendedActions,
    confidence,
  };
}
