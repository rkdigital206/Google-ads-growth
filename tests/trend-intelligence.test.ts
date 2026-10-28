import { describe, it, expect } from "vitest";
import { classifyTrendDirection, getTrendSnapshot } from "../src/research/engines/trend-intelligence.js";
import type { TrendProvider, TrendTimeSeriesPoint } from "../src/research/providers/types.js";

function points(values: number[]): TrendTimeSeriesPoint[] {
  return values.map((interest, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, interest }));
}

describe("classifyTrendDirection", () => {
  it("returns INSUFFICIENT_DATA for fewer than 4 points", () => {
    expect(classifyTrendDirection(points([10, 20, 30])).direction).toBe("INSUFFICIENT_DATA");
  });

  it("classifies a clear upward trend as RISING", () => {
    const result = classifyTrendDirection(points([10, 12, 11, 30, 32, 31]));
    expect(result.direction).toBe("RISING");
    expect(result.momentum).toBeGreaterThan(0);
  });

  it("classifies a clear downward trend as DECLINING", () => {
    const result = classifyTrendDirection(points([40, 38, 39, 10, 9, 11]));
    expect(result.direction).toBe("DECLINING");
  });

  it("classifies a flat series as STABLE", () => {
    const result = classifyTrendDirection(points([20, 21, 19, 20, 22, 20]));
    expect(result.direction).toBe("STABLE");
  });

  it("classifies a highly erratic series as VOLATILE rather than guessing a direction", () => {
    const result = classifyTrendDirection(points([5, 80, 3, 90, 2, 85]));
    expect(result.direction).toBe("VOLATILE");
  });
});

describe("getTrendSnapshot (provider abstraction)", () => {
  it("returns PROVIDER_NOT_CONFIGURED (state BLOCKED) with no fabricated data when no provider is wired up", async () => {
    const result = await getTrendSnapshot(undefined, "client1", "used fridge dubai", "AE", { start: "2026-01-01", end: "2026-02-01" });
    expect(result.state).toBe("BLOCKED");
    expect(result.data).toBeNull();
    expect(result.issues.join()).toContain("PROVIDER_NOT_CONFIGURED");
  });

  it("returns TREND_DATA_UNAVAILABLE when the provider throws (required scenario G)", async () => {
    const failingProvider: TrendProvider = {
      name: "test-provider",
      getInterestOverTime: async () => {
        throw new Error("upstream API down");
      },
      getInterestByRegion: async () => [],
      getRelatedQueries: async () => [],
      getRelatedTopics: async () => [],
    };
    const result = await getTrendSnapshot(failingProvider, "client1", "topic", "AE", { start: "2026-01-01", end: "2026-02-01" });
    expect(result.state).toBe("FAILED");
    expect(result.issues.join()).toContain("TREND_DATA_UNAVAILABLE");
  });

  it("returns a COMPLETE snapshot with classified direction when the provider succeeds", async () => {
    const workingProvider: TrendProvider = {
      name: "test-provider",
      getInterestOverTime: async () => points([10, 12, 30, 35]),
      getInterestByRegion: async () => [],
      getRelatedQueries: async () => [{ query: "related term", kind: "TOP", value: 10 }],
      getRelatedTopics: async () => [],
    };
    const result = await getTrendSnapshot(workingProvider, "client1", "topic", "AE", { start: "2026-01-01", end: "2026-02-01" });
    expect(result.state).toBe("COMPLETE");
    expect(result.data?.direction).toBe("RISING");
    expect(result.data?.relatedQueries).toEqual(["related term"]);
  });
});
