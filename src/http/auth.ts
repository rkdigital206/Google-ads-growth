import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { env } from "../config/env.js";

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

const sha256 = (v: string) => createHash("sha256").update(v).digest();

/**
 * Bearer-token check for the HTTP endpoints (/mcp and /api/dashboard).
 *
 * FAIL CLOSED: if MCP_API_KEY is not configured every request is refused (503).
 * This server can reach live Google Ads accounts, so "no key set" must never
 * mean "open to the internet". Comparison is constant-time (hashed first so
 * length differences leak nothing).
 */
export function authorizeRequest(headers: IncomingHttpHeaders, overrideKey?: string | null): AuthResult {
  // `overrideKey` exists for tests: undefined = use env, null = explicitly "not configured".
  const configuredKey = overrideKey === undefined ? env.MCP_API_KEY : (overrideKey ?? undefined);
  if (!configuredKey) {
    return { ok: false, status: 503, message: "Server is not configured: MCP_API_KEY is not set, so all requests are refused." };
  }
  const header = headers.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (!match) return { ok: false, status: 401, message: "Missing bearer token. Send 'Authorization: Bearer <MCP_API_KEY>'." };
  const supplied = sha256(match[1] as string);
  const expected = sha256(configuredKey);
  return timingSafeEqual(supplied, expected) ? { ok: true } : { ok: false, status: 401, message: "Invalid API key." };
}
