// Vercel serverless entry: Streamable HTTP MCP endpoint. Compiled output (dist/) is produced by the Vercel build command.
import { handleMcpRequest } from "../dist/http/mcp-handler.js";
export default function handler(req, res) {
  return handleMcpRequest(req, res);
}
