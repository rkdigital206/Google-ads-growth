import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "../mcp/server.js";
import { authorizeRequest } from "./auth.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import { logger } from "../utils/logger.js";

/**
 * Remote MCP endpoint (Streamable HTTP, STATELESS).
 *
 * Stateless = a fresh McpServer + transport per request, no session kept in
 * memory. That is what makes it safe on serverless (Vercel): every piece of
 * state this system cares about (clients, accounts, approvals, change log)
 * already lives in Postgres. Auth is checked BEFORE the MCP layer is touched.
 * Tools are exactly the stdio tools — the safety chain
 * (risk-engine -> approval-policy -> mutation-guard) is unchanged.
 */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = authorizeRequest(req.headers);
  if (!auth.ok) {
    sendJson(res, auth.status, { jsonrpc: "2.0", error: { code: -32001, message: auth.message }, id: null }, auth.status === 401 ? { "www-authenticate": "Bearer" } : {});
    return;
  }
  if (req.method !== "POST") {
    // Stateless server: no GET (SSE stream) and no DELETE (session teardown).
    sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This stateless MCP endpoint only accepts POST." }, id: null }, { allow: "POST" });
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    const body = await readJsonBody(req);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    logger.error({ err }, "MCP HTTP request failed");
    const parseError = err instanceof SyntaxError;
    sendJson(res, parseError ? 400 : 500, { jsonrpc: "2.0", error: { code: parseError ? -32700 : -32603, message: parseError ? "Parse error" : "Internal server error" }, id: null });
  }
}
