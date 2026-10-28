/**
 * ResearchProviderRegistry resolution (Phase E.1 sections 9–10).
 *
 * MCP tools never construct providers and never hard-code `providers:
 * undefined`. They call `getResearchProviderRegistry()`, which returns
 * whatever registry the host application injected at startup via
 * `configureResearchProviders()`.
 *
 * Out of the box NO provider is configured, so the registry is `{}` and every
 * engine reports PROVIDER_NOT_CONFIGURED. This module deliberately contains
 * NO built-in/fake providers: a real Google Trends, keyword-volume or SERP
 * integration is added by calling `configureResearchProviders({ trend: ... })`
 * from the composition root (src/index.ts) — no MCP tool needs to change.
 */

import type { ResearchProviderRegistry } from "./types.js";

let registry: ResearchProviderRegistry = {};

/** Replaces the active registry. Call once from the composition root with real provider instances. */
export function configureResearchProviders(next: ResearchProviderRegistry): void {
  registry = { ...next };
}

/** Returns the active registry. Empty (`{}`) when nothing has been configured. */
export function getResearchProviderRegistry(): ResearchProviderRegistry {
  return registry;
}

/** Names of the capabilities that currently have NO configured provider. */
export function describeMissingProviders(r: ResearchProviderRegistry = registry): string[] {
  const missing: string[] = [];
  if (!r.trend) missing.push("trend");
  if (!r.keywordResearch) missing.push("keywordResearch");
  if (!r.competitorResearch) missing.push("competitorResearch");
  if (!r.marketResearch) missing.push("marketResearch");
  return missing;
}

/** Test helper: restore the unconfigured default. */
export function resetResearchProvidersForTesting(): void {
  registry = {};
}
