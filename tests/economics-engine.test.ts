import { describe, it, expect } from "vitest";
import {
  calculateBreakEvenRoas,
  calculateTargetRoas,
  calculateMaxCpa,
  calculateTargetCpa,
  calculateMaxCac,
  calculateBusinessEconomics,
} from "../src/economics/economics-engine.js";
import { emptyOptimizationConfig } from "../src/domain/optimization-config.js";

describe("calculateBreakEvenRoas", () => {
  it("is not calculable when grossMargin is missing", () => {
    const result = calculateBreakEvenRoas(emptyOptimizationConfig());
    expect(result.calculable).toBe(false);
    expect(result.missingInputs).toContain("grossMargin");
  });

  it("computes 1/margin correctly", () => {
    const config = { ...emptyOptimizationConfig(), grossMargin: 0.4 };
    const result = calculateBreakEvenRoas(config);
    expect(result.calculable).toBe(true);
    expect(result.value).toBeCloseTo(2.5);
  });

  it("rejects a margin expressed as a percentage instead of a fraction", () => {
    const config = { ...emptyOptimizationConfig(), grossMargin: 40 }; // should be 0.4, not 40
    const result = calculateBreakEvenRoas(config);
    expect(result.calculable).toBe(false);
  });
});

describe("calculateTargetRoas", () => {
  it("uses the client-configured targetROAS directly when supplied, without deriving one", () => {
    const config = { ...emptyOptimizationConfig(), grossMargin: 0.4, targetROAS: 5 };
    const result = calculateTargetRoas(config);
    expect(result.value).toBe(5);
    expect(result.formula).toContain("client-configured");
  });

  it("derives a buffered target ROAS above break-even when the client hasn't set one", () => {
    const config = { ...emptyOptimizationConfig(), grossMargin: 0.4 };
    const result = calculateTargetRoas(config);
    expect(result.calculable).toBe(true);
    expect(result.value).toBeGreaterThan(2.5); // above break-even of 2.5
  });
});

describe("calculateMaxCpa", () => {
  it("is not calculable with missing leadValue or leadToSaleRate", () => {
    const result = calculateMaxCpa(emptyOptimizationConfig());
    expect(result.calculable).toBe(false);
    expect(result.missingInputs).toEqual(expect.arrayContaining(["leadValue", "leadToSaleRate"]));
  });

  it("computes leadValue x leadToSaleRate", () => {
    const config = { ...emptyOptimizationConfig(), leadValue: 200, leadToSaleRate: 0.25 };
    const result = calculateMaxCpa(config);
    expect(result.calculable).toBe(true);
    expect(result.value).toBeCloseTo(50);
  });
});

describe("calculateTargetCpa", () => {
  it("uses the client-configured targetCPA directly when supplied", () => {
    const config = { ...emptyOptimizationConfig(), targetCPA: 40 };
    const result = calculateTargetCpa(config);
    expect(result.value).toBe(40);
    expect(result.formula).toContain("client-configured");
  });

  it("derives target CPA as a safety-margined fraction of max CPA", () => {
    const config = { ...emptyOptimizationConfig(), leadValue: 200, leadToSaleRate: 0.25 }; // max CPA = 50
    const result = calculateTargetCpa(config);
    expect(result.calculable).toBe(true);
    expect(result.value).toBeCloseTo(40); // 50 * 0.8 safety margin
    expect(result.value).toBeLessThan(50);
  });
});

describe("calculateMaxCac", () => {
  it("is not calculable without lifetimeValue", () => {
    const result = calculateMaxCac(emptyOptimizationConfig());
    expect(result.calculable).toBe(false);
    expect(result.missingInputs).toContain("lifetimeValue");
  });

  it("NEVER treats leadValue as LTV: leadValue alone yields no max CAC", () => {
    const config = { ...emptyOptimizationConfig(), leadValue: 1000, leadToSaleRate: 0.3 };
    const result = calculateMaxCac(config);
    expect(result.calculable).toBe(false);
    expect(result.value).toBeNull();
    expect(result.missingInputs).toContain("lifetimeValue");
  });

  it("does NOT silently default leadToSaleRate to 1.0", () => {
    const config = { ...emptyOptimizationConfig(), lifetimeValue: 1000 };
    const result = calculateMaxCac(config);
    expect(result.calculable).toBe(false);
    expect(result.value).toBeNull();
    expect(result.missingInputs).toContain("leadToSaleRate");
  });

  it("computes precisely when lifetimeValue and leadToSaleRate are both configured", () => {
    const config = { ...emptyOptimizationConfig(), lifetimeValue: 1000, leadToSaleRate: 0.3 };
    const result = calculateMaxCac(config);
    expect(result.value).toBeCloseTo(300);
    expect(result.missingInputs).toEqual([]);
    expect(result.assumptionsUsed).toEqual({ lifetimeValue: 1000, leadToSaleRate: 0.3 });
  });

  it("keeps leadValue-based maxCpa independent of lifetimeValue", () => {
    const config = { ...emptyOptimizationConfig(), leadValue: 200, lifetimeValue: 5000, leadToSaleRate: 0.25 };
    expect(calculateMaxCpa(config).value).toBeCloseTo(50);
    expect(calculateMaxCac(config).value).toBeCloseTo(1250);
  });
});

describe("calculateBusinessEconomics — business-type gating", () => {
  it("only computes ROAS metrics for ecommerce-like businesses, not CAC/CPA", () => {
    const config = { ...emptyOptimizationConfig(), grossMargin: 0.4 };
    const result = calculateBusinessEconomics("ECOMMERCE", config);
    expect(result.breakEvenRoas).not.toBeNull();
    expect(result.targetRoas).not.toBeNull();
    expect(result.maxCpa).toBeNull();
    expect(result.maxCac).toBeNull();
  });

  it("only computes CPA metrics for lead-gen-like businesses, not ROAS/CAC", () => {
    const config = { ...emptyOptimizationConfig(), leadValue: 200, leadToSaleRate: 0.25 };
    const result = calculateBusinessEconomics("LOCAL_SERVICE", config);
    expect(result.maxCpa).not.toBeNull();
    expect(result.targetCpa).not.toBeNull();
    expect(result.breakEvenRoas).toBeNull();
    expect(result.maxCac).toBeNull();
  });

  it("only computes CAC for SaaS businesses", () => {
    const config = { ...emptyOptimizationConfig(), lifetimeValue: 1000, leadToSaleRate: 0.3 };
    const result = calculateBusinessEconomics("SAAS", config);
    expect(result.maxCac).not.toBeNull();
    expect(result.breakEvenRoas).toBeNull();
    expect(result.maxCpa).toBeNull();
  });

  it("computes nothing for an unclassified (null) business type", () => {
    const result = calculateBusinessEconomics(null, emptyOptimizationConfig());
    expect(result.breakEvenRoas).toBeNull();
    expect(result.maxCpa).toBeNull();
    expect(result.maxCac).toBeNull();
  });
});
