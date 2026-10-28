/**
 * Maps between the Prisma `Client` row (prisma/schema.prisma) and the typed
 * domain model (BusinessProfile / OptimizationConfig / CustomIntentDefinition),
 * and owns the only write path for client onboarding data.
 *
 * Persistence design (Phase E.1):
 *   - productsOrServices, primaryOffers, targetCountries, languages,
 *     secondaryConversions, restrictions → Prisma scalar arrays (flat strings).
 *   - locations → child table `ClientLocation` (city/region/country/serviceRadius
 *     are separate fields that research needs individually).
 *   - customIntents → Json column (shape differs per client).
 *
 * The data-building and row-mapping functions are PURE (no DB access) so the
 * full onboard → persist → load round trip is unit-testable without Postgres.
 */

import type { Prisma, Client as PrismaClientRow, ClientLocation as PrismaClientLocation } from "@prisma/client";
import { prisma } from "./prisma-client.js";
import type { OptimizationConfig } from "../../domain/optimization-config.js";
import type { CustomIntentDefinition } from "../../domain/intent.js";
import type {
  BusinessLocation,
  BusinessProfile,
  BusinessType,
  ConversionGoalType,
  GrowthGoal,
  TrackingStatus,
} from "../../domain/business-profile.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ module: "client-repo" });

export type ClientRowWithRelations = PrismaClientRow & { locations: PrismaClientLocation[] };

// ---------------------------------------------------------------------------
// Row → domain mapping (pure)
// ---------------------------------------------------------------------------

export function toOptimizationConfig(row: PrismaClientRow): OptimizationConfig {
  return {
    targetCPA: row.targetCPA,
    targetROAS: row.targetROAS,
    averageOrderValue: row.averageOrderValue,
    grossMargin: row.grossMargin,
    profitPerSale: row.profitPerSale,
    leadValue: row.leadValue,
    lifetimeValue: row.lifetimeValue,
    leadToSaleRate: row.leadToSaleRate,
    monthlyBudget: row.monthlyBudget,
    minimumClicks: row.minimumClicks,
    minimumImpressions: row.minimumImpressions,
    minimumSpend: row.minimumSpend,
    minimumConversions: row.minimumConversions,
    minimumDays: row.minimumDays,
    budgetChangeLimitPct: row.budgetChangeLimitPct,
  };
}

/**
 * Parses custom intent definitions out of customIntentsJson. A null/malformed
 * value degrades to "no custom intents" with a warning instead of throwing.
 */
export function toCustomIntents(row: Pick<PrismaClientRow, "id" | "customIntentsJson">): CustomIntentDefinition[] {
  if (!row.customIntentsJson) return [];
  const parsed = row.customIntentsJson as unknown;
  if (!Array.isArray(parsed)) {
    log.warn({ clientId: row.id }, "customIntentsJson is not an array; ignoring");
    return [];
  }
  return parsed as CustomIntentDefinition[];
}

export function toBusinessLocation(row: PrismaClientLocation): BusinessLocation {
  return {
    city: row.city,
    country: row.country,
    ...(row.region !== null ? { region: row.region } : {}),
    ...(row.serviceRadius !== null ? { serviceRadius: row.serviceRadius } : {}),
  };
}

/** Full domain BusinessProfile from a Client row WITH its locations. knownBottlenecks/openQuestionsForAudit are audit output, not persisted. */
export function toBusinessProfile(row: ClientRowWithRelations): BusinessProfile {
  return {
    clientName: row.name,
    website: row.website,
    industry: row.industry,
    subIndustry: row.subIndustry,
    businessType: row.businessType as BusinessType | null,
    businessModel: row.businessModel,
    productsOrServices: row.productsOrServices,
    primaryOffers: row.primaryOffers,
    locations: row.locations.map(toBusinessLocation),
    targetCountries: row.targetCountries,
    languages: row.languages,
    currency: row.currency,
    primaryConversionGoal: row.primaryConversionGoal as ConversionGoalType | null,
    secondaryConversions: row.secondaryConversions,
    growthGoal: row.growthGoal as GrowthGoal | null,
    salesCycle: row.salesCycle,
    reportedSeasonality: row.reportedSeasonality,
    brandVoice: row.brandVoice,
    trackingStatus: (row.trackingStatus as TrackingStatus | null) ?? "UNKNOWN",
    restrictions: row.restrictions,
    customIntents: toCustomIntents(row),
    knownBottlenecks: [],
    openQuestionsForAudit: [],
  };
}

// ---------------------------------------------------------------------------
// Input shapes + pure Prisma data builders
// ---------------------------------------------------------------------------

/** Every onboarding field. All optional on update; `name` is required only on create. */
export interface ClientProfileInput {
  website?: string;
  industry?: string;
  subIndustry?: string;
  businessType?: BusinessType;
  businessModel?: string;
  productsOrServices?: string[];
  primaryOffers?: string[];
  locations?: BusinessLocation[];
  targetCountries?: string[];
  languages?: string[];
  currency?: string;
  primaryConversionGoal?: ConversionGoalType;
  secondaryConversions?: string[];
  growthGoal?: GrowthGoal;
  salesCycle?: string;
  reportedSeasonality?: string;
  brandVoice?: string;
  trackingStatus?: TrackingStatus;
  restrictions?: string[];
  customIntents?: CustomIntentDefinition[];

  // economics
  targetCPA?: number;
  targetROAS?: number;
  averageOrderValue?: number;
  grossMargin?: number;
  profitPerSale?: number;
  leadValue?: number;
  lifetimeValue?: number;
  leadToSaleRate?: number;
  monthlyBudget?: number;

  // thresholds
  minimumClicks?: number;
  minimumImpressions?: number;
  minimumSpend?: number;
  minimumConversions?: number;
  minimumDays?: number;
  budgetChangeLimitPct?: number;
}

export interface ClientCreateInput extends ClientProfileInput {
  name: string;
}

export interface ClientUpdateInput extends ClientProfileInput {
  name?: string;
}

const SCALAR_KEYS = [
  "website",
  "industry",
  "subIndustry",
  "businessType",
  "businessModel",
  "currency",
  "primaryConversionGoal",
  "growthGoal",
  "salesCycle",
  "reportedSeasonality",
  "brandVoice",
  "trackingStatus",
  "targetCPA",
  "targetROAS",
  "averageOrderValue",
  "grossMargin",
  "profitPerSale",
  "leadValue",
  "lifetimeValue",
  "leadToSaleRate",
  "monthlyBudget",
  "minimumClicks",
  "minimumImpressions",
  "minimumSpend",
  "minimumConversions",
  "minimumDays",
  "budgetChangeLimitPct",
] as const;

const ARRAY_KEYS = [
  "productsOrServices",
  "primaryOffers",
  "targetCountries",
  "languages",
  "secondaryConversions",
  "restrictions",
] as const;

function toLocationCreateMany(locations: BusinessLocation[]): { city: string; region: string | null; country: string; serviceRadius: string | null }[] {
  return locations.map((l) => ({
    city: l.city,
    region: l.region ?? null,
    country: l.country,
    serviceRadius: l.serviceRadius ?? null,
  }));
}

/**
 * Builds the Prisma create payload. Only supplied fields are set; anything
 * omitted keeps its column default (null / []) — never a guessed value.
 */
export function buildClientCreateData(input: ClientCreateInput): Prisma.ClientCreateInput {
  const data: Record<string, unknown> = { name: input.name };
  for (const key of SCALAR_KEYS) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  for (const key of ARRAY_KEYS) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.customIntents !== undefined) {
    data.customIntentsJson = input.customIntents as unknown as Prisma.InputJsonValue;
  }
  if (input.locations !== undefined && input.locations.length > 0) {
    data.locations = { create: toLocationCreateMany(input.locations) };
  }
  return data as Prisma.ClientCreateInput;
}

/**
 * Builds the Prisma update payload with PARTIAL semantics: only keys that
 * were supplied (not undefined) change. For list-valued fields (arrays,
 * locations, customIntents) a supplied value REPLACES the whole list — to
 * clear it, pass an empty array. Omit the key to leave it untouched.
 */
export function buildClientUpdateData(input: ClientUpdateInput): Prisma.ClientUpdateInput {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  for (const key of SCALAR_KEYS) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  for (const key of ARRAY_KEYS) {
    if (input[key] !== undefined) data[key] = { set: input[key] };
  }
  if (input.customIntents !== undefined) {
    data.customIntentsJson = input.customIntents as unknown as Prisma.InputJsonValue;
  }
  if (input.locations !== undefined) {
    data.locations = { deleteMany: {}, create: toLocationCreateMany(input.locations) };
  }
  return data as Prisma.ClientUpdateInput;
}

// ---------------------------------------------------------------------------
// DB access
// ---------------------------------------------------------------------------

export interface LoadedClient {
  row: ClientRowWithRelations;
  profile: BusinessProfile;
  optimizationConfig: OptimizationConfig;
  customIntents: CustomIntentDefinition[];
}

export function toLoadedClient(row: ClientRowWithRelations): LoadedClient {
  return {
    row,
    profile: toBusinessProfile(row),
    optimizationConfig: toOptimizationConfig(row),
    customIntents: toCustomIntents(row),
  };
}

export async function getClientById(id: string): Promise<LoadedClient | null> {
  const row = await prisma.client.findUnique({ where: { id }, include: { locations: true } });
  if (!row) return null;
  return toLoadedClient(row);
}

export async function createClient(input: ClientCreateInput): Promise<ClientRowWithRelations> {
  return prisma.client.create({ data: buildClientCreateData(input), include: { locations: true } });
}

export async function updateClientFields(id: string, input: ClientUpdateInput): Promise<ClientRowWithRelations> {
  return prisma.client.update({ where: { id }, data: buildClientUpdateData(input), include: { locations: true } });
}
