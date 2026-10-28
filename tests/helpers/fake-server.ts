import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Handler = (args: any) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

/** Captures tools registered via server.tool(...) so handlers can be invoked exactly as MCP would (after zod parsing). */
export function makeFakeServer() {
  const tools = new Map<string, { description: string; shape: Record<string, z.ZodTypeAny>; handler: Handler }>();
  const server = {
    tool: (name: string, description: string, shape: Record<string, z.ZodTypeAny>, handler: Handler) => {
      tools.set(name, { description, shape, handler });
    },
  } as unknown as McpServer;

  async function call(name: string, args: Record<string, unknown>) {
    const t = tools.get(name);
    if (!t) throw new Error(`Tool not registered: ${name}`);
    const parsed = z.object(t.shape).parse(args);
    const result = await t.handler(parsed);
    const text = result.content[0]?.text ?? "";
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* plain-text result */ }
    return { isError: result.isError === true, text, json };
  }
  return { server, tools, call };
}
