import { describe, it, expect } from "vitest";
import { assessRisk } from "../src/safety/risk-engine.js";

describe("assessRisk", () => {
  it("classifies campaign creation as HIGH", () => {
    const result = assessRisk({ resourceType: "campaign", operation: "CREATE" });
    expect(result.riskLevel).toBe("HIGH");
  });

  it("classifies pausing a top performer as HIGH regardless of resource type", () => {
    const result = assessRisk({
      resourceType: "keyword",
      operation: "PAUSE",
      affectsTopPerformer: true,
    });
    expect(result.riskLevel).toBe("HIGH");
  });

  it("classifies pausing a non-top-performing keyword as LOW", () => {
    const result = assessRisk({
      resourceType: "keyword",
      operation: "PAUSE",
      affectsTopPerformer: false,
    });
    expect(result.riskLevel).toBe("LOW");
  });

  it("classifies small budget changes within threshold as LOW", () => {
    const result = assessRisk({
      resourceType: "budget",
      operation: "UPDATE",
      changePct: 10,
      newDailyBudget: 100,
    });
    expect(result.riskLevel).toBe("LOW");
  });

  it("classifies large budget changes as MEDIUM", () => {
    const result = assessRisk({
      resourceType: "budget",
      operation: "UPDATE",
      changePct: 50,
      newDailyBudget: 100,
    });
    expect(result.riskLevel).toBe("MEDIUM");
  });

  it("classifies a budget above the configured ceiling as HIGH even if % change is small", () => {
    const result = assessRisk({
      resourceType: "budget",
      operation: "UPDATE",
      changePct: 5,
      newDailyBudget: 100000,
    });
    expect(result.riskLevel).toBe("HIGH");
  });

  it("always classifies negative keywords as LOW", () => {
    const result = assessRisk({ resourceType: "negative_keyword", operation: "CREATE" });
    expect(result.riskLevel).toBe("LOW");
  });

  it("defaults unrecognized mutation shapes to HIGH (fail-safe)", () => {
    // @ts-expect-error deliberately testing an unhandled resourceType
    const result = assessRisk({ resourceType: "audience_signal", operation: "CREATE" });
    expect(result.riskLevel).toBe("HIGH");
  });
});
