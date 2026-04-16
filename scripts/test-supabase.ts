/*
Seraphim Supabase Bridge Test
Verifies read/write connectivity to the database using mock events.

Run: bun run scripts/test-supabase.ts
*/

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// prepare mock events for testing (uses URL as unique identifier)
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
      "Senior DoD officials held a closed briefing with congressional members regarding NATO\u2019s eastern flank reinforcement strategy amid ongoing tensions.",
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
  // Step 1: Write mock data
  console.log(`Connecting to ${SUPABASE_URL}`);
  console.log("Upserting 3 mock events...");

  const { data: upserted, error: writeError } = await supabase
    .from("events")
    .upsert(mockEvents, { onConflict: "url", ignoreDuplicates: false })
    .select();

  if (writeError) {
    console.error("INSERT failed:", writeError.message);
    process.exit(1);
  }

  console.log(`Upserted ${upserted?.length ?? 0} row(s).`);

  // Step 2: Read back and verify
  console.log("Reading back test rows...");

  const { data: rows, error: readError } = await supabase
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
