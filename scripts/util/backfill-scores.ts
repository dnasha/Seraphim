import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing environment variables. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Utility to backfill event_count and impact_score for all historical events.
 * Processes in batches to avoid Supabase/PostgREST timeouts.
 */
async function backfillScores() {
  console.log(`[backfill] Starting score backfill... (DRY_RUN=${DRY_RUN})`);

  const startTime = Date.now();

  // Step 1: Get total count
  const { count: totalEvents, error: countErr } = await supabase
    .from("events")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    console.error("[backfill] Failed to fetch total count:", countErr.message);
    process.exit(1);
  }

  console.log(
    `[backfill] Total events to process: ${totalEvents?.toLocaleString()}`,
  );

  let totalProcessed = 0;
  let lastId = "00000000-0000-0000-0000-000000000000"; // Start from beginning

  while (true) {
    const { data: events, error: fetchError } = await supabase
      .from("events")
      .select("id, sources, credibility_tier")
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(500);

    if (fetchError) {
      console.error("[backfill] Fetch error:", fetchError.message);
      break;
    }

    if (!events || events.length === 0) {
      console.log("[backfill] Reached the end of the database.");
      break;
    }

    const updates = events.map((event) => {
      const sources = event.sources || [];
      const event_count = Math.max(sources.length, 1);

      // Heuristic: sum of (3.5 - credibility_tier)
      // If sources don't have tiers, we use the master event's tier as a fallback for all sources
      const masterTier = event.credibility_tier || 3;
      const impact_score = event_count * (5.0 - masterTier);

      return {
        id: event.id,
        event_count,
        impact_score,
      };
    });

    if (!DRY_RUN) {
      // Apply updates in smaller chunks of 50 to avoid request body size limits
      const CHUNK_SIZE = 50;
      for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        const chunk = updates.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map((u) =>
          supabase
            .from("events")
            .update({
              event_count: u.event_count,
              impact_score: u.impact_score,
            })
            .eq("id", u.id),
        );
        await Promise.all(promises);
      }
    }

    totalProcessed += events.length;
    lastId = events[events.length - 1].id;

    const progress = ((totalProcessed / (totalEvents || 1)) * 100).toFixed(2);
    const elapsedSec = (Date.now() - startTime) / 1000;
    const itemsPerSec = (totalProcessed / elapsedSec).toFixed(1);

    console.log(
      `[backfill] Progress: ${progress}% | Processed: ${totalProcessed.toLocaleString()} | Speed: ${itemsPerSec} items/s`,
    );
  }

  const totalTimeMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(
    `\n[backfill] COMPLETED in ${totalTimeMin}m. Total processed: ${totalProcessed.toLocaleString()}`,
  );
}

backfillScores().catch((err) => {
  console.error("[backfill] Unhandled error:", err);
  process.exit(1);
});
