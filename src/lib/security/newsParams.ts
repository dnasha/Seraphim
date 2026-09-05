import { normalizeSortMode } from "@/lib/utils/ranking";
import { NEWS_SOURCES, NEWS_CATEGORIES } from '@/lib/utils/newsFilterParams';

export const NEWS_DEFAULT_LIMIT = 1000;
export const NEWS_MAX_LIMIT = 1000;
export const NEWS_MAX_SEARCH_LENGTH = 160;

export interface ValidatedNewsParams {
  sources: string[];
  categories: string[];
  credibilityTiers: number[];
  minVolume: number;
  forceRefresh: boolean;
  viewMode: "map" | "sidebar";
  scopeMode: "viewport" | "global";
  hasBBox: boolean;
  minLat: number | null;
  maxLat: number | null;
  minLng: number | null;
  maxLng: number | null;
  searchQuery: string | null;
  zoom: number | null;
  sort: "new" | "hot";
  hasRequestedLimit: boolean;
  requestedLimit: number;
  sinceStr: string | null;
  untilStr: string | null;
  forceRaw: boolean;
  timeRange: '1d' | '3d' | '1w' | '1m' | 'custom';
}

type ParseResult<T> = { value: T } | { error: string };

const parseFinite = (value: string | null, name: string): ParseResult<number> => {
  if (value === null || value.trim() === "") {
    return { error: `${name} is required` };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { error: `${name} must be a finite number` };
  }
  return { value: parsed };
};

const parseOptionalDate = (value: string | null, name: string): ParseResult<string | null> => {
  if (!value) return { value: null };
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return { error: `${name} must be a valid date` };
  }
  return { value };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function validateNewsSearchParams(searchParams: URLSearchParams):
  | { ok: true; params: ValidatedNewsParams }
  | { ok: false; error: string } {
  const viewMode = searchParams.get("view") === "sidebar" ? "sidebar" : "map";
  const scopeMode = searchParams.get("scope") === "global" ? "global" : "viewport";

  const bboxValues = {
    minLat: searchParams.get("minLat"),
    maxLat: searchParams.get("maxLat"),
    minLng: searchParams.get("minLng"),
    maxLng: searchParams.get("maxLng"),
  };
  const bboxPresentCount = Object.values(bboxValues).filter((v) => v !== null).length;
  if (bboxPresentCount > 0 && bboxPresentCount < 4) {
    return { ok: false, error: "Bounding box requires minLat, maxLat, minLng, and maxLng" };
  }

  let minLat: number | null = null;
  let maxLat: number | null = null;
  let minLng: number | null = null;
  let maxLng: number | null = null;
  const hasBBox = bboxPresentCount === 4;

  if (hasBBox) {
    const parsedMinLat = parseFinite(bboxValues.minLat, "minLat");
    const parsedMaxLat = parseFinite(bboxValues.maxLat, "maxLat");
    const parsedMinLng = parseFinite(bboxValues.minLng, "minLng");
    const parsedMaxLng = parseFinite(bboxValues.maxLng, "maxLng");
    if ("error" in parsedMinLat) return { ok: false, error: parsedMinLat.error };
    if ("error" in parsedMaxLat) return { ok: false, error: parsedMaxLat.error };
    if ("error" in parsedMinLng) return { ok: false, error: parsedMinLng.error };
    if ("error" in parsedMaxLng) return { ok: false, error: parsedMaxLng.error };

    const parsedBBox = {
      minLat: parsedMinLat.value,
      maxLat: parsedMaxLat.value,
      minLng: parsedMinLng.value,
      maxLng: parsedMaxLng.value,
    };

    if (
      parsedBBox.minLat < -90 ||
      parsedBBox.minLat > 90 ||
      parsedBBox.maxLat < -90 ||
      parsedBBox.maxLat > 90 ||
      parsedBBox.minLat > parsedBBox.maxLat
    ) {
      return { ok: false, error: "Latitude bounds are invalid" };
    }
    if (
      parsedBBox.minLng < -360 ||
      parsedBBox.minLng > 360 ||
      parsedBBox.maxLng < -360 ||
      parsedBBox.maxLng > 360
    ) {
      return { ok: false, error: "Longitude bounds are invalid" };
    }

    minLat = parsedBBox.minLat;
    maxLat = parsedBBox.maxLat;
    minLng = parsedBBox.minLng;
    maxLng = parsedBBox.maxLng;
  }

  const zoomRaw = searchParams.get("zoom");
  let zoom: number | null = null;
  if (zoomRaw) {
    const parsedZoom = parseFinite(zoomRaw, "zoom");
    if ("error" in parsedZoom) return { ok: false, error: parsedZoom.error };
    if (parsedZoom.value < 0 || parsedZoom.value > 24) {
      return { ok: false, error: "zoom is out of range" };
    }
    zoom = parsedZoom.value;
  }

  const hasRequestedLimit = searchParams.has("limit");
  let requestedLimit = NEWS_DEFAULT_LIMIT;
  if (hasRequestedLimit) {
    const limitRaw = searchParams.get("limit");
    const parsedLimit = parseFinite(limitRaw, "limit");
    if ("error" in parsedLimit) return { ok: false, error: parsedLimit.error };
    requestedLimit = clamp(Math.trunc(parsedLimit.value), 1, NEWS_MAX_LIMIT);
  }

  const since = parseOptionalDate(searchParams.get("since"), "since");
  if ("error" in since) return { ok: false, error: since.error };
  const until = parseOptionalDate(searchParams.get("until"), "until");
  if ("error" in until) return { ok: false, error: until.error };
  if (since.value && until.value && new Date(until.value).getTime() < new Date(since.value).getTime()) {
    return { ok: false, error: "until must be after since" };
  }

  const rawSearch = searchParams.get("query");
  const searchQuery = rawSearch?.trim() || null;
  if (searchQuery && searchQuery.length > NEWS_MAX_SEARCH_LENGTH) {
    return { ok: false, error: `query must be ${NEWS_MAX_SEARCH_LENGTH} characters or fewer` };
  }

  const rawTimeRange = searchParams.get('time_range') || '1d';
  if (!['1d', '3d', '1w', '1m', 'custom'].includes(rawTimeRange)) {
    return { ok: false, error: 'time_range is invalid' };
  }
  const sources = [...new Set((searchParams.get('sources') ?? NEWS_SOURCES.join(',')).split(',').filter(Boolean))].sort();
  const categories = [...new Set((searchParams.get('categories') ?? 'all').split(',').filter(Boolean))].sort();
  const credibility = (searchParams.get('credibility') ?? '1,2,3').split(',').filter(Boolean);
  if (sources.some(value => !(NEWS_SOURCES as readonly string[]).includes(value)) ||
      categories.some(value => !(NEWS_CATEGORIES as readonly string[]).includes(value)) ||
      credibility.some(value => !['1', '2', '3'].includes(value))) {
    return { ok: false, error: 'Invalid news filter' };
  }
  const minVolume = Number(searchParams.get('min_reports') ?? '1');
  if (!Number.isInteger(minVolume) || minVolume < 1 || minVolume > 100000) {
    return { ok: false, error: 'min_reports must be an integer from 1 to 100000' };
  }

  return {
    ok: true,
    params: {
      sources, categories, credibilityTiers: [...new Set(credibility.map(Number))].sort(), minVolume,
      forceRefresh: searchParams.get("refresh") === "true",
      viewMode,
      scopeMode,
      hasBBox,
      minLat,
      maxLat,
      minLng,
      maxLng,
      searchQuery,
      zoom,
      sort: normalizeSortMode(searchParams.get("sort")),
      hasRequestedLimit,
      requestedLimit,
      sinceStr: since.value,
      untilStr: until.value,
      forceRaw: searchParams.get("force_raw") === "true",
      timeRange: rawTimeRange as ValidatedNewsParams['timeRange'],
    },
  };
}
