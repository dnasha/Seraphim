import type { DbEvent } from '@/types';
import type {
  ImageEnrichmentTarget,
  StoryMerge,
} from './merger';
import { fetchPageImageCandidate } from '@/lib/api/pageImages';
import { evaluateImageUpdate } from '@/lib/utils/merging';

export const ONLINE_PAGE_LOOKUP_LIMIT = 8;
export const ONLINE_IMAGE_PROBE_LIMIT = 10;
export const IMAGE_ENRICHMENT_CONCURRENCY = 3;
const IMAGE_LOOKUP_TIMEOUT_MS = 1500;

type NewEventTarget = {
  targetType: 'new';
  targetId: number;
  articleUrl: string;
  sourcePublishedAt: string;
  sourceTier: number;
  priority: 1;
  currentPublishedAt: string;
};

type EnrichmentTarget = ImageEnrichmentTarget | NewEventTarget;

export interface ImageEnrichmentStats {
  pageLookups: number;
  imageProbes: number;
  hits: number;
  fills: number;
  refreshes: number;
  failures: number;
  durationMs: number;
}

export interface ImageEnrichmentOptions {
  enabled?: boolean;
  pageLookupLimit?: number;
  concurrency?: number;
  lookup?: typeof fetchPageImageCandidate;
  now?: () => number;
}

function emptyStats(): ImageEnrichmentStats {
  return {
    pageLookups: 0,
    imageProbes: 0,
    hits: 0,
    fills: 0,
    refreshes: 0,
    failures: 0,
    durationMs: 0,
  };
}

export async function mapWithHostLimit<T, R>(
  items: T[],
  concurrency: number,
  hostFor: (item: T) => string,
  worker: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  const hostTails = new Map<string, Promise<void>>();
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        const item = items[index];
        const host = hostFor(item);
        const previous = hostTails.get(host) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => current);
        hostTails.set(host, tail);
        await previous;
        try {
          results[index] = await worker(item);
        } finally {
          release();
          if (hostTails.get(host) === tail) hostTails.delete(host);
        }
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function targetHost(target: EnrichmentTarget) {
  try {
    return new URL(target.articleUrl).hostname.toLowerCase();
  } catch {
    return `invalid:${target.articleUrl}`;
  }
}

function currentImageState(
  target: EnrichmentTarget,
  newEvents: DbEvent[],
  merges: Map<string, StoryMerge>,
) {
  if (target.targetType === 'new') {
    const event = newEvents[target.targetId];
    return {
      image_url: event.image_url,
      image_source_url: event.image_source_url,
      image_source_published_at: event.image_source_published_at,
      image_origin: event.image_origin,
      image_updated_at: event.image_updated_at,
      created_at: event.created_at,
      published_at: event.published_at,
    };
  }
  const merge = merges.get(target.targetId);
  return {
    image_url: merge?.image_url ?? target.currentImageUrl,
    image_source_published_at:
      merge?.image_source_published_at ?? target.currentImageSourcePublishedAt,
    image_updated_at: merge?.image_updated_at ?? target.currentImageUpdatedAt,
    created_at: target.currentCreatedAt,
    published_at: merge?.published_at ?? target.currentPublishedAt,
  };
}

function markChecked(
  target: EnrichmentTarget,
  checkedAt: string,
  newEvents: DbEvent[],
  merges: Map<string, StoryMerge>,
) {
  if (target.targetType === 'new') {
    newEvents[target.targetId].image_last_checked_at = checkedAt;
    return;
  }
  const merge = merges.get(target.targetId);
  if (merge) merge.image_last_checked_at = checkedAt;
}

function applyUpdate(
  target: EnrichmentTarget,
  update: NonNullable<ReturnType<typeof evaluateImageUpdate>>,
  checkedAt: string,
  newEvents: DbEvent[],
  merges: Map<string, StoryMerge>,
) {
  if (target.targetType === 'new') {
    Object.assign(newEvents[target.targetId], update, {
      image_last_checked_at: checkedAt,
    });
    return;
  }
  const merge = merges.get(target.targetId);
  if (merge) Object.assign(merge, update, { image_last_checked_at: checkedAt });
}

export async function enrichResolvedStoryImages(
  input: {
    newEvents: DbEvent[];
    merges: Map<string, StoryMerge>;
    imageTargets: ImageEnrichmentTarget[];
  },
  options: ImageEnrichmentOptions = {},
) {
  const enabled = options.enabled ??
    process.env.IMAGE_PAGE_ENRICHMENT_ENABLED === 'true';
  if (!enabled) return emptyStats();

  const startMs = Date.now();
  const now = options.now ?? Date.now;
  const lookup = options.lookup ?? fetchPageImageCandidate;
  const newTargets: NewEventTarget[] = input.newEvents
    .map((event, index): NewEventTarget | null => event.image_url ? null : {
      targetType: 'new',
      targetId: index,
      articleUrl: event.url,
      sourcePublishedAt: event.published_at,
      sourceTier: event.credibility_tier ?? 3,
      priority: 1,
      currentPublishedAt: event.published_at,
    })
    .filter((target): target is NewEventTarget => target !== null);

  const targets = [...input.imageTargets, ...newTargets]
    .sort((a, b) =>
      a.priority - b.priority ||
      new Date(b.sourcePublishedAt).getTime() - new Date(a.sourcePublishedAt).getTime() ||
      a.sourceTier - b.sourceTier
    )
    .slice(0, Math.min(
      options.pageLookupLimit ?? ONLINE_PAGE_LOOKUP_LIMIT,
      ONLINE_IMAGE_PROBE_LIMIT,
    ));

  const stats = emptyStats();
  stats.pageLookups = targets.length;
  stats.imageProbes = targets.length;

  const results = await mapWithHostLimit(
    targets,
    options.concurrency ?? IMAGE_ENRICHMENT_CONCURRENCY,
    targetHost,
    async (target) => {
      try {
        return await lookup({
          articleUrl: target.articleUrl,
          sourcePublishedAt: target.sourcePublishedAt,
          sourceTier: target.sourceTier,
        }, {
          timeoutMs: IMAGE_LOOKUP_TIMEOUT_MS,
          maxRedirects: 3,
        });
      } catch {
        return null;
      }
    },
  );

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const candidate = results[index];
    const checkedAt = new Date(now()).toISOString();
    if (!candidate) {
      stats.failures++;
      markChecked(target, checkedAt, input.newEvents, input.merges);
      continue;
    }

    const current = currentImageState(target, input.newEvents, input.merges);
    const update = evaluateImageUpdate(current, {
      image_url: candidate.url,
      image_source_url: candidate.sourceUrl,
      image_source_published_at: candidate.sourcePublishedAt,
      image_origin: candidate.origin,
      url: candidate.sourceUrl,
      published_at: candidate.sourcePublishedAt,
    }, now());
    if (!update) {
      markChecked(target, checkedAt, input.newEvents, input.merges);
      continue;
    }

    stats.hits++;
    if (current.image_url) stats.refreshes++;
    else stats.fills++;
    applyUpdate(target, update, checkedAt, input.newEvents, input.merges);
  }

  stats.durationMs = Date.now() - startMs;
  return stats;
}
