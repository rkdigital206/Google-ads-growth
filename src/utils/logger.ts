import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured logger. In an MCP stdio server, stdout is reserved for the
 * protocol — logs MUST go to stderr, or the client will fail to parse
 * MCP messages. This is a common and nasty bug in home-grown MCP servers.
 */
export const logger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: "google-ads-growth-mcp" },
  },
  pino.destination({ dest: 2, sync: false }) // fd 2 = stderr
);

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
