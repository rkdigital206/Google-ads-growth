import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAuditTools } from "./tools/audit-tools.js";
import { registerReportingTools } from "./tools/reporting-tools.js";
import { registerCampaignTools } from "./tools/campaign-tools.js";
import { registerApprovalTools } from "./tools/approval-tools.js";
import { registerOnboardingTools } from "./tools/onboarding-tools.js";
import { registerDiscoveryTools } from "./tools/discovery-tools.js";
import { registerGrowthTools } from "./tools/growth-tools.js";
import { registerResearchTools } from "./tools/research-tools.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "google-ads-growth-mcp",
    version: "0.1.0",
  });

  registerAuditTools(server);
  registerReportingTools(server);
  registerCampaignTools(server);
  registerApprovalTools(server);
  registerOnboardingTools(server);
  registerDiscoveryTools(server);
  registerGrowthTools(server);
  registerResearchTools(server);

  return server;
}
