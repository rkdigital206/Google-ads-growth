// Vercel serverless entry: read-only dashboard JSON API.
import { handleDashboardRequest } from "../dist/http/dashboard-handler.js";
export default function handler(req, res) {
  return handleDashboardRequest(req, res);
}
