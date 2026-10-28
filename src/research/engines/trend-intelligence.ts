/**
 * Trend intelligence engine (Phase D sections 11-16).
 *
 * IMPORTANT — no real TrendProvider is configured in this project as of
 * this phase. No Google Trends API credentials, no third-party trend data
 * source, nothing. This engine is fully implemented and ready to consume
 * any TrendProvider implementation (see research/providers/types.ts), but
 * calling it today with no provider wired up will correctly and honestly
 * return PROVIDER_NOT_CONFIGURED — never fabricated trend numbers.
 *
 * Section 13's rule is enforced structurally, not just by convention: this
 * engine's return type has no field that could be mistaken for a mutation
 * decision. It produces a TrendSnapshot + direction classification only.
 * Nothing here creates keywords, budgets, or campaigns.
 */

import type { TrendProvider, TrendTimeSeriesPoint, TrendDirection, TrendInterestByRegion } from "../providers/types.js";
import type { ResearchResult } from "../types.js";

export interface TrendSnapshot {
  clientId: string;
  topic: string;
  geography: string;
  timeframe: { start: string; end: string };
  series: TrendTimeSeriesPoint[];
  direction: TrendDirection;
  /** Simple momentum measure: recent-period average minus prior-period average, as a fraction of the prior-period average. Null if too few data points. */
  momentum: number | null;
  relatedQueries: string[];
  /** Related topics from the provider; empty if the provider returned none or the call failed (see `partialIssues`). */
  relatedTopics: string[];
  /** Interest by region from the provider; empty if unavailable (see `partialIssues`). */
  geographicInterest: TrendInterestByRegion[];
  /** Non-fatal provider call failures — the snapshot is still valid for the calls that succeeded. */
  partialIssues: string[];
  source: string;
  retrievedAt: string;
}

/**
 * Classifies a time series into a TrendDirection. Conservative by design:
 * fewer than 4 data points is INSUFFICIENT_DATA, not a guess. High
 * variance without a clear up/down trend is VOLATILE, not RISING or
 * DECLINING — the brief is explicit that trend ≠ profit and a shaky signal
 * must not look more confident than it is.
 */
export function classifyTrendDirection(series: TrendTimeSeriesPoint[]): { direction: TrendDirection; momentum: number | null } {
  if (series.length < 4) {
    return { direction: "INSUFFICIENT_DATA", momentum: null };
  }

  const mid = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, mid);
  const secondHalf = series.slice(mid);
  const avg = (points: TrendTimeSeriesPoint[]) => points.reduce((sum, p) => sum + p.interest, 0) / points.length;
  const coefficientOfVariation = (segment: TrendTimeSeriesPoint[]) => {
    const mean = avg(segment);
    if (mean === 0) return 0;
    const variance = segment.reduce((sum, p) => sum + (p.interest - mean) ** 2, 0) / segment.length;
    return Math.sqrt(variance) / mean;
  };

  const firstAvg = avg(firstHalf);
  const secondAvg = avg(secondHalf);
  const momentum = firstAvg === 0 ? null : (secondAvg - firstAvg) / firstAvg;

  // Volatility is measured WITHIN each half (how noisy the wobble is around
  // that half's own average), not across the whole series — a clean step
  // change from a low plateau to a high plateau (or vice versa) naturally
  // has high overall variance without being "volatile" in the sense that
  // matters here (erratic, hard-to-trust movement).
  const meanWithinHalfCv = (coefficientOfVariation(firstHalf) + coefficientOfVariation(secondHalf)) / 2;

  if (momentum === null) {
    return { direction: "UNKNOWN", momentum: null };
  }
  if (meanWithinHalfCv > 0.5) {
    return { direction: "VOLATILE", momentum };
  }
  if (momentum > 0.15) {
    return { direction: "RISING", momentum };
  }
  if (momentum < -0.15) {
    return { direction: "DECLINING", momentum };
  }
  return { direction: "STABLE", momentum };
}

export async function getTrendSnapshot(
  provider: TrendProvider | undefined,
  clientId: string,
  topic: string,
  geography: string,
  timeframe: { start: string; end: string }
): Promise<ResearchResult<TrendSnapshot>> {
  if (!provider) {
    return { state: "BLOCKED", code: "PROVIDER_NOT_CONFIGURED", data: null, issues: ["PROVIDER_NOT_CONFIGURED: no TrendProvider is configured in the ResearchProviderRegistry. No trend data is available and none has been estimated."] };
  }

  try {
    // Interest-over-time is REQUIRED; the other three provider calls are
    // supplementary and are allowed to fail without discarding the series.
    const [seriesR, queriesR, topicsR, regionsR] = await Promise.allSettled([
      provider.getInterestOverTime(topic, geography, timeframe),
      provider.getRelatedQueries(topic, geography),
      provider.getRelatedTopics(topic, geography),
      provider.getInterestByRegion(topic, geography),
    ]);
    if (seriesR.status === "rejected") throw seriesR.reason;
    const series = seriesR.value;
    const partialIssues: string[] = [];
    const settle = <T,>(r: PromiseSettledResult<T>, label: string, fallback: T): T => {
      if (r.status === "fulfilled") return r.value;
      partialIssues.push(`${label} unavailable: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      return fallback;
    };
    const relatedQueries = settle(queriesR, "relatedQueries", []);
    const relatedTopics = settle(topicsR, "relatedTopics", [] as string[]);
    const geographicInterest = settle(regionsR, "geographicInterest", [] as TrendInterestByRegion[]);

    if (series.length === 0) {
      return { state: "PARTIAL", code: "DATA_UNAVAILABLE", data: null, issues: ["TREND_DATA_UNAVAILABLE: provider returned no data for this topic/geography/timeframe."] };
    }

    const { direction, momentum } = classifyTrendDirection(series);

    return {
      state: "COMPLETE",
      data: {
        clientId,
        topic,
        geography,
        timeframe,
        series,
        direction,
        momentum,
        relatedQueries: relatedQueries.map((q) => q.query),
        relatedTopics,
        geographicInterest,
        partialIssues,
        source: provider.name,
        retrievedAt: new Date().toISOString(),
      },
      issues: [],
    };
  } catch (err) {
    return {
      state: "FAILED",
      code: "PROVIDER_ERROR",
      data: null,
      issues: [`TREND_DATA_UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
