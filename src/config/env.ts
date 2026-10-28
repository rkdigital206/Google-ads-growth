import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(1, "GOOGLE_ADS_DEVELOPER_TOKEN is required"),
  GOOGLE_ADS_CLIENT_ID: z.string().min(1),
  GOOGLE_ADS_CLIENT_SECRET: z.string().min(1),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().min(1),
  // Required once you operate through a manager (MCC) account, which you will
  // for a multi-client system. Optional at the schema level so the server can
  // still boot for a single directly-owned test account.
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z.string().optional(),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  APPROVAL_MODE: z.enum(["hard", "soft"]).default("hard"),
  AUTO_APPROVE_BUDGET_CHANGE_PCT_MAX: z.coerce.number().min(0).max(100).default(15),
  DEFAULT_MAX_DAILY_BUDGET: z.coerce.number().positive().default(500),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Deliberately not using the logger here — logger depends on env, and we
  // want a loud, unambiguous failure before anything else initializes.
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error(
    "Environment validation failed. Copy .env.example to .env and fill in the required values."
  );
}

export const env = parsed.data;
export type Env = typeof env;
