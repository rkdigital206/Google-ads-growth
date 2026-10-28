// Vercel build: generate Prisma client, sync the schema on PRODUCTION builds, compile TypeScript.
//
// `prisma db push` is run WITHOUT --accept-data-loss, so a schema change that would drop data
// makes the build FAIL instead of destroying anything. It uses the un-pooled Neon URL
// (DATABASE_URL_UNPOOLED) because DDL does not work reliably through the pgbouncer pooler.
// Set SKIP_DB_PUSH=1 to disable.
import { spawnSync } from "node:child_process";

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["prisma", "generate"]);

if (process.env.VERCEL_ENV === "production" && process.env.SKIP_DB_PUSH !== "1") {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set; cannot sync the database schema.");
    process.exit(1);
  }
  console.log("Syncing database schema (prisma db push, no data-loss flag)...");
  run("npx", ["prisma", "db", "push", "--skip-generate"], { ...process.env, DATABASE_URL: url });
} else {
  console.log("Skipping database schema sync (not a production build or SKIP_DB_PUSH=1).");
}

run("npx", ["tsc", "-p", "tsconfig.json"]);
