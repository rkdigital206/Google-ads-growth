# PHASE D AUDIT

Audit of `google-ads-growth-mcp-phase-D.zip`, performed before any Phase E code changes.

## 1. Architecture summary

```
src/
  config/env.ts            — Zod-validated env vars (Google Ads creds, DB URL)
  google-ads/               — auth, client (GAQL runner + retry), account/campaign/keyword/reporting services
  safety/                   — risk-engine → approval-policy → mutation-guard (the mutation choke point)
  domain/                   — generic BusinessProfile, IntentType, OptimizationConfig + Murooj fixture
  performance/               — normalized metrics model (11 entity interfaces) + canonical math
  research/                 — research domain model, provider interfaces, 4 engines (website, trend, keyword, competitor), report assembler
  strategy/                 — thin @deprecated compatibility shims over domain/ (see §5 below)
  optimization/             — search-term-optimizer (single flat function)
  database/repositories/    — Prisma client singleton, client-repo (row↔domain mapper, unused by any tool yet)
  mcp/                      — MCP server + 4 tool files (audit, reporting, campaign, approval)
  utils/                    — errors, logger (pino/stderr), validation (fromMicros etc.)
prisma/schema.prisma         — Client (typed economics fields), GoogleAdsAccount, ChangeLogEntry, ApprovalRequest, Recommendation, PerformanceSnapshot
tests/                       — 8 test files, all logic-level (no DB, no live API)
```

## 2. Component classification

| Component | Classification | Notes |
|---|---|---|
| `safety/risk-engine.ts`, `approval-policy.ts`, `mutation-guard.ts` | **KEEP** | Mature, deterministic, unit-tested. This is the one thing Phase E must not touch or bypass. |
| `google-ads/client.ts`, `auth.ts` | **MODIFY** | Solid GAQL runner + OAuth wiring. Needs one addition: account **discovery** (`listAccessibleCustomers`) — currently the system only knows how to query a customer ID it's already told about. |
| `google-ads/account-service.ts` | **MODIFY** | `getAccountSummary`/`listCampaigns` are real and useful; needs a discovery-layer sibling function, not a rewrite. |
| `google-ads/reporting-service.ts`, `keyword-service.ts`, `campaign-service.ts` | **KEEP** | Reused as-is by the audit engine this phase adds. |
| `domain/business-profile.ts` | **MODIFY (extend)** | Currently covers name/website/industry/products/locations/languages/primaryConversionGoal/customIntents — a reasonable v1, but missing most of Phase E §4's field list (currency, AOV, margin, target CPA/ROAS/CAC, budget, growth goal, sales cycle, seasonality, brand voice, tracking status). Extending additively, not replacing — `createBusinessProfile()`'s signature and existing fields stay valid. |
| `domain/optimization-config.ts` | **KEEP** | Already covers the economics/threshold fields Phase E's economics engine needs to read from. |
| `domain/intent.ts` | **KEEP** | Already fully generic (Phase B); no Murooj leakage. |
| `domain/client-fixtures/murooj.fixture.ts` | **KEEP as fixture, clearly isolated** | This is the *correct* place for Murooj-specific data to live. Nothing outside this file and its two shim consumers may reference Murooj. |
| `strategy/business-analysis.ts`, `strategy/campaign-strategy.ts` | **KEEP (as deprecated shims)** | These exist ONLY so `audit-tools.ts`/`search-term-optimizer.ts` keep compiling without modification (see Phase B/C decision). Still the only files with Murooj-shaped types (`SearchIntent = "BUY"|"SELL"`), but they're explicitly marked `@deprecated` and quarantined — not a Phase E blocker. |
| `research/*` | **KEEP** | Fully generic, provider-agnostic, tested. Zero live provider implementations exist yet (`PROVIDER_NOT_CONFIGURED` is the honest current state) — that's a known gap, not new debt. |
| `performance/*` | **KEEP** | Canonical metrics math, null-vs-zero discipline intact. The audit engine and economics engine both consume this directly. |
| `database/repositories/client-repo.ts` | **MODIFY (extend)** | Row↔domain mapper exists but nothing calls it — no MCP tool or onboarding flow persists a real client yet. Phase E's onboarding engine needs this wired up. |
| `mcp/tools/*` | **ADD alongside** | 8 existing tools, none for onboarding, discovery, audit, economics, or research orchestration. Adding new tool files rather than modifying existing ones. |
| `optimization/search-term-optimizer.ts` | **KEEP, unchanged** | Out of scope this phase. |
| Prisma schema | **MODIFY (extend)** | `Client` model already has typed economics fields (targetCPA etc. from Phase B) — good foundation. Missing fields for Phase E's fuller profile (currency, growth goal, sales cycle, seasonality, etc.) and no `OnboardingState`/audit-result persistence yet. |

## 3. Murooj-specific assumption inventory

Searched the entire Phase D tree for `Murooj`, `BUY`/`SELL`, hardcoded currency/geography:

- **Confined to 3 files, all already isolated by design**: `domain/client-fixtures/murooj.fixture.ts` (the fixture itself — correct location), `strategy/business-analysis.ts`, `strategy/campaign-strategy.ts` (deprecated compatibility shims, documented as such, scheduled for deletion once `audit-tools.ts`/`search-term-optimizer.ts` are next touched).
- **No Murooj/BUY/SELL logic exists in any generic layer** (`domain/`, `performance/`, `research/`) — confirmed by grep in the Phase D handoff and re-confirmed here.
- **Conclusion:** Phase D's genericization work holds. Phase E does not need a Murooj-removal pass; it needs to *build the missing universal capabilities* (onboarding, discovery, audit, economics) that Phase D didn't yet cover.

## 4. Missing functionality (Phase E's actual job)

Per Phase E's own scope (§26): onboarding, account discovery, account audit + health score, business economics engine, research orchestrator, strategy brief. None of these exist in Phase D. Specifically absent:

- Any onboarding workflow or `OnboardingCompletenessReport`
- Any Google Ads account **discovery** (`listAccessibleCustomers`) — Phase D can only query an account it's already told the ID of
- Any account audit engine or health scoring
- Any business economics engine (ROAS/CPA/CAC/LTV formulas)
- Any orchestrator tying research engines + Ads data + economics into one report
- Any strategy brief generator
- Any of the ~13 new MCP tools Phase E's §19 lists

## 5. Technical debt / risks carried into Phase E

- `strategy/*.ts` shims are dead weight that should be deleted once `audit-tools.ts` is rewritten to use the generic domain model directly — not urgent, but should not be extended further.
- `client-repo.ts` is unused — Phase E's onboarding flow is the first real consumer; worth confirming its mapping still matches the Prisma schema after this phase's schema changes.
- No integration/live-API tests exist anywhere (expected, given this sandbox has no network) — every claim about GAQL query correctness in this phase is still hand-traced, not executed, same caveat as every prior phase.
- Research providers are 100% unconfigured (`PROVIDER_NOT_CONFIGURED` everywhere) — the research orchestrator this phase adds will be honestly limited by that; it cannot manufacture trend/competitor data that isn't there.

## 6. Phase E scope decision

Given the brief's own instruction (§26, "do not overbuild Phase E") and the size of the full spec (28 sections, ~13 new MCP tools, 8 new docs), this phase implements the **core working chain** end-to-end for a generic business — onboarding → discovery → audit → economics → research orchestration → strategy brief — with a focused MCP tool set, rather than exhaustively implementing every listed tool and doc file. Deferred items are listed explicitly in `PHASE_E_COMPLETION_REPORT.md` rather than stubbed thinly.
