import { describe, expect, it } from 'vitest';
import { sourceCircuitKey } from '@/lib/api/sourceCircuit';
import { evaluateOpenSourceCircuits, type SourceCircuitAttempt } from '@/scraper/sourceCircuits';

const NOW = Date.parse('2026-08-13T22:00:00Z');

function attempt(
  createdAt: string,
  overrides: Partial<SourceCircuitAttempt> = {},
): SourceCircuitAttempt {
  return {
    source_name: 'Example',
    source_type: 'rss',
    outcome: 'provider_error',
    error_code: 'http_503',
    created_at: createdAt,
    ...overrides,
  };
}

describe('source circuit breaker', () => {
  it('opens after three consecutive classified failures and expires after cooldown', () => {
    const attempts = [
      attempt('2026-08-13T21:55:00Z'),
      attempt('2026-08-13T21:45:00Z'),
      attempt('2026-08-13T21:35:00Z'),
    ];
    expect(evaluateOpenSourceCircuits(attempts, NOW)).toContain(sourceCircuitKey('rss', 'Example'));
    expect(evaluateOpenSourceCircuits(attempts, NOW + 31 * 60 * 1000)).not.toContain(sourceCircuitKey('rss', 'Example'));
  });

  it('keeps a circuit closed after a success or for legacy unclassified failures', () => {
    const withSuccess = [
      attempt('2026-08-13T21:55:00Z', { outcome: 'healthy', error_code: null }),
      attempt('2026-08-13T21:45:00Z'),
      attempt('2026-08-13T21:35:00Z'),
      attempt('2026-08-13T21:25:00Z'),
    ];
    expect(evaluateOpenSourceCircuits(withSuccess, NOW)).not.toContain(sourceCircuitKey('rss', 'Example'));
    expect(evaluateOpenSourceCircuits(withSuccess.slice(1).map((row) => ({
      ...row,
      error_code: 'provider_failure',
    })), NOW)).not.toContain(sourceCircuitKey('rss', 'Example'));
  });

  it('applies a longer cooldown to rate limits', () => {
    const attempts = [5, 15, 25].map((minutesAgo) => attempt(
      new Date(NOW - minutesAgo * 60 * 1000).toISOString(),
      { source_type: 'reddit', outcome: 'rate_limited', error_code: 'http_429' },
    ));
    expect(evaluateOpenSourceCircuits(attempts, NOW + 40 * 60 * 1000))
      .toContain(sourceCircuitKey('reddit', 'Example'));
  });
});
