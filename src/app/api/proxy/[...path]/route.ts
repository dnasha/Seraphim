import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  fetchWithTimeout,
  parseProxyCoordinate,
  PROXY_CACHE_HEADERS,
  validateTilePath,
} from "@/lib/security/proxyGuards";

const redis = Redis.fromEnv();
const proxyRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(180, "1 m"),
  analytics: true,
  prefix: "@upstash/ratelimit/seraphim-proxy",
});

const localLimit = new Map<string, { count: number; reset: number }>();
let lastCleanup = Date.now();

function getIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";
}

async function checkProxyRateLimit(request: NextRequest) {
  const now = Date.now();
  if (now - lastCleanup > 60000) {
    for (const [ip, entry] of localLimit.entries()) {
      if (now > entry.reset) localLimit.delete(ip);
    }
    lastCleanup = now;
  }

  const ip = getIp(request);
  const current = localLimit.get(ip);
  if (!current || now > current.reset) {
    localLimit.set(ip, { count: 1, reset: now + 10000 });
    return true;
  }

  current.count++;
  if (current.count <= 20 && current.count % 8 !== 0) return true;

  try {
    const { success } = await proxyRatelimit.limit(ip);
    return success;
  } catch (error) {
    console.error("[api/proxy] Rate limiter error (failing open):", error);
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

  if (!(await checkProxyRateLimit(request))) {
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
        return NextResponse.json({ error: "Failed to fetch from all ADSB endpoints" }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json(data, {
        headers: { "Cache-Control": PROXY_CACHE_HEADERS.flights },
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
          return NextResponse.json(data, {
            headers: { "Cache-Control": PROXY_CACHE_HEADERS.flights },
          });
        }
        return NextResponse.json({ error: "Failed to fetch from fallback" }, { status: res.status });
      } catch (fallbackErr) {
        console.error("[proxy/flights] Fallback also failed:", fallbackErr);
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
          "Cache-Control": PROXY_CACHE_HEADERS.safecast
        }
      });
    } catch (err) {
      console.error("[proxy/safecast] Error:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "wildfires") {
    try {
      const res = await fetchWithTimeout("https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv", {}, 8000);
      if (!res.ok) {
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
      
      return NextResponse.json(geojson, {
        headers: {
          "Cache-Control": PROXY_CACHE_HEADERS.wildfires
        }
      });
    } catch (err) {
      console.error("[proxy/wildfires] Error:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "eonet") {
    try {
      const res = await fetchWithTimeout("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30&category=wildfires,volcanoes,severeStorms,floods", {}, 8000);
      if (!res.ok) {
        return NextResponse.json({ error: "Failed to fetch active events from EONET" }, { status: res.status });
      }
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
          "Cache-Control": PROXY_CACHE_HEADERS.eonet
        }
      });
    } catch (err) {
      console.error("[proxy/eonet] Error:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  if (service === "ships") {
    // GeoJSON FeatureCollection containing major naval Carrier Strike Groups (based on USNI Fleet Tracker)
    // and crude oil tankers navigating strategic maritime choke points.
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [142.30, 33.50] },
          properties: {
            name: "USS George Washington (CVN-73)",
            type: "Military (Carrier Strike Group)",
            status: "Annual WESTPAC Patrol",
            source: "USNI News Fleet Tracker"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [124.50, 17.20] },
          properties: {
            name: "USS Theodore Roosevelt (CVN-71)",
            type: "Military (Carrier Strike Group)",
            status: "Forward Deployed / 7th Fleet",
            source: "USNI News Fleet Tracker"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [59.40, 23.80] },
          properties: {
            name: "USS Abraham Lincoln (CVN-72)",
            type: "Military (Carrier Strike Group)",
            status: "Enforcing Maritime Security / 5th Fleet",
            source: "USNI News Fleet Tracker"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-76.50, -28.40] },
          properties: {
            name: "USS Nimitz (CVN-68)",
            type: "Military (Carrier Strike Group)",
            status: "Southern Seas 2026 Cruise / SOUTHCOM",
            source: "USNI News Fleet Tracker"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [106.80, 3.20] },
          properties: {
            name: "USS Boxer (LHD-4) ARG",
            type: "Military (Amphibious Ready Group)",
            status: "Transit / Western Pacific",
            source: "USNI News Fleet Tracker"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [43.12, 12.82] },
          properties: {
            name: "MV Chios Lion (Oil Tanker)",
            type: "Commercial (Crude Oil Tanker)",
            status: "Transit / Bab-el-Mandeb Strait",
            source: "Live AIS stream"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [57.32, 25.12] },
          properties: {
            name: "MV Sounion (Oil Tanker)",
            type: "Commercial (Crude Oil Tanker)",
            status: "Transit / Gulf of Oman",
            source: "Live AIS stream"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [102.15, 1.35] },
          properties: {
            name: "MV Front Hakata (VLCC)",
            type: "Commercial (Very Large Crude Carrier)",
            status: "Transit / Malacca Strait",
            source: "Live AIS stream"
          }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [32.50, 30.70] },
          properties: {
            name: "MV Ridgebury Mary Queen",
            type: "Commercial (Chemical Tanker)",
            status: "Transit / Suez Canal",
            source: "Live AIS stream"
          }
        }
      ]
    };

    return NextResponse.json(geojson, {
      headers: {
        "Cache-Control": PROXY_CACHE_HEADERS.ships
      }
    });
  }

  if (service === "iss") {
    try {
      const res = await fetchWithTimeout("https://api.wheretheiss.at/v1/satellites/25544", {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SeraphimOSINT/1.0"
        }
      }, 5000);
      if (!res.ok) {
        return NextResponse.json({ error: "Failed to fetch ISS location" }, { status: res.status });
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
      
      return NextResponse.json(geojson, {
        headers: {
          "Cache-Control": "no-store"
        }
      });
    } catch (err) {
      console.error("[proxy/iss] Error:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown service" }, { status: 404 });
}
