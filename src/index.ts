import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./mcp/server.js";
import { logger } from "./utils/logger.js";
import { prisma } from "./database/repositories/prisma-client.js";

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // IMPORTANT: never console.log() in a stdio MCP server — stdout is the
  // protocol channel. logger.ts is already wired to stderr; this line just
  // makes that constraint explicit for anyone extending this file.
  logger.info("google-ads-growth-mcp server connected over stdio");
}

process.on("SIGINT", async () => {
  logger.info("Shutting down (SIGINT)");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down (SIGTERM)");
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((err) => {
  logger.fatal({ err }, "Fatal error starting google-ads-growth-mcp");
  process.exit(1);
});
