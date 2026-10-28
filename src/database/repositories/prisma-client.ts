import { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";

/**
 * Singleton Prisma client. Cached on globalThis so that serverless runtimes
 * (Vercel) reuse one client per warm instance instead of opening a new
 * connection pool on every invocation. Use a pooled DATABASE_URL (Neon "pooled"
 * connection string) in serverless deployments.
 */
const globalForPrisma = globalThis as unknown as { __gagPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__gagPrisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.__gagPrisma = prisma;
