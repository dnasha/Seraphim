export type SourceOutcome =
  | 'healthy'
  | 'empty'
  | 'stale'
  | 'rate_limited'
  | 'provider_error'
  | 'parse_error'
  | 'disabled';

export interface SourceAttempt {
  source_name: string;
  source_type: string;
  poll_tier: string | null;
  outcome: SourceOutcome;
  fetched_count: number;
  accepted_count: number;
  rejected_count: number;
  latest_usable_item_at: string | null;
  duration_ms: number;
  error_code: string | null;
}

let active = false;
let attempts: SourceAttempt[] = [];

export function beginSourceHealthCollection() {
  attempts = [];
  active = true;
}

export function recordSourceAttempt(input: Omit<SourceAttempt, 'latest_usable_item_at'> & {
  latest_usable_item_at?: string | null;
}) {
  if (!active) return;
  attempts.push({ ...input, latest_usable_item_at: input.latest_usable_item_at ?? null });
}

export function completeSourceHealthCollection(): SourceAttempt[] {
  active = false;
  const completed = attempts;
  attempts = [];
  return completed;
}

export function latestItemAt(items: Array<{ publishedAt: string }>) {
  const latest = items.reduce((value, item) => {
    const timestamp = Date.parse(item.publishedAt);
    return Number.isFinite(timestamp) ? Math.max(value, timestamp) : value;
  }, 0);
  return latest > 0 ? new Date(latest).toISOString() : null;
}

export function safeSourceErrorCode(error: unknown): string {
  const structuredCode = error && typeof error === 'object' &&
    'sourceErrorCode' in error && typeof error.sourceErrorCode === 'string'
    ? error.sourceErrorCode
    : null;
  if (structuredCode) return structuredCode.slice(0, 64);
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout') || message.includes('aborted')) return 'timeout';
  if (message.includes('xml') || message.includes('parse')) return 'parse';
  const status = message.match(/(?:http|status(?: code)?|responded)\s*(\d{3})/)?.[1];
  return status ? `http_${status}` : 'provider_failure';
}
