/**
 * Purpose: Measures and reports response latency for all configured RSS sources to identify slow or failing endpoints.
 * Usage: bun run scripts/diagnostics/audit-latency.ts
 */

import { RSS_SOURCES } from "@/data/sources";
import { fetchSingleFeed } from "@/lib/api/rss";

async function runAudit() {
    console.log("Starting Latency Audit for all 117+ RSS sources...");
    const results: { name: string; latency: number; status: string }[] = [];

    // Execute requests in parallel to minimize overall audit duration while capturing individual latency metrics.
    const tasks = RSS_SOURCES.map(async (source) => {
        const start = performance.now();
        let status = "Success";
        try {
            const items = await fetchSingleFeed(source);
            if (items.length === 0) status = "No Items / Fail";
        } catch (error) {
            status = "Error";
            console.error(`Error fetching ${source.name}:`, error);
        }
        const end = performance.now();
        results.push({ name: source.name, latency: end - start, status });
    });

    await Promise.allSettled(tasks);

    // Sorting results allows for quick identification of sources causing bottleneck issues in the ingestion pipeline.
    results.sort((a, b) => b.latency - a.latency);

    console.log("\n--- LATENCY REPORT (Slowest First) ---");
    results.forEach((r, i) => {
        const color = r.latency > 15000 ? "❌" : r.latency > 10000 ? "🔴" : r.latency > 5000 ? "🟡" : "🟢";
        console.log(`${(i + 1).toString().padStart(3)}. ${color} ${r.name.padEnd(30)} : ${(r.latency / 1000).toFixed(2)}s [${r.status}]`);
    });
}

runAudit().catch(console.error);
