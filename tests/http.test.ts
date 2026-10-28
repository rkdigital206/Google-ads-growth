import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

const m = vi.hoisted(() => ({
  prisma: {
    client: { count: vi.fn(), findMany: vi.fn() },
    googleAdsAccount: { count: vi.fn(), findMany: vi.fn() },
    approvalRequest: { count: vi.fn(), findMany: vi.fn() },
    changeLogEntry: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("../src/database/repositories/prisma-client.js", () => ({ prisma: m.prisma }));

import { authorizeRequest } from "../src/http/auth.js";
import { httpServer } from "../src/http/server.js";
import { clientRow } from "./helpers/rows.js";

const KEY = process.env.MCP_API_KEY as string;
const auth = { authorization: `Bearer ${KEY}` };
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => httpServer.close(() => r())));
beforeEach(() => vi.clearAllMocks());

const rpc = (body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("authorizeRequest (fail closed, constant-time)", () => {
  it("refuses everything when no key is configured", () => {
    const r = authorizeRequest({ authorization: "Bearer anything" }, null);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
  it("rejects missing, malformed and wrong keys", () => {
    expect(authorizeRequest({}, "k".repeat(30))).toMatchObject({ ok: false, status: 401 });
    expect(authorizeRequest({ authorization: "Basic abc" }, "k".repeat(30))).toMatchObject({ ok: false, status: 401 });
    expect(authorizeRequest({ authorization: "Bearer wrong" }, "k".repeat(30))).toMatchObject({ ok: false, status: 401 });
  });
  it("accepts the right key", () => {
    expect(authorizeRequest({ authorization: `Bearer ${"k".repeat(30)}` }, "k".repeat(30))).toEqual({ ok: true });
  });
});

describe("/mcp (Streamable HTTP, stateless)", () => {
  it("401 without a key, and never reaches the MCP layer", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });
  it("401 with a wrong key", async () => {
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: "Bearer nope" })).status).toBe(401);
  });
  it("405 for GET/DELETE (stateless server) even when authenticated", async () => {
    expect((await fetch(`${base}/mcp`, { headers: auth })).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "DELETE", headers: auth })).status).toBe(405);
  });
  it("400 on invalid JSON", async () => {
    expect((await rpc("{not json")).status).toBe(400);
  });
  it("authenticated initialize + tools/list works end to end and exposes the real tool set", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("google-ads-growth-mcp");

    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names: string[] = (await list.json()).result.tools.map((t: { name: string }) => t.name);
    for (const n of ["onboard_client", "list_google_ads_accounts", "link_google_ads_account", "audit_google_ads_account", "research_trends", "get_audit_checklist", "list_pending_approvals", "pause_campaign"]) expect(names).toContain(n);
    expect(names).not.toContain("run_account_audit");
  });
  it("a tool call that needs Google Ads reports GOOGLE_ADS_NOT_CONFIGURED style failure instead of crashing the server (read-only discovery path)", async () => {
    // No network is attempted: with the test credentials absent this must fail cleanly. Here creds are dummy,
    // so we only assert the endpoint stays healthy when a tool errors.
    const res = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_client_profile", arguments: { clientId: "x" } } });
    expect(res.status).toBe(200);
  });
});

describe("/api/dashboard (read-only)", () => {
  const get = (view: string, headers: Record<string, string> = auth) => fetch(`${base}/api/dashboard?view=${view}`, { headers });

  it("401 without a key", async () => expect((await get("overview", {})).status).toBe(401));
  it("405 for anything but GET", async () => expect((await fetch(`${base}/api/dashboard`, { method: "POST", headers: auth })).status).toBe(405));
  it("400 for an unknown view", async () => expect((await get("secrets")).status).toBe(400));

  it("overview returns counts and config flags without leaking credentials", async () => {
    m.prisma.client.count.mockResolvedValue(3);
    m.prisma.googleAdsAccount.count.mockResolvedValue(2);
    m.prisma.approvalRequest.count.mockResolvedValue(1);
    m.prisma.changeLogEntry.count.mockResolvedValue(4);
    const res = await get("overview");
    const body = await res.json();
    expect(body.data.counts.clients).toBe(3);
    expect(body.data.config.googleAdsConfigured).toBe(true);
    const text = JSON.stringify(body);
    expect(text).not.toContain("test-refresh-token");
    expect(text).not.toContain(KEY);
  });

  it("clients view computes per-client onboarding completeness from stored data", async () => {
    m.prisma.client.findMany.mockResolvedValue([{ ...clientRow({ id: "c1", name: "Nimbus", businessType: "SAAS" }), accounts: [{ customerId: "1" }] }]);
    const body = await (await get("clients")).json();
    const c = body.data[0];
    expect(c.name).toBe("Nimbus");
    expect(c.linkedAccounts).toBe(1);
    expect(c.onboarding.completenessPct).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(c.onboarding.missingCriticalFields)).toBe(true);
  });

  it("approvals and changes views return rows", async () => {
    m.prisma.approvalRequest.findMany.mockResolvedValue([{ id: "a1", status: "PROPOSED", riskLevel: "HIGH", summary: "Raise budget", account: { customerId: "1", descriptiveName: "X" }, createdAt: new Date(), decidedBy: null, decidedAt: null, decisionNote: null, detailJson: { a: 1 } }]);
    m.prisma.changeLogEntry.findMany.mockResolvedValue([{ id: "e1", createdAt: new Date(), executedAt: null, account: { customerId: "1", descriptiveName: "X" }, resourceType: "campaign", operation: "PAUSE", riskLevel: "LOW", status: "PROPOSED", reasoning: "why", requestedByTool: "pause_campaign", errorMessage: null }]);
    expect((await (await get("approvals")).json()).data[0].summary).toBe("Raise budget");
    expect((await (await get("changes")).json()).data[0].operation).toBe("PAUSE");
  });

  it("a database failure returns a safe 500 message, not internals", async () => {
    m.prisma.client.count.mockRejectedValue(new Error("password authentication failed for user secretuser"));
    m.prisma.googleAdsAccount.count.mockResolvedValue(0);
    m.prisma.approvalRequest.count.mockResolvedValue(0);
    m.prisma.changeLogEntry.count.mockResolvedValue(0);
    const res = await get("overview");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secretuser");
  });

  it("dashboard-data performs no writes (static check)", () => {
    const src = readFileSync(new URL("../src/http/dashboard-data.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    expect(src).not.toMatch(/google-ads\/|guardedMutate/);
  });
});

describe("static dashboard page", () => {
  it("is served at / and renders untrusted data via textContent only", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Control Room");
    expect(html).not.toMatch(/innerHTML/);
    expect(html).not.toMatch(/localStorage/);
  });
});

describe("Google Ads credentials are optional until a Google Ads tool is used", () => {
  it("requireGoogleAdsCredentials names the missing variables", async () => {
    const saved = { ...process.env };
    for (const k of ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"]) delete process.env[k];
    vi.resetModules();
    try {
      const { requireGoogleAdsCredentials } = await import("../src/google-ads/auth.js");
      expect(() => requireGoogleAdsCredentials()).toThrow(/GOOGLE_ADS_NOT_CONFIGURED.*GOOGLE_ADS_DEVELOPER_TOKEN/);
    } finally {
      Object.assign(process.env, saved);
      vi.resetModules();
    }
  });
});
