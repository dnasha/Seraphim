"use client";

/**
 * src/app/test-map/page.tsx
 *
 * Seraphim v2 – Supabase bridge visualizer. Hidden diagnostic route, not linked
 * from the main UI. Fetches test events from Supabase and plots them on a map.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { createClient } from "@supabase/supabase-js";
import "leaflet/dist/leaflet.css";

interface DbEvent {
  id: string;
  title: string;
  description: string;
  category: string;
  latitude: number;
  longitude: number;
  source: string;
  url: string;
  published_at: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  general: "#6b7280",
  world: "#dc2626",
  crisis: "#b91c1c",
  nation: "#2563eb",
  business: "#d97706",
  technology: "#0891b2",
  science: "#059669",
  health: "#7c3aed",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export default function TestMapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [events, setEvents] = useState<DbEvent[]>([]);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch test rows from Supabase
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setErrorMsg(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
      );
      setStatus("error");
      return;
    }

    setStatus("loading");
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    supabase
      .from("events")
      .select(
        "id, title, description, category, latitude, longitude, source, url, published_at",
      )
      .like("url", "https://seraphim.test/mock/%")
      .order("published_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setErrorMsg(`Supabase: ${error.message}`);
          setStatus("error");
          return;
        }
        setEvents(
          (data ?? []).filter(
            (e) => e.latitude != null && e.longitude != null,
          ) as DbEvent[],
        );
        setStatus("success");
      });
  }, []);

  // Init Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, { center: [30, 10], zoom: 2 });
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        },
      ).addTo(map);
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Plot markers once both map and data are ready
  useEffect(() => {
    if (status !== "success" || !mapRef.current || events.length === 0) return;

    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current!;

      events.forEach((event) => {
        const color = CATEGORY_COLORS[event.category] ?? "#6b7280";
        L.circleMarker([event.latitude, event.longitude], {
          radius: 10,
          fillColor: color,
          color: "#fff",
          weight: 2,
          fillOpacity: 0.9,
        })
          .bindPopup(
            `
            <div style="font-family:monospace;font-size:12px;line-height:1.6">
              <strong>${event.title}</strong><br/>
              ${event.category} &nbsp;|&nbsp; ${event.latitude}, ${event.longitude}<br/>
              ${new Date(event.published_at).toLocaleString()}<br/>
              <span style="color:#888;font-size:11px">${event.id}</span>
            </div>
          `,
          )
          .addTo(map);
      });

      const bounds = L.latLngBounds(
        events.map((e) => [e.latitude, e.longitude]),
      );
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8 });
    })();
  }, [status, events]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily: "monospace",
      }}
    >
      {/* 
      <div style={{ padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#f59e0b' }}>diagnostic</span>
          <span style={{ marginLeft: '10px', fontSize: '13px', color: '#94a3b8' }}>/test-map &mdash; Supabase bridge</span>
        </div>
        <div style={{ fontSize: '12px', color: status === 'success' ? '#4ade80' : status === 'error' ? '#f87171' : '#64748b' }}>
          {status === 'loading' && 'fetching...'}
          {status === 'success' && `${events.length} rows`}
          {status === 'error' && 'error'}
          {status === 'idle' && 'idle'}
        </div>
      </div>Header */}

      {/* Error */}
      {status === "error" && (
        <div
          style={{
            padding: "10px 16px",
            background: "#1c0a0a",
            borderBottom: "1px solid #7f1d1d",
            color: "#f87171",
            fontSize: "12px",
            flexShrink: 0,
          }}
        >
          {errorMsg}
        </div>
      )}

      {/* Row list */}
      {status === "success" && events.length > 0 && (
        <div
          style={{
            padding: "8px 16px",
            background: "#111827",
            borderBottom: "1px solid #1e293b",
            maxHeight: "140px",
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          {events.map((e) => (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "4px 0",
                borderBottom: "1px solid #1e293b",
                fontSize: "12px",
                color: "#94a3b8",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: CATEGORY_COLORS[e.category] ?? "#888",
                  flexShrink: 0,
                  display: "inline-block",
                }}
              />
              <span style={{ color: "#e2e8f0" }}>{e.title}</span>
              <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                {e.latitude.toFixed(4)}, {e.longitude.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Map */}
      <div
        ref={mapContainerRef}
        id="test-supabase-map"
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  );
}
