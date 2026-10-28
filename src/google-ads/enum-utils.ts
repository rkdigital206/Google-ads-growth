/**
 * Enum normalization at the Google Ads boundary.
 *
 * `google-ads-api` returns enum-valued GAQL fields (campaign.status,
 * customer.status, conversion_action.counting_type, ...) as NUMERIC enum
 * values, not strings. Code that compared them to "ENABLED" would silently
 * never match against live data. Every service in src/google-ads/ converts
 * these fields to their string names with `enumName()` before returning rows,
 * so everything downstream (audit, normalize, tools) can rely on strings.
 *
 * Already-string values (e.g. from tests/fixtures or REST transports) pass
 * through unchanged.
 */

import { enums } from "google-ads-api/enums";

type NumericEnum = Record<string | number, string | number>;

/** Converts a numeric (or already-string) enum value to its string name. Unknown/unmappable values become "UNKNOWN" — never a guess. */
export function enumName(enumObj: NumericEnum, value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const name = enumObj[value];
    return typeof name === "string" ? name : "UNKNOWN";
  }
  return "UNKNOWN";
}

export const CustomerStatusEnum = enums.CustomerStatus as unknown as NumericEnum;
export const CampaignStatusEnum = enums.CampaignStatus as unknown as NumericEnum;
export const ChannelTypeEnum = enums.AdvertisingChannelType as unknown as NumericEnum;
export const ConversionActionStatusEnum = enums.ConversionActionStatus as unknown as NumericEnum;
export const CountingTypeEnum = enums.ConversionActionCountingType as unknown as NumericEnum;
export const KeywordMatchTypeEnum = enums.KeywordMatchType as unknown as NumericEnum;
export const CriterionStatusEnum = enums.AdGroupCriterionStatus as unknown as NumericEnum;
export const AdGroupStatusEnum = enums.AdGroupStatus as unknown as NumericEnum;
