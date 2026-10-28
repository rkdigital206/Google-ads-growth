import { describe, it, expect } from "vitest";
import { classifyTermAgainstIntents, isKnownIntent, type CustomIntentDefinition } from "../src/domain/intent.js";
import { MUROOJ_PROFILE } from "../src/domain/client-fixtures/murooj.fixture.js";

const BUY: CustomIntentDefinition = {
  key: "BUY",
  label: "Buy",
  description: "test",
  exampleQueries: [],
  conversionGoal: "test",
  signalWords: ["buy", "used", "second hand"],
};
const SELL: CustomIntentDefinition = {
  key: "SELL",
  label: "Sell",
  description: "test",
  exampleQueries: [],
  conversionGoal: "test",
  signalWords: ["sell", "cash for"],
};

describe("classifyTermAgainstIntents (generic, data-driven)", () => {
  it("classifies a term matching exactly one client-defined intent", () => {
    const result = classifyTermAgainstIntents("used fridge dubai", [BUY, SELL]);
    expect(result.intent).toBe("BUY");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns UNKNOWN with zero confidence when no custom intents match", () => {
    const result = classifyTermAgainstIntents("weather forecast dubai", [BUY, SELL]);
    expect(result.intent).toBe("UNKNOWN");
    expect(result.confidence).toBe(0);
  });

  it("returns UNKNOWN when a term is genuinely ambiguous between two intents", () => {
    // "buy" and "sell" signal words are contrived to both be present, so
    // the classifier must not guess between the two.
    const result = classifyTermAgainstIntents("buy or sell used fridge", [BUY, SELL]);
    expect(result.intent).toBe("UNKNOWN");
  });

  it("works for entirely different client-defined intents (not BUY/SELL at all)", () => {
    const trial: CustomIntentDefinition = {
      key: "TRIAL_INTENT",
      label: "Free trial",
      description: "test",
      exampleQueries: [],
      conversionGoal: "test",
      signalWords: ["free trial", "try for free"],
    };
    const result = classifyTermAgainstIntents("crm free trial", [trial]);
    expect(result.intent).toBe("TRIAL_INTENT");
  });

  it("with an empty custom intent list (a client with none configured), always returns UNKNOWN", () => {
    const result = classifyTermAgainstIntents("used fridge dubai", []);
    expect(result.intent).toBe("UNKNOWN");
  });
});

describe("isKnownIntent", () => {
  it("recognizes standard intent types regardless of custom intents", () => {
    expect(isKnownIntent("BRAND", [])).toBe(true);
  });

  it("recognizes a client's custom intent key", () => {
    expect(isKnownIntent("BUY", [BUY])).toBe(true);
  });

  it("rejects an intent that is neither standard nor configured for this client", () => {
    expect(isKnownIntent("BUY", [SELL])).toBe(false);
  });
});

describe("Murooj fixture used as TEST DATA through the generic classifier (no runtime shim)", () => {
  const intents = MUROOJ_PROFILE.customIntents;

  it("classifies BUY/SELL terms using only fixture-supplied signal words", () => {
    expect(classifyTermAgainstIntents("used fridge dubai", intents).intent).toBe("BUY");
    expect(classifyTermAgainstIntents("sell my fridge dubai", intents).intent).toBe("SELL");
    // Ambiguous: "used" is a BUY signal and "sell" is a SELL signal. The classifier must NOT guess.
    expect(classifyTermAgainstIntents("sell used fridge dubai", intents).intent).toBe("UNKNOWN");
    expect(classifyTermAgainstIntents("weather dubai", intents).intent).toBe("UNKNOWN");
  });

  it("the same terms are UNKNOWN for a client with no custom intents", () => {
    expect(classifyTermAgainstIntents("used fridge dubai", []).intent).toBe("UNKNOWN");
  });

  it("fixture exposes BUY and SELL as data", () => {
    expect(MUROOJ_PROFILE.customIntents.map((i) => i.key)).toEqual(["BUY", "SELL"]);
  });
});
