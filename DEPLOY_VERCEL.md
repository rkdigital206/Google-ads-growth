# Deploying to Vercel (remote MCP + dashboard)

**Status: built and tested locally (real compiled server + real Postgres). NOT yet deployed to Vercel — first deploy is unverified.**

## What you get
| URL | What |
|---|---|
| `https://<your-app>.vercel.app/` | Read-only dashboard (sign in with `MCP_API_KEY`) |
| `https://<your-app>.vercel.app/mcp` | Remote MCP endpoint (Streamable HTTP, stateless, `POST` only) |
| `/api/dashboard?view=overview\|clients\|accounts\|approvals\|changes` | Dashboard JSON (GET, read-only) |

Every endpoint requires `Authorization: Bearer <MCP_API_KEY>`. If `MCP_API_KEY` is unset, all requests are refused (fail closed).
The dashboard cannot change anything; approvals are decided through the MCP tool `decide_approval`, so the safety chain stays the only write path.

## Steps
1. **Database** — create a free Neon (or Vercel Postgres) database. Copy the **pooled** connection string.
2. **Create tables once, from your computer:**
   `DATABASE_URL="<neon url>" npx prisma db push`
3. **Vercel** → Add New → Project → import `rkdigital206/Google-ads-growth`. Framework: *Other*. (Build settings come from `vercel.json`.)
4. **Environment variables** (Project → Settings → Environment Variables):
   - `DATABASE_URL` — the Neon pooled URL
   - `MCP_API_KEY` — a long random secret (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `APPROVAL_MODE=hard`
   - Later, when ready to connect Google Ads: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
5. Deploy. Open the URL, paste `MCP_API_KEY`, check **Overview**.

Without the Google Ads variables the dashboard, `onboard_client`, `get_audit_checklist` and research tools work; Google Ads tools return `GOOGLE_ADS_NOT_CONFIGURED`.

## Connecting a client to `/mcp`
- **Claude Code:** `claude mcp add --transport http google-ads-growth https://<app>.vercel.app/mcp --header "Authorization: Bearer <MCP_API_KEY>"`
- **Claude Desktop (via proxy):** use `npx mcp-remote https://<app>.vercel.app/mcp --header "Authorization: Bearer <MCP_API_KEY>"` as the server command.
- **Claude.ai custom connector:** may require OAuth, which this server does **not** implement (static bearer key only). Unverified — use the options above first.

## Try it locally first
`cp .env.example .env` (set `DATABASE_URL`, `MCP_API_KEY`) → `npx prisma db push` → `npm run build && npm run start:http` → http://localhost:3000

## Known unverified / limits
- Vercel first-deploy behaviour (Prisma engine bundling via `binaryTargets`, `includeFiles: dist/**`, function size) has not been run on Vercel.
- Function timeouts: 60 s for `/mcp`. Large audits could exceed it.
- Single shared API key, no per-user auth or rate limiting. Rotate it if exposed. Do not share the URL publicly.
- Nothing has been run against live Google Ads.
