/*
  Resumable seven-day image repair. Safe default is a dry run:

    bun run scripts/maintenance/backfill-event-images.ts
    bun run scripts/maintenance/backfill-event-images.ts --apply
    bun run scripts/maintenance/backfill-event-images.ts --event-id=<uuid> --apply
    bun run scripts/maintenance/backfill-event-images.ts --days=7 --limit=250 --apply
*/

import { supabaseAdmin } from '@/lib/core/supabase-admin';
import {
  DEFAULT_IMAGE_BACKFILL_DAYS,
  DEFAULT_IMAGE_BACKFILL_LIMIT,
  runImageBackfill,
} from '@/scraper/imageBackfill';

export function parseImageBackfillArgs(argv = process.argv.slice(2)) {
  const value = (name: string) => {
    const prefix = `--${name}=`;
    return argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
  };
  return {
    days: Number(value('days') ?? DEFAULT_IMAGE_BACKFILL_DAYS),
    limit: Number(value('limit') ?? DEFAULT_IMAGE_BACKFILL_LIMIT),
    eventId: value('event-id') || undefined,
    apply: argv.includes('--apply'),
  };
}

async function main() {
  const options = parseImageBackfillArgs();
  const result = await runImageBackfill(supabaseAdmin, options);
  console.log(
    `[image-backfill] days=${result.days} selected=${result.selected} ` +
    `hits=${result.hits} misses=${result.misses} written=${result.written} ` +
    `dry_run=${result.dryRun}`,
  );
  if (result.dryRun && result.hits > 0) {
    for (const update of result.updates.filter((entry) => entry.image_url).slice(0, 10)) {
      console.log(`  ${update.id}: ${update.image_url}`);
    }
  }
}

main().catch((error) => {
  console.error('[image-backfill] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
