/**
 * Research signals (Phase E.1 section 13).
 *
 * Flattens a research run into a list of labeled statements so a reader can
 * always tell what is OBSERVED from what is merely concluded or guessed:
 *
 *   FACT        – directly observed in a source (an Ads metric, a provider-returned
 *                 series, text found on the page).
 *   INFERENCE   – derived from facts by a documented rule (trend direction, a
 *                 computed CPA ceiling, an audit weakness).
 *   HYPOTHESIS  – plausible but unvalidated (a rising trend with no conversion
 *                 evidence, a provider keyword idea).
 *   UNKNOWN     – no data. Stated as a gap; NEVER filled with a guess.
 *
 * Every signal carries source, retrievedAt, evidence and confidence. The only
 * signals allowed a null retrievedAt/confidence are UNKNOWN ones (there was
 * nothing retrieved). No volumes, trend values or competitor data are
 * synthesised here — this module only relabels what the engines returned.
 */

import type { EpistemicStatus, ResearchResult } from "./types.js";
import type { WebsiteIntelligenceResult } from "./engines/website-intelligence.js";
import type { TrendSnapshot } from "./engines/trend-intelligence.js";
import type { KeywordCandidate } from "./engines/keyword-research.js";
import type { ClassifiedCompetitor } from "./engines/competitor-research.js";
import type { GoogleAdsAccountAudit } from "../audit/account-audit.js";
import type { BusinessEconomicsSummary } from "../economics/economics-engine.js";
import { computeConfidence } from "./engines/confidence.js";

export const SIGNAL_CATEGORIES = ["WEBSITE", "ACCOUNT", "TREND", "KEYWORD", "COMPETITOR", "ECONOMICS", "PROVIDER"] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export interface ResearchSignal {
  id: string;
  category: SignalCategory;
  statement: string;
  epistemicStatus: EpistemicStatus;
  /** A ResearchSource value, or a provider name. */
  source: string;
  /** ISO timestamp of retrieval. Null ONLY for UNKNOWN signals. */
  retrievedAt: string | null;
  evidence: string[];
  /** 0-1. Null ONLY for UNKNOWN signals. */
  confidence: number | null;
}

export interface SignalInputs {
  generatedAt: string;
  website: ResearchResult<WebsiteIntelligenceResult>;
  accountAudit: GoogleAdsAccountAudit | null;
  accountAuditIssue: string | null;
  trends: ResearchResult<TrendSnapshot>[];
  keywordCandidates: KeywordCandidate[];
  competitors: ResearchResult<ClassifiedCompetitor[]>;
  economics: BusinessEconomicsSummary;
  /** Cap on per-keyword signals, to keep reports readable. */
  maxKeywordSignals?: number;
}

const unknown = (id: string, category: SignalCategory, statement: string, source: string, evidence: string[]): ResearchSignal => ({
  id,
  category,
  statement,
  epistemicStatus: "UNKNOWN",
  source,
  retrievedAt: null,
  evidence,
  confidence: null,
});

export function buildResearchSignals(input: SignalInputs): ResearchSignal[] {
  const signals: ResearchSignal[] = [];
  const at = input.generatedAt;

  // ---- Website ----
  if (input.website.state === "COMPLETE" && input.website.data) {
    input.website.data.claims.forEach((c, i) => {
      const conf = computeConfidence({ source: "WEBSITE", sampleSize: 1, ageInDays: 0, corroboratingSources: 1, businessRelevance: 0.7 });
      if (c.status === "UNKNOWN") {
        signals.push(unknown(`website-${i}`, "WEBSITE", c.claim, "WEBSITE", [c.basis]));
      } else {
        signals.push({
          id: `website-${i}`,
          category: "WEBSITE",
          statement: c.claim,
          epistemicStatus: c.status === "VERIFIED" ? "FACT" : "INFERENCE",
          source: "WEBSITE",
          retrievedAt: at,
          evidence: [c.basis],
          confidence: c.status === "VERIFIED" ? conf : Math.min(conf, 0.5),
        });
      }
    });
  } else {
    signals.push(unknown("website-unavailable", "WEBSITE", "Website content could not be analyzed.", "WEBSITE", input.website.issues.length ? input.website.issues : ["Website analysis was not attempted."]));
  }

  // ---- Google Ads account ----
  if (input.accountAudit) {
    const a = input.accountAudit;
    signals.push({
      id: "account-stats",
      category: "ACCOUNT",
      statement: `Account has ${a.accountStats.campaignCount} campaign(s) (${a.accountStats.enabledCampaignCount} enabled) and ${a.accountStats.enabledConversionActionCount} enabled conversion action(s).`,
      epistemicStatus: "FACT",
      source: "GOOGLE_ADS_ACCOUNT",
      retrievedAt: at,
      evidence: [`customerId ${a.customerId}`, `data sufficient for conclusions: ${a.dataSufficiency.sufficientForConclusions}`],
      confidence: 0.9,
    });
    a.weaknesses.forEach((w, i) =>
      signals.push({ id: `account-weakness-${i}`, category: "ACCOUNT", statement: w, epistemicStatus: "INFERENCE", source: "GOOGLE_ADS_ACCOUNT", retrievedAt: at, evidence: ["Deterministic audit scoring over account data."], confidence: a.confidence })
    );
    if (!a.dataSufficiency.sufficientForConclusions) {
      signals.push(unknown("account-data-insufficient", "ACCOUNT", "Account performance data volume is too low to draw reliable performance conclusions.", "GOOGLE_ADS_ACCOUNT", a.dataSufficiency.reasons));
    }
  } else {
    signals.push(unknown("account-unavailable", "ACCOUNT", "No Google Ads account data was available.", "GOOGLE_ADS_ACCOUNT", [input.accountAuditIssue ?? "No linked Google Ads account was supplied."]));
  }

  // ---- Trends ----
  if (input.trends.length === 0) {
    signals.push(unknown("trend-none", "TREND", "No trend research was attempted (no topics).", "GOOGLE_TRENDS", ["No productsOrServices or trendTopics were available."]));
  }
  input.trends.forEach((t, i) => {
    if (t.state === "COMPLETE" && t.data) {
      const snap = t.data;
      signals.push({
        id: `trend-series-${i}`,
        category: "TREND",
        statement: `Provider "${snap.source}" returned ${snap.series.length} interest data point(s) for "${snap.topic}" in "${snap.geography || "unspecified geography"}".`,
        epistemicStatus: "FACT",
        source: snap.source,
        retrievedAt: snap.retrievedAt,
        evidence: [`timeframe ${snap.timeframe.start} → ${snap.timeframe.end}`],
        confidence: computeConfidence({ source: "GOOGLE_TRENDS", sampleSize: snap.series.length, ageInDays: 0, corroboratingSources: 1, businessRelevance: 0.6 }),
      });
      signals.push({
        id: `trend-direction-${i}`,
        category: "TREND",
        statement: `Trend direction for "${snap.topic}" is ${snap.direction} (momentum ${snap.momentum === null ? "n/a" : snap.momentum.toFixed(2)}). This is a demand signal only, not evidence of profitable Google Ads performance.`,
        epistemicStatus: "INFERENCE",
        source: snap.source,
        retrievedAt: snap.retrievedAt,
        evidence: [`classified from ${snap.series.length} provider data point(s)`, ...snap.partialIssues],
        confidence: Math.min(0.6, computeConfidence({ source: "GOOGLE_TRENDS", sampleSize: snap.series.length, ageInDays: 0, corroboratingSources: 1, businessRelevance: 0.6 })),
      });
    } else {
      signals.push(unknown(`trend-unavailable-${i}`, "TREND", `Trend data is unavailable${t.code ? ` (${t.code})` : ""}.`, "GOOGLE_TRENDS", t.issues));
    }
  });

  // ---- Keywords ----
  const cap = input.maxKeywordSignals ?? 25;
  input.keywordCandidates.slice(0, cap).forEach((k, i) => {
    const cls = k.opportunity?.classification;
    const status: EpistemicStatus =
      k.source === "AI_EXPANSION" || cls === "PROMISING_UNVALIDATED" || cls === "TREND_ONLY" || k.source === "KEYWORD_RESEARCH_PROVIDER"
        ? "HYPOTHESIS"
        : cls === "INSUFFICIENT_EVIDENCE" || k.recommendation === "INSUFFICIENT_EVIDENCE"
          ? "UNKNOWN"
          : "INFERENCE";
    const evidence = [
      k.reason,
      ...(k.evidence ? [`Ads: ${k.evidence.clicks} clicks, ${k.evidence.conversions ?? "n/a"} conversions, cost ${k.evidence.cost === null ? "n/a" : k.evidence.cost.toFixed(2)}`] : []),
      ...(k.providerSearchVolume != null ? [`provider-reported search volume: ${k.providerSearchVolume}`] : []),
      ...(k.opportunity ? k.opportunity.rationale : []),
    ];
    const statement = `Keyword "${k.keyword}": ${cls ?? k.recommendation}.`;
    if (status === "UNKNOWN") signals.push(unknown(`keyword-${i}`, "KEYWORD", statement, k.source, evidence));
    else signals.push({ id: `keyword-${i}`, category: "KEYWORD", statement, epistemicStatus: status, source: k.source, retrievedAt: at, evidence, confidence: k.opportunity?.confidence ?? k.confidence });
  });

  // ---- Competitors ----
  if (input.competitors.state === "COMPLETE" && input.competitors.data) {
    input.competitors.data.forEach((c, i) =>
      signals.push({
        id: `competitor-${i}`,
        category: "COMPETITOR",
        statement: `${c.domain} appeared in search results for "${c.observedFor}" (classified ${c.classification}; SERP presence alone does not establish a direct competitor).`,
        epistemicStatus: "FACT",
        source: "COMPETITOR_RESEARCH",
        retrievedAt: at,
        evidence: [c.evidence],
        confidence: c.confidence,
      })
    );
  } else {
    signals.push(unknown("competitor-unavailable", "COMPETITOR", `Competitor data is unavailable${input.competitors.code ? ` (${input.competitors.code})` : ""}.`, "COMPETITOR_RESEARCH", input.competitors.issues));
  }

  // ---- Economics ----
  for (const r of [input.economics.breakEvenRoas, input.economics.targetRoas, input.economics.maxCpa, input.economics.targetCpa, input.economics.maxCac]) {
    if (!r) continue;
    if (r.calculable && r.value !== null) {
      signals.push({
        id: `economics-${r.metric}`,
        category: "ECONOMICS",
        statement: `${r.metric} = ${r.value.toFixed(2)}`,
        epistemicStatus: "INFERENCE",
        source: "CLIENT_PROVIDED",
        retrievedAt: at,
        evidence: [`formula: ${r.formula}`, `inputs: ${JSON.stringify(r.assumptionsUsed)}`],
        confidence: 0.7,
      });
    } else {
      signals.push(unknown(`economics-${r.metric}`, "ECONOMICS", `${r.metric} cannot be calculated.`, "CLIENT_PROVIDED", [`missing inputs: ${r.missingInputs.join(", ")}`]));
    }
  }

  return signals;
}
