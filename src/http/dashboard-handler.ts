import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizeRequest } from "./auth.js";
import { sendJson } from "./http-utils.js";
import { DASHBOARD_VIEWS, getDashboardView, type DashboardView } from "./dashboard-data.js";
import { logger } from "../utils/logger.js";

/** GET /api/dashboard?view=overview|clients|accounts|approvals|changes — read-only, bearer-authenticated. */
export async function handleDashboardRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = authorizeRequest(req.headers);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.message });
  if (req.method !== "GET") return sendJson(res, 405, { error: "Dashboard API is read-only (GET only)." }, { allow: "GET" });

  const view = (new URL(req.url ?? "/", "http://localhost").searchParams.get("view") ?? "overview") as DashboardView;
  if (!DASHBOARD_VIEWS.includes(view)) return sendJson(res, 400, { error: `Unknown view. Use one of: ${DASHBOARD_VIEWS.join(", ")}` });

  try {
    sendJson(res, 200, { view, generatedAt: new Date().toISOString(), data: await getDashboardView(view) });
  } catch (err) {
    logger.error({ err, view }, "Dashboard query failed");
    sendJson(res, 500, { error: "Dashboard query failed. Check DATABASE_URL and that the schema was pushed (npx prisma db push)." });
  }
}
