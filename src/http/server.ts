/**
 * Local HTTP server for trying the remote deployment without Vercel:
 *   npm run build && npm run start:http   ->  http://localhost:3000
 * Serves /mcp, /api/dashboard and the static dashboard from /public.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { handleMcpRequest } from "./mcp-handler.js";
import { handleDashboardRequest } from "./dashboard-handler.js";
import { logger } from "../utils/logger.js";

const publicDir = join(process.cwd(), "public");

export const httpServer = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/mcp") return void (await handleMcpRequest(req, res));
  if (path === "/api/dashboard") return void (await handleDashboardRequest(req, res));
  if (path === "/" || path === "/index.html") {
    try {
      const html = await readFile(join(publicDir, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return void res.end(html);
    } catch {
      /* fall through to 404 */
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, () => logger.info({ port }, "HTTP server listening (/mcp, /api/dashboard, /)"));
}
