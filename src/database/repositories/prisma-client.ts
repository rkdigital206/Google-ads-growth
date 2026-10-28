import { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";

/**
 * Singleton Prisma client. In an MCP stdio server there's one long-lived
 * process per session, so a module-level singleton is correct here (unlike
 * serverless, where you'd need connection-pool-aware handling).
 */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
