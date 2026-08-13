import type { SupabaseClient } from '@supabase/supabase-js';
import { sourceCircuitKey } from '@/lib/api/sourceCircuit';

const REQUIRED_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const ATTEMPT_PAGE_SIZE = 1_000;
const MAX_ATTEMPT_PAGES = 3;

export type SourceCircuitAttempt = {
  source_name: string;
  source_type: string;
  outcome: string;
  error_code: string | null;
  created_at: string;
};

function circuitCooldownMs(errorCode: string | null) {
  if (!errorCode || errorCode === 'provider_failure') return 0;
  if (errorCode === 'http_429') return 60 * 60 * 1000;
  if (
    ['http_401', 'http_403', 'http_404', 'https_required', 'redirect_limit', 'redirect_missing'].includes(errorCode)
  ) {
    return 6 * 60 * 60 * 1000;
  }
  if (/^http_4\d\d$/.test(errorCode) || ['invalid_xml', 'content_type', 'byte_limit'].includes(errorCode)) {
    return 2 * 60 * 60 * 1000;
  }
  if (
    ['timeout', 'dns_failure', 'connect_failure', 'body_read_failure', 'body_unavailable', 'all_strategies_failed'].includes(errorCode) ||
    /^http_5\d\d$/.test(errorCode)
  ) {
    return 30 * 60 * 1000;
  }
  return 0;
}

function isFailedAttempt(attempt: SourceCircuitAttempt) {
  return ['rate_limited', 'provider_error', 'parse_error'].includes(attempt.outcome);
}

export function evaluateOpenSourceCircuits(
  attempts: readonly SourceCircuitAttempt[],
  now = Date.now(),
) {
  const recentBySource = new Map<string, SourceCircuitAttempt[]>();
  const ordered = [...attempts].sort((left, right) =>
    Date.parse(right.created_at) - Date.parse(left.created_at)
  );
  for (const attempt of ordered) {
    const key = sourceCircuitKey(attempt.source_type, attempt.source_name);
    const recent = recentBySource.get(key) ?? [];
    if (recent.length >= REQUIRED_CONSECUTIVE_FAILURES) continue;
    recent.push(attempt);
    recentBySource.set(key, recent);
  }

  const open = new Set<string>();
  for (const [key, recent] of recentBySource) {
    if (
      recent.length < REQUIRED_CONSECUTIVE_FAILURES ||
      !recent.every(isFailedAttempt)
    ) {
      continue;
    }
    const cooldownMs = Math.max(...recent.map((attempt) => circuitCooldownMs(attempt.error_code)));
    const latestAttemptMs = Date.parse(recent[0].created_at);
    if (cooldownMs > 0 && Number.isFinite(latestAttemptMs) && latestAttemptMs + cooldownMs > now) {
      open.add(key);
    }
  }
  return open;
}

export async function loadOpenSourceCircuits(db: SupabaseClient, now = Date.now()) {
  const attempts: SourceCircuitAttempt[] = [];
  const cutoff = new Date(now - CIRCUIT_LOOKBACK_MS).toISOString();
  for (let page = 0; page < MAX_ATTEMPT_PAGES; page++) {
    const from = page * ATTEMPT_PAGE_SIZE;
    const { data, error } = await db
      .from('ingestion_source_attempts')
      .select('source_name, source_type, outcome, error_code, created_at')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .range(from, from + ATTEMPT_PAGE_SIZE - 1);
    if (error) {
      console.warn(`[polling] Unable to load source circuit history: ${error.message}`);
      return new Set<string>();
    }
    const pageRows = (data ?? []) as SourceCircuitAttempt[];
    attempts.push(...pageRows);
    if (pageRows.length < ATTEMPT_PAGE_SIZE) break;
  }
  return evaluateOpenSourceCircuits(attempts, now);
}
