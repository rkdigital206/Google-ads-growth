import { describe, it, expect, vi } from "vitest";
import { discoverAccessibleAccounts, classifyAccount, type AccountSummary, type DiscoveryDeps } from "../src/google-ads/account-service.js";
import { assertLinkable } from "../src/database/repositories/account-repo.js";

const summary = (id: string, over: Partial<AccountSummary> = {}): AccountSummary => ({
  customerId: id, descriptiveName: `Acct ${id}`, currencyCode: "USD", timeZone: "UTC", status: "ENABLED", isManager: false, ...over,
});

function deps(over: Partial<DiscoveryDeps>): DiscoveryDeps {
  return {
    listAccessibleIds: async () => [],
    getSummary: async (id) => summary(id),
    listManagerHierarchy: async () => [],
    ...over,
  };
}

describe("account discovery: individual account failure (graceful degradation)", () => {
  it("one account that errors does not fail discovery; it is reported INACCESSIBLE/UNKNOWN with its error", async () => {
    const result = await discoverAccessibleAccounts(
      deps({
        listAccessibleIds: async () => ["1111111111", "2222222222", "3333333333"],
        getSummary: async (id) => {
          if (id === "2222222222") throw new Error("USER_PERMISSION_DENIED");
          return summary(id);
        },
      })
    );
    expect(result).toHaveLength(3);
    const bad = result.find((a) => a.customerId === "2222222222")!;
    expect(bad.inspection).toBe("INACCESSIBLE");
    expect(bad.accountType).toBe("UNKNOWN");
    expect(bad.linkable).toBe(false);
    expect(bad.error).toContain("USER_PERMISSION_DENIED");
    expect(result.filter((a) => a.inspection === "INSPECTED")).toHaveLength(2);
  });

  it("fails only when the accessible-customer list itself cannot be fetched", async () => {
    await expect(discoverAccessibleAccounts(deps({ listAccessibleIds: async () => { throw new Error("auth failed"); } }))).rejects.toThrow("auth failed");
  });

  it("de-duplicates repeated customer ids", async () => {
    const getSummary = vi.fn(async (id: string) => summary(id));
    const result = await discoverAccessibleAccounts(deps({ listAccessibleIds: async () => ["1", "1", "2"], getSummary }));
    expect(result).toHaveLength(2);
    expect(getSummary).toHaveBeenCalledTimes(2);
  });
});

describe("account discovery: manager vs client distinction and hierarchy", () => {
  it("classifies manager accounts as MANAGER (not linkable) and others as CLIENT", async () => {
    const result = await discoverAccessibleAccounts(
      deps({
        listAccessibleIds: async () => ["900", "100"],
        getSummary: async (id) => summary(id, { isManager: id === "900" }),
      }),
      { traverseHierarchy: false }
    );
    const mgr = result.find((a) => a.customerId === "900")!;
    const cli = result.find((a) => a.customerId === "100")!;
    expect(mgr.accountType).toBe("MANAGER");
    expect(mgr.linkable).toBe(false);
    expect(mgr.notLinkableReason).toMatch(/Manager/);
    expect(cli.accountType).toBe("CLIENT");
    expect(cli.linkable).toBe(true);
  });

  it("traverses a manager's hierarchy and records child accounts with their manager and level", async () => {
    const listManagerHierarchy = vi.fn(async (managerId: string) => [
      { summary: summary("101"), level: 1 },
      { summary: summary("102", { isManager: true }), level: 1 },
      { summary: summary("201"), level: 2 },
    ]);
    const result = await discoverAccessibleAccounts(
      deps({ listAccessibleIds: async () => ["900"], getSummary: async (id) => summary(id, { isManager: true }), listManagerHierarchy })
    );
    expect(listManagerHierarchy).toHaveBeenCalledWith("900");
    const child = result.find((a) => a.customerId === "101")!;
    expect(child.accountType).toBe("CLIENT");
    expect(child.linkable).toBe(true);
    expect(child.accessPaths).toEqual([{ via: "MANAGER_HIERARCHY", managerId: "900", level: 1 }]);
    expect(result.find((a) => a.customerId === "102")!.accountType).toBe("MANAGER");
    expect(result.find((a) => a.customerId === "201")!.accessPaths[0]).toMatchObject({ level: 2 });
  });

  it("an account reachable both directly and through a manager records both access paths without duplication", async () => {
    const result = await discoverAccessibleAccounts(
      deps({
        listAccessibleIds: async () => ["900", "101"],
        getSummary: async (id) => summary(id, { isManager: id === "900" }),
        listManagerHierarchy: async () => [{ summary: summary("101"), level: 1 }],
      })
    );
    expect(result.filter((a) => a.customerId === "101")).toHaveLength(1);
    expect(result.find((a) => a.customerId === "101")!.accessPaths.map((p) => p.via).sort()).toEqual(["DIRECT", "MANAGER_HIERARCHY"]);
  });

  it("a failing hierarchy traversal degrades gracefully: the manager is still reported, with the error noted", async () => {
    const result = await discoverAccessibleAccounts(
      deps({
        listAccessibleIds: async () => ["900", "100"],
        getSummary: async (id) => summary(id, { isManager: id === "900" }),
        listManagerHierarchy: async () => { throw new Error("quota"); },
      })
    );
    expect(result.map((a) => a.customerId).sort()).toEqual(["100", "900"]);
    expect(result.find((a) => a.customerId === "900")!.error).toContain("Hierarchy traversal failed");
  });

  it("does not traverse suspended managers or when traversal is disabled", async () => {
    const listManagerHierarchy = vi.fn(async () => []);
    await discoverAccessibleAccounts(
      deps({ listAccessibleIds: async () => ["900"], getSummary: async (id) => summary(id, { isManager: true, status: "SUSPENDED" }), listManagerHierarchy })
    );
    expect(listManagerHierarchy).not.toHaveBeenCalled();
  });

  it("non-ENABLED client accounts are inspected but not linkable", () => {
    const a = classifyAccount("5", summary("5", { status: "SUSPENDED" }), null, [{ via: "DIRECT" }]);
    expect(a.accountType).toBe("CLIENT");
    expect(a.linkable).toBe(false);
    expect(a.notLinkableReason).toContain("SUSPENDED");
  });
});

describe("assertLinkable (policy)", () => {
  it("rejects MANAGER and UNKNOWN, allows CLIENT", () => {
    expect(() => assertLinkable("MANAGER", "9")).toThrow(/MANAGER/);
    expect(() => assertLinkable("UNKNOWN", "9")).toThrow(/UNKNOWN/);
    expect(() => assertLinkable("CLIENT", "9")).not.toThrow();
  });
});
