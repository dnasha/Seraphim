import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  fetchWithTimeout,
  parseProxyCoordinate,
  validateTilePath,
} from "@/lib/security/proxyGuards";
import { canUseOverlay } from '@/lib/entitlements';
import { resolveRequestEntitlements } from '@/lib/server/entitlements';
import { getRateLimitKeys, getTrustedClientIp } from '@/lib/security/clientIdentity';
import { recordIncident, recordMetric, recoverIncident, serverDiagnostic } from '@/lib/server/operations';

const redis = Redis.fromEnv();
const proxyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(180, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit/seraphim-proxy",
});

const localLimit = new Map<string, { count: number; reset: number }>();
let lastCleanup = Date.now();
let lastIssGeoJson: { data: unknown; timestamp: number } | null = null;
const overlayFailureRecordedAt = new Map<string, number>();

function markOverlayFailure(service: string, errorCode: string) {
  const now = Date.now();
  if (now - (overlayFailureRecordedAt.get(service) ?? 0) < 5 * 60 * 1000) return;
  overlayFailureRecordedAt.set(service, now);
  void recordMetric({ kind: 'operational', service: 'overlays', name: `${service}.failure` });
  void recordIncident({
    dedupKey: `overlay:${service}`,
    service: 'overlays',
    type: 'provider_unavailable',
    severity: 'warning',
    safeContext: { provider: service, error_code: errorCode },
  });
}

function markOverlayHealthy(service: string) {
  if (!overlayFailureRecordedAt.delete(service)) return;
  void recoverIncident(`overlay:${service}`);
}

const EMPTY_FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: []
};

const PREMIUM_PROXY_SERVICES: Record<string, string> = {
  flights: 'flights',
  safecast: 'radiation',
  wildfires: 'fires',
  eonet: 'eonet',
  iss: 'iss',
};

const PRIVATE_CACHE_HEADERS = { 'Cache-Control': 'private, no-store' };

async function checkProxyRateLimit(clientIp: string, userId?: string | null) {
  const now = Date.now();
  if (now - lastCleanup > 60000) {
    for (const [ip, entry] of localLimit.entries()) {
      if (now > entry.reset) localLimit.delete(ip);
    }
    lastCleanup = now;
  }

  const rateLimitKeys = getRateLimitKeys(clientIp, userId);
  const localKey = rateLimitKeys[0];
  const current = localLimit.get(localKey);
  if (!current || now > current.reset) {
    localLimit.set(localKey, { count: 1, reset: now + 10000 });
    return true;
  }

  current.count++;
  if (current.count <= 20 && current.count % 8 !== 0) return true;

  try {
    const results = await Promise.all(rateLimitKeys.map((key) => proxyRatelimit.limit(key)));
    return results.every(({ success }) => success);
  } catch {
    serverDiagnostic('proxy_rate_limit_unavailable');
    return true;
  }
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await props.params;
  const path = resolvedParams.path;

  if (!path || path.length === 0) {
    return NextResponse.json({ error: "Missing path" }, { status: 400 });
  }

  const service = path[0];

  const clientIp = getTrustedClientIp(request.headers);
  if (!clientIp) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const requiredOverlay = PREMIUM_PROXY_SERVICES[service];
  let userId: string | null | undefined;
  if (requiredOverlay) {
    const access = await resolveRequestEntitlements();
    userId = access.userId;
    if (!canUseOverlay(access.tier, requiredOverlay)) {
      return NextResponse.json(
        {
          error: `${requiredOverlay} overlay requires an upgraded plan`,
          code: 'feature_required',
          requiredTier: ['fires', 'eonet'].includes(requiredOverlay) ? 'pro' : 'analyst',
        },
        { status: 403 },
      );
    }
  }

  if (!(await checkProxyRateLimit(clientIp, userId))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (service === "flights") {
    const { searchParams } = new URL(request.url);
    const lat = parseProxyCoordinate(searchParams.get("lat"), -90, 90);
    const lng = parseProxyCoordinate(searchParams.get("lng"), -180, 180);
    if (lat === null || lng === null) {
      return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
    }
    const latStr = lat.toFixed(4);
    const lngStr = lng.toFixed(4);

    try {
      let res = await fetchWithTimeout(`https://api.adsb.lol/v2/lat/${latStr}/lon/${lngStr}/dist/150`, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SeraphimOSINT/1.0"
        }
      }, 5000);
      if (!res.ok) {
        console.warn(`[proxy/flights] ADSB.lol failed with status ${res.status}, trying opendata.adsb.fi fallback...`);
        res = await fetchWithTimeout(`https://opendata.adsb.fi/api/v3/lat/${latStr}/lon/${lngStr}/dist/150`, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "SeraphimOSINT/1.0"
          }
        }, 5000);
      }
      if (!res.ok) {
        markOverlayFailure('flights', `http_${res.status}`);
        return NextResponse.json({ error: "Failed to fetch from all ADSB endpoints" }, { status: res.status });
      }
      const data = await res.json();
      markOverlayHealthy('flights');
      return NextResponse.json(data, {
        headers: PRIVATE_CACHE_HEADERS,
      });
    } catch (err) {
      console.warn("[proxy/flights] Exception, trying opendata.adsb.fi fallback:", err);
      try {
        const res = await fetchWithTimeout(`https://opendata.adsb.fi/api/v3/lat/${latStr}/lon/${lngStr}/dist/150`, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "SeraphimOSINT/1.0"
          }
        }, 5000);
        if (res.ok) {
          const data = await res.json();
          markOverlayHealthy('flights');
          return NextResponse.json(data, {
            headers: PRIVATE_CACHE_HEADERS,
          });
        }
        markOverlayFailure('flights', `http_${res.status}`);
        return NextResponse.json({ error: "Failed to fetch from fallback" }, { status: res.status });
      } catch {
        markOverlayFailure('flights', 'fallback_failed');
        serverDiagnostic('overlay_flights_failed');
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
    }
  }

  if (service === "safecast") {
    const tile = validateTilePath(path[1], path[2], path[3]);
    if (!tile) {
      return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400 });
    }

    try {
      const res = await fetchWithTimeout(`https://s3.amazonaws.com/te512.safecast.org/${tile.z}/${tile.x}/${tile.y}.png`, {}, 5000);
      if (!res.ok) {
        // Return 204 No Content for missing/forbidden tiles (S3 returns 403/404 for non-existent keys)
        // to prevent MapLibre from logging AJAX errors in the browser console.
        return new NextResponse(null, { status: 204 });
      }

      const arrayBuffer = await res.arrayBuffer();
      return new NextResponse(arrayBuffer, {
        headers: {
          "Content-Type": "image/png",
          ...PRIVATE_CACHE_HEADERS
        }
      });
    } catch {
      markOverlayFailure('safecast', 'request_failed');
      serverDiagnostic('overlay_safecast_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "wildfires") {
    try {
      const res = await fetchWithTimeout("https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv", {}, 8000);
      if (!res.ok) {
        markOverlayFailure('wildfires', `http_${res.status}`);
        return NextResponse.json({ error: "Failed to fetch active fires from FIRMS" }, { status: res.status });
      }
      const text = await res.text();
      const lines = text.split('\n');
      
      const features = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(',');
        if (cols.length < 13) continue;
        
        const lat = parseFloat(cols[0]);
        const lon = parseFloat(cols[1]);
        const confidence = cols[8];
        const frp = parseFloat(cols[11]) || 0;
        
        if (confidence === 'low' || frp < 10) continue;
        
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lon, lat]
          },
          properties: {
            confidence,
            frp,
            acq_date: cols[5],
            acq_time: cols[6],
            satellite: cols[7]
          }
        });
      }
      
      const geojson = {
        type: "FeatureCollection",
        features
      };
      markOverlayHealthy('wildfires');
      
      return NextResponse.json(geojson, {
        headers: {
          ...PRIVATE_CACHE_HEADERS
        }
      });
    } catch {
      markOverlayFailure('wildfires', 'request_failed');
      serverDiagnostic('overlay_wildfires_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "eonet") {
    try {
      const res = await fetchWithTimeout("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30&category=wildfires,volcanoes,severeStorms,floods", {}, 8000);
      if (!res.ok) {
        markOverlayFailure('eonet', `http_${res.status}`);
        return NextResponse.json({ error: "Failed to fetch active events from EONET" }, { status: res.status });
      }
      markOverlayHealthy('eonet');
      const data = await res.json();
      if (data && Array.isArray(data.features)) {
        for (const f of data.features) {
          if (f.properties && Array.isArray(f.properties.categories) && f.properties.categories.length > 0) {
            f.properties.category = f.properties.categories[0].id;
          } else {
            f.properties.category = "unknown";
          }
        }
      }
      return NextResponse.json(data, {
        headers: {
          ...PRIVATE_CACHE_HEADERS
        }
      });
    } catch {
      markOverlayFailure('eonet', 'request_failed');
      serverDiagnostic('overlay_eonet_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "iss") {
    try {
      const res = await fetchWithTimeout("https://api.wheretheiss.at/v1/satellites/25544", {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SeraphimOSINT/1.0"
        }
      }, 8000);
      if (!res.ok) {
        markOverlayFailure('iss', `http_${res.status}`);
        return NextResponse.json(lastIssGeoJson?.data ?? EMPTY_FEATURE_COLLECTION, {
          headers: {
            ...PRIVATE_CACHE_HEADERS
          }
        });
      }
      const data = await res.json();
      
      const geojson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [data.longitude, data.latitude]
            },
            properties: {
              name: "ISS (Zarya)",
              type: "Space Station",
              altitude: `${data.altitude.toFixed(1)} km`,
              velocity: `${data.velocity.toFixed(0)} km/h`,
              visibility: data.visibility,
              timestamp: data.timestamp
            }
          }
        ]
      };
      lastIssGeoJson = { data: geojson, timestamp: Date.now() };
      markOverlayHealthy('iss');
      
      return NextResponse.json(geojson, {
        headers: {
          ...PRIVATE_CACHE_HEADERS
        }
      });
    } catch {
      markOverlayFailure('iss', 'request_failed');
      serverDiagnostic('overlay_iss_failed');
      return NextResponse.json(lastIssGeoJson?.data ?? EMPTY_FEATURE_COLLECTION, {
        headers: {
          ...PRIVATE_CACHE_HEADERS
        }
      });
    }
  }

  return NextResponse.json({ error: "Unknown service" }, { status: 404 });
}
