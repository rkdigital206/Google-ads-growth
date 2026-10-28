# Package / SDK compatibility review (Phase E.1 §17)

| Package | package.json | Installed | Latest seen | Decision |
|---|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.30.0 | 1.32.2 | 1.32.x (v1 line) | Keep v1. `server.tool(...)` API in use. MCP SDK v2 is a **separate migration**, not done here. |
| zod | ^3.23.8 | 3.25.76 | 4.x exists | Keep 3.x. The MCP SDK v1 schema handling targets zod 3; no blind upgrade. |
| google-ads-api | ^25.1.0 (was ^18.0.0) | 25.1.0 | 25.x | `^18.0.0` never existed on npm (ETARGET at install) — corrected. Requires Node >= 22 (engines updated). |
| prisma / @prisma/client | 6.19.3 | 6.19.3 | — | Unchanged. |

Code consequences of v25: mutate calls return `{ results }` (handled with a string filter); enums are numeric
(normalized via `src/google-ads/enum-utils.ts` at the service boundary); Google Ads API versions sunset
periodically — re-check the version bundled in google-ads-api before production.

NOT VERIFIED: `listAccessibleCustomers` and every GAQL query were checked at the type level and with
mocks only. No live Google Ads call was made.
