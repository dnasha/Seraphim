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
import { getCachedOverlayData, type OverlayCacheStore } from '@/lib/server/overlayCache';
import { createOverlayHealthRecorder, type OverlayHealthStore } from '@/lib/server/overlayHealth';

const redis = Redis.fromEnv();
const overlayStore = redis as unknown as OverlayCacheStore & OverlayHealthStore;
const proxyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(180, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit/seraphim-proxy",
});

const localLimit = new Map<string, { count: number; reset: number }>();
let lastCleanup = Date.now();
const overlayHealth = createOverlayHealthRecorder({
  store: overlayStore,
  recordFailure: async (service, errorCode) => {
    await Promise.all([
      recordMetric({ kind: 'operational', service: 'overlays', name: `${service}.failure` }),
      recordIncident({
        dedupKey: `overlay:${service}`,
        service: 'overlays',
        type: 'provider_unavailable',
        severity: 'warning',
        safeContext: { provider: service, error_code: errorCode },
      }),
    ]);
  },
  recordRecovery: async (service) => {
    await recoverIncident(`overlay:${service}`);
  },
  onStoreError: () => serverDiagnostic('overlay_health_store_unavailable'),
});

async function markOverlayFailure(service: string, errorCode: string) {
  await overlayHealth.markFailure(service, errorCode);
}

async function markOverlayHealthy(service: string) {
  await overlayHealth.markHealthy(service);
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
    // A 0.01-degree bucket is roughly one kilometre and is negligible relative
    // to the provider's 150-NM search radius, while allowing nearby viewers to
    // share the same short-lived provider result.
    const latStr = lat.toFixed(2);
    const lngStr = lng.toFixed(2);

    try {
      const data = await getCachedOverlayData({
        key: `seraphim:overlay-cache:v1:flights:${latStr}:${lngStr}`,
        freshForMs: 12_000,
        staleForMs: 60_000,
        store: overlayStore,
        load: async () => {
          try {
            let res: Response;
            try {
              res = await fetchWithTimeout(`https://api.adsb.lol/v2/lat/${latStr}/lon/${lngStr}/dist/150`, {
                headers: {
                  "Accept": "application/json",
                  "User-Agent": "SeraphimOSINT/1.0"
                }
              }, 5000);
            } catch (error) {
              console.warn("[proxy/flights] ADSB.lol request failed, trying opendata.adsb.fi fallback:", error);
              res = new Response(null, { status: 503 });
            }
            if (!res.ok) {
              console.warn(`[proxy/flights] ADSB.lol failed with status ${res.status}, trying opendata.adsb.fi fallback...`);
              res = await fetchWithTimeout(`https://opendata.adsb.fi/api/v3/lat/${latStr}/lon/${lngStr}/dist/150`, {
                headers: {
                  "Accept": "application/json",
                  "User-Agent": "SeraphimOSINT/1.0"
                }
              }, 5000);
            }
            if (!res.ok) throw new Error(`flight_provider_http_${res.status}`);
            const providerData = await res.json();
            await markOverlayHealthy('flights');
            return providerData;
          } catch (error) {
            await markOverlayFailure('flights', 'all_providers_failed');
            throw error;
          }
        },
      });
      return NextResponse.json(data, {
        headers: PRIVATE_CACHE_HEADERS,
      });
    } catch (err) {
      console.warn("[proxy/flights] All providers failed:", err);
      serverDiagnostic('overlay_flights_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
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
      await markOverlayFailure('safecast', 'request_failed');
      serverDiagnostic('overlay_safecast_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
  if (service === "wildfires") {
    try {
      const res = await fetchWithTimeout("https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv", {}, 8000);
      if (!res.ok) {
        await markOverlayFailure('wildfires', `http_${res.status}`);
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
      await markOverlayHealthy('wildfires');
      
      return NextResponse.json(geojson, {
        headers: {
          ...PRIVATE_CACHE_HEADERS
        }
      });
    } catch {
      await markOverlayFailure('wildfires', 'request_failed');
      serverDiagnostic('overlay_wildfires_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "eonet") {
    try {
      const res = await fetchWithTimeout("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30&category=wildfires,volcanoes,severeStorms,floods", {}, 8000);
      if (!res.ok) {
        await markOverlayFailure('eonet', `http_${res.status}`);
        return NextResponse.json({ error: "Failed to fetch active events from EONET" }, { status: res.status });
      }
      await markOverlayHealthy('eonet');
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
      await markOverlayFailure('eonet', 'request_failed');
      serverDiagnostic('overlay_eonet_failed');
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "iss") {
    try {
      const geojson = await getCachedOverlayData({
        key: 'seraphim:overlay-cache:v1:iss',
        freshForMs: 10_000,
        staleForMs: 60_000,
        store: overlayStore,
        load: async () => {
          try {
            const res = await fetchWithTimeout("https://api.wheretheiss.at/v1/satellites/25544", {
              headers: {
                "Accept": "application/json",
                "User-Agent": "SeraphimOSINT/1.0"
              }
            }, 8000);
            if (!res.ok) throw new Error(`iss_provider_http_${res.status}`);
            const data = await res.json();
            const result = {
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
            await markOverlayHealthy('iss');
            return result;
          } catch (error) {
            await markOverlayFailure('iss', 'request_failed');
            throw error;
          }
        },
      });
      return NextResponse.json(geojson, {
        headers: PRIVATE_CACHE_HEADERS,
      });
    } catch (error) {
      console.warn('[proxy/iss] Provider request failed:', error);
      serverDiagnostic('overlay_iss_failed');
      return NextResponse.json(EMPTY_FEATURE_COLLECTION, {
        headers: PRIVATE_CACHE_HEADERS,
      });
    }
  }

  return NextResponse.json({ error: "Unknown service" }, { status: 404 });
}
