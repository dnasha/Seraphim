/*
  Seraphim Supabase Bridge Test
  Verifies read/write connectivity to the database using mock events.
  Tests upsert operations, read-back verification, and connection stability.

  Usage: bun run scripts/diagnostics/test-supabase.ts
*/

import { supabaseAdmin as supabase } from "@/lib/core/supabase-admin";

if (!supabase) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const db = supabase!;

// Mock events for connection validation.
const mockEvents = [
  {
    title: "[TEST] Drone activity reported near Kyiv infrastructure",
    description:
      "Multiple unidentified drones were spotted approaching critical infrastructure west of Kyiv. Ukrainian air-defense units scrambled. No casualties reported.",
    source: "Seraphim Mock",
    url: "https://seraphim.test/mock/kyiv-drone-001",
    category: "crisis",
    latitude: 50.4501,
    longitude: 30.5234,
    published_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    title: "[TEST] Pentagon briefing on Eastern European force posture",
    description:
      "Senior DoD officials held a closed briefing with congressional members regarding NATO strategy in the eastern flank.",
    source: "Seraphim Mock",
    url: "https://seraphim.test/mock/pentagon-brief-001",
    category: "world",
    latitude: 38.8719,
    longitude: -77.0563,
    published_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    title: "[TEST] Earthquake swarm detected off coast of Taiwan",
    description:
      "USGS reports a sequence of M4.1-M5.3 earthquakes in the Taiwan Strait. No tsunami warning issued.",
    source: "Seraphim Mock",
    url: "https://seraphim.test/mock/taiwan-quake-001",
    category: "science",
    latitude: 23.6978,
    longitude: 120.9605,
    published_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
];

async function run() {
  console.log("Starting Supabase connection test...");
  console.log("Upserting 3 mock events...");

  // Write mock data to database.
  const { data: upserted, error: writeError } = await db
    .from("events")
    .upsert(mockEvents, { onConflict: "url", ignoreDuplicates: false })
    .select();

  if (writeError) {
    console.error("INSERT failed:", writeError.message);
    process.exit(1);
  }

  console.log(`Upserted ${upserted?.length ?? 0} row(s).`);

  // Verify data integrity by reading back test rows.
  console.log("Reading back test rows...");

  const { data: rows, error: readError } = await db
    .from("events")
    .select("id, title, category, latitude, longitude, published_at")
    .like("url", "https://seraphim.test/mock/%")
    .order("published_at", { ascending: false });

  if (readError) {
    console.error("SELECT failed:", readError.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.warn("SELECT returned 0 rows.");
    return;
  }

  console.log(`Found ${rows.length} row(s):\n`);
  rows.forEach((row) => {
    console.log(`  ${row.id}`);
    console.log(`  ${row.title}`);
    console.log(`  ${row.category}  ${row.latitude}, ${row.longitude}`);
    console.log(`  ${row.published_at}\n`);
  });

  console.log("Done. Database bridge is operational.");
}

run();

