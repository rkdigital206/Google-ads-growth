# Google Ads Growth & Optimization MCP

An AI-powered Google Ads MCP server for **Claude Code / Claude Desktop** that goes beyond a
CRUD wrapper: it audits, strategizes, and optimizes toward business outcomes (revenue, qualified
leads) rather than vanity metrics — with a hard safety layer that requires human approval before
any risky change touches a live client account.

**Generic, multi-client.** Nothing in the runtime is specific to one business. Murooj Al Rabee Used
Appliances is only a test fixture (`src/domain/client-fixtures/murooj.fixture.ts`). Businesses are
onboarded via `onboard_client` / `update_client_profile`, and every Google Ads account must be explicitly
linked to a client before it can be audited or touched.

### Phase E.1 tool flow
`list_google_ads_accounts` (read-only discovery) -> `link_google_ads_account` (server re-inspects; managers/unknown rejected) ->
`get_audit_checklist` -> `audit_google_ads_account` -> `run_growth_research` -> `generate_growth_strategy`.
Standalone research: `analyze_website`, `research_trends`, `research_keywords`, `research_competitors`.
External data providers are injected via `src/research/providers/registry.ts`; none ship built-in, so an
unconfigured provider returns `PROVIDER_NOT_CONFIGURED` instead of invented numbers.
Removed pilot-only tools: `run_account_audit`, `get_campaign_structure_recommendation`.

### Running tests
`npm test` (no DB needed). DB round-trip tests: `RUN_DB_TESTS=1 DATABASE_URL=postgresql://... npm test`
(after `npx prisma db push`). Node >= 22 required (google-ads-api 25). See COMPATIBILITY_REVIEW.md.

---

## 1. What's actually built vs. what's next

Being direct about this, per how Rehan wants to work — no inflated claims:

**Built and real (not pseudocode):**
- Full modular project structure per spec
- Zod-validated env config, structured logging (stderr-safe for MCP stdio), typed error hierarchy
- Google Ads client wrapper with retry/backoff on transient errors (`src/google-ads/`)
- Prisma schema: multi-client accounts, audit-trail change log, approval queue, recommendations, performance snapshots
- **Safety layer** (`src/safety/`): risk-engine → approval-policy → mutation-guard. This is the
  part that matters most and got the most attention — every mutation is classified LOW/MEDIUM/HIGH
  risk by deterministic, unit-tested rules and logged *before* it's allowed to execute
- BUY/SELL intent classification + campaign structure strategy tailored to the pilot client
- Search-term waste + intent-cross-contamination optimizer
- 8 working MCP tools wired to a `McpServer` over stdio
- Unit tests for the risk engine (the highest-stakes logic in the system)

**Deliberately stubbed / flagged, not faked:**
- `website-analyzer.ts` — real fetch/parse logic, but mrusedappliances.com blocks automated
  fetches (robots.txt). It throws a clear typed error rather than pretending to return data.
- `decide_approval` tool records the human decision and updates status, but re-executing the
  *original* mutation on APPROVE isn't generically wired yet — see the code comment in
  `mcp/tools/approval-tools.ts`. Guessing at a generic "replay this JSON against the API" shape
  before the first real mutation type has been exercised against v25 is exactly the kind of
  invented-API-behavior this brief said to avoid. Wire this per-mutation-type once you've run the
  first real approval through the queue.
- Bidding-strategy mutation payload (`campaign-service.ts`) is flagged with a comment to verify
  against the live v25 field reference before first run — Maximize Conversions/Value strategies
  need target sub-objects whose exact shape I have not executed against a real account.
- No CI, no Docker image for the app itself (docker-compose only covers Postgres), no OAuth
  helper script for obtaining the initial refresh token.

**Not run in this environment:** I don't have network access here, so `npm install`, a live
Postgres, and a real Google Ads API call were never exercised end-to-end. Treat this as a strong,
coherent first draft you compile and test on your machine — not a "trust me, it works" claim.

---

## 2. Why this isn't a duplicate of Google's official MCP server

Google ships an official, open-source Google Ads MCP server
(`google-marketing-solutions/google_ads_mcp`, April 2026). It's free and well-built — but it is
**strictly read-only** (list accounts + run GAQL queries, nothing else). This project exists for
the gap that leaves: proposing and *safely executing* changes, with an approval workflow, on
behalf of a client. If you only need diagnostics/reporting for a single account you already trust
an AI to read, their server is simpler and requires no infrastructure of your own. Use this one
when you want the AI to actually act — under supervision.

---

## 3. Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres
docker compose up -d

# 3. Configure environment
cp .env.example .env
# Fill in Google Ads credentials (see section 4) and confirm DATABASE_URL

# 4. Apply the database schema
npm run db:migrate

# 5. Build and run
npm run build
npm start
# or, for development with auto-reload:
npm run dev
```

### Wiring into Claude Desktop / Claude Code

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-ads-growth": {
      "command": "node",
      "args": ["/absolute/path/to/google-ads-growth-mcp/dist/index.js"]
    }
  }
}
```

## 4. Getting Google Ads credentials

1. **Developer token**: from your MCC's API Center (`ads.google.com/aw/apicenter`). New tokens
   start at Test Account access; you'll need to apply for Basic/Standard access before this can
   touch a real (non-test) client account like the pilot.
2. **OAuth client ID/secret**: create an OAuth 2.0 Client ID (Desktop app type) in Google Cloud Console.
3. **Refresh token**: run the OAuth consent flow *once*, manually, for the Google account that has
   access to the target Ads account — Google's official
   [OAuth2 generation guide](https://developers.google.com/google-ads/api/docs/oauth/overview) or
   the OAuth Playground both work. This project doesn't include that one-time script yet; add it
   to `src/google-ads/` as `get-refresh-token.ts` if you want it automated.
4. **Login customer ID**: your MCC's customer ID — required once you're managing the pilot client
   (or any client) through a manager account, which you will be for a multi-client system.

## 5. Safety model — read this before pointing it at a real account

`APPROVAL_MODE=hard` (the default, and the only mode to use against a live client account):

| Risk | Examples | Behavior |
|---|---|---|
| **LOW** | negative keywords, pausing a non-top-performer, small budget change within threshold | Executes immediately, logged to `ChangeLogEntry` |
| **MEDIUM** | ad group/keyword/ad create-update, bid strategy change, budget change over threshold % | Blocked — creates an `ApprovalRequest`, must be approved via `decide_approval` |
| **HIGH** | campaign create/remove, pausing a flagged top performer, budget above the configured ceiling, any unrecognized mutation shape (fail-safe default) | Always blocked pending human approval, regardless of `APPROVAL_MODE` |

`APPROVAL_MODE=soft` exists for testing against a Google Ads **test account** only — it logs a
loud warning and executes anyway. Never set this against the pilot client's real account.

## 6. Roadmap toward the multi-client vision

This is Phase 1: one client, core audit + reporting + safe mutation loop. The structure was
chosen so the next phases don't require a rewrite:

1. **Now**: pilot client manual operation via Claude Code/Desktop, human approves every
   MEDIUM/HIGH change.
2. **Next**: `client-repo.ts` in `database/repositories/` to move `PILOT_CLIENT` from a hardcoded
   object into real `Client`/`GoogleAdsAccount` rows, onboarding a second client without touching
   strategy code.
3. **Then**: `optimization/optimizer.ts` as a scheduled loop that runs `analyze_search_terms` and
   auto-executes only the LOW-risk findings (negative keywords), queuing everything else for
   approval — this is the first real "continuous optimization" automation, and the safest one to
   automate first given the risk model above.
4. **Later**: anomaly detection, ad-copy generation tied to `strategy/ad-copy.ts` (not yet built),
   and reporting exports for client-facing SOPs.
