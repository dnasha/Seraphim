/**
 * Product entitlement contract shared by the dashboard and route handlers.
 * Keep this file free of browser/server dependencies so there is one source of
 * truth for every tier gate.
 */

export type UserTier = 'guest' | 'free' | 'pro' | 'analyst' | 'angel';
export type TimeRangeKey = '1d' | '3d' | '1w' | '1m' | 'custom';

export type EntitlementFeature =
  | 'search'
  | 'basicFilters'
  | 'advancedFilters'
  | 'fullTimeline'
  | 'drawTools'
  | 'geoJsonTransfer'
  | 'premiumMapStyles'
  | 'globe'
  | 'proOverlays'
  | 'analystOverlays'
  | 'unmappedOnly'
  | 'individualPins';

export interface TierEntitlements {
  tier: UserTier;
  eventLimit: number;
  allowedTimeRanges: readonly TimeRangeKey[];
  features: Readonly<Record<EntitlementFeature, boolean>>;
  overlays: readonly string[];
  mapStyles: readonly string[];
  timelineSourceLimit: number | null;
}

const GUEST_FEATURES: Record<EntitlementFeature, boolean> = {
  search: false,
  basicFilters: false,
  advancedFilters: false,
  fullTimeline: false,
  drawTools: false,
  geoJsonTransfer: false,
  premiumMapStyles: false,
  globe: false,
  proOverlays: false,
  analystOverlays: false,
  unmappedOnly: false,
  individualPins: false,
};

const FREE_FEATURES: Record<EntitlementFeature, boolean> = {
  ...GUEST_FEATURES,
  search: true,
  basicFilters: true,
  drawTools: true,
};

const PRO_FEATURES: Record<EntitlementFeature, boolean> = {
  ...FREE_FEATURES,
  advancedFilters: true,
  fullTimeline: true,
  premiumMapStyles: true,
  globe: true,
  proOverlays: true,
};

const ANALYST_FEATURES: Record<EntitlementFeature, boolean> = {
  ...PRO_FEATURES,
  geoJsonTransfer: true,
  analystOverlays: true,
  unmappedOnly: true,
  individualPins: true,
};

export const TIER_ENTITLEMENTS: Readonly<Record<UserTier, TierEntitlements>> = {
  guest: {
    tier: 'guest',
    eventLimit: 10,
    allowedTimeRanges: ['1d'],
    features: GUEST_FEATURES,
    overlays: [],
    mapStyles: [],
    timelineSourceLimit: 0,
  },
  free: {
    tier: 'free',
    eventLimit: 100,
    allowedTimeRanges: ['1d'],
    features: FREE_FEATURES,
    overlays: ['usgs'],
    mapStyles: ['standard', 'dark'],
    timelineSourceLimit: 2,
  },
  pro: {
    tier: 'pro',
    eventLimit: 1000,
    allowedTimeRanges: ['1d', '3d', '1w', '1m'],
    features: PRO_FEATURES,
    overlays: ['usgs', 'noaa', 'fires', 'eonet'],
    mapStyles: ['standard', 'dark', 'black', 'light', 'satellite', 'topographic'],
    timelineSourceLimit: null,
  },
  analyst: {
    tier: 'analyst',
    eventLimit: 1000,
    allowedTimeRanges: ['1d', '3d', '1w', '1m', 'custom'],
    features: ANALYST_FEATURES,
    overlays: ['usgs', 'noaa', 'fires', 'eonet', 'flights', 'ships', 'iss', 'aqi', 'radiation'],
    mapStyles: ['standard', 'dark', 'black', 'light', 'satellite', 'topographic'],
    timelineSourceLimit: null,
  },
  angel: {
    tier: 'angel',
    eventLimit: 1000,
    allowedTimeRanges: ['1d', '3d', '1w', '1m', 'custom'],
    features: ANALYST_FEATURES,
    overlays: ['usgs', 'noaa', 'fires', 'eonet', 'flights', 'ships', 'iss', 'aqi', 'radiation'],
    mapStyles: ['standard', 'dark', 'black', 'light', 'satellite', 'topographic'],
    timelineSourceLimit: null,
  },
};

export function normalizeUserTier(value: string | null | undefined, authenticated = false): UserTier {
  const tier = value?.toLowerCase();
  if (tier === 'pro' || tier === 'analyst' || tier === 'angel' || tier === 'free') return tier;
  return authenticated ? 'free' : 'guest';
}

export function getEntitlements(tier: UserTier): TierEntitlements {
  return TIER_ENTITLEMENTS[tier];
}

export function hasFeature(tier: UserTier, feature: EntitlementFeature): boolean {
  return TIER_ENTITLEMENTS[tier].features[feature];
}

export function canUseTimeRange(tier: UserTier, timeRange: string | null | undefined): boolean {
  return TIER_ENTITLEMENTS[tier].allowedTimeRanges.includes((timeRange || '1d') as TimeRangeKey);
}

export function canUseOverlay(tier: UserTier, overlay: string): boolean {
  return TIER_ENTITLEMENTS[tier].overlays.includes(overlay);
}

export function canUseMapStyle(tier: UserTier, style: string): boolean {
  return TIER_ENTITLEMENTS[tier].mapStyles.includes(style);
}

export function requiredTierForFeature(feature: EntitlementFeature): UserTier {
  const tiers: UserTier[] = ['free', 'pro', 'analyst'];
  return tiers.find((tier) => TIER_ENTITLEMENTS[tier].features[feature]) ?? 'analyst';
}
