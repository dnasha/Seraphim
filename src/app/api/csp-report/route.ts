import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { parseCspReport } from '@/lib/security/cspReport';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';
import { createLocalFixedWindowLimiter, createThrottledDiagnostic } from '@/lib/security/localRateLimit';
import { recordIncident, recordMetric, serverDiagnostic } from '@/lib/server/operations';

export const runtime = 'nodejs';

const MAX_REPORT_BYTES = 16_384;
const CLIENT_REPORTS_PER_MINUTE = 12;
const FINGERPRINT_SAMPLES_PER_WINDOW = 3;
const FINGERPRINT_SAMPLE_WINDOW_MINUTES = 10;
const GLOBAL_REPORTS_PER_MINUTE = 60;

const distributedRateLimitConfigured = process.env.NODE_ENV === 'test' || Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const redis = distributedRateLimitConfigured ? Redis.fromEnv() : null;
const clientRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(CLIENT_REPORTS_PER_MINUTE, '1 m'),
      analytics: false,
      prefix: '@upstash/ratelimit/seraphim-csp-client',
    })
  : null;
const fingerprintSampleLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(
        FINGERPRINT_SAMPLES_PER_WINDOW,
        `${FINGERPRINT_SAMPLE_WINDOW_MINUTES} m`,
      ),
      analytics: false,
      prefix: '@upstash/ratelimit/seraphim-csp-fingerprint',
    })
  : null;
const globalReportLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(GLOBAL_REPORTS_PER_MINUTE, '1 m'),
      analytics: false,
      prefix: '@upstash/ratelimit/seraphim-csp-global',
    })
  : null;

// These bounded per-instance gates keep malformed or repetitive traffic away
// from Redis and remain as a hard fallback if the distributed limiter fails.
const localClientLimit = createLocalFixedWindowLimiter({
  limit: CLIENT_REPORTS_PER_MINUTE,
  windowMs: 60_000,
  maxEntries: 5_000,
});
const localFingerprintSampleLimit = createLocalFixedWindowLimiter({
  limit: 1,
  windowMs: FINGERPRINT_SAMPLE_WINDOW_MINUTES * 60_000,
  maxEntries: 2_000,
});
const localGlobalReportLimit = createLocalFixedWindowLimiter({
  limit: GLOBAL_REPORTS_PER_MINUTE,
  windowMs: 60_000,
  maxEntries: 1,
});
const reportDistributedLimitUnavailable = createThrottledDiagnostic(() => {
  serverDiagnostic('csp_rate_limit_unavailable');
});

async function acceptIngress(clientIp: string) {
  const now = Date.now();
  if (!localClientLimit.check([clientIp], now).success) return false;
  if (!localGlobalReportLimit.check(['all'], now).success) return false;

  if (!clientRateLimit || !globalReportLimit) {
    reportDistributedLimitUnavailable(now);
    return true;
  }

  try {
    const results = await Promise.all([
      clientRateLimit.limit(clientIp),
      globalReportLimit.limit('all'),
    ]);
    return results.every(({ success }) => success);
  } catch {
    // Preserve a small amount of observability during a Redis outage. The
    // bounded local gates above still cap writes from this server instance.
    reportDistributedLimitUnavailable(now);
    return true;
  }
}

async function acceptFingerprint(fingerprint: string) {
  const now = Date.now();
  if (!localFingerprintSampleLimit.check([fingerprint], now).success) return false;
  if (!fingerprintSampleLimit) {
    reportDistributedLimitUnavailable(now);
    return true;
  }

  try {
    return (await fingerprintSampleLimit.limit(fingerprint)).success;
  } catch {
    reportDistributedLimitUnavailable(now);
    return true;
  }
}

async function readBoundedRequestText(request: Request, maxBytes: number) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  // Reporting is opt-in. The header is omitted while disabled, and this guard
  // also prevents stale tabs or manual requests from reaching Redis/Supabase.
  if (
    process.env.NODE_ENV === 'development'
    || process.env.CSP_REPORTING_ENABLED !== 'true'
  ) {
    return new NextResponse(null, { status: 204 });
  }

  const clientIp = getTrustedClientIp(request.headers);
  if (!clientIp) return new NextResponse(null, { status: 204 });

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/csp-report') {
    return new NextResponse(null, { status: 204 });
  }

  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  if (!await acceptIngress(clientIp)) return new NextResponse(null, { status: 204 });

  const raw = await readBoundedRequestText(request, MAX_REPORT_BYTES);
  if (raw === null) return new NextResponse(null, { status: 204 });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const report = parseCspReport(parsedBody);
  if (!report) return new NextResponse(null, { status: 204 });

  const fingerprint = `${report.effectiveDirective}:${report.blockedOrigin}`;
  if (!await acceptFingerprint(fingerprint)) {
    return new NextResponse(null, { status: 204 });
  }

  await Promise.all([
    recordMetric({
      kind: 'operational',
      service: 'web',
      name: `csp.${report.effectiveDirective}`,
    }),
    recordIncident({
      dedupKey: `web:csp:${report.effectiveDirective}:${report.blockedOrigin}`.slice(0, 500),
      service: 'web',
      type: 'csp_report_only_violation',
      severity: 'warning',
      safeContext: {
        effectiveDirective: report.effectiveDirective,
        blockedOrigin: report.blockedOrigin,
        sourceOrigin: report.sourceOrigin,
        sampled: true,
        sampleLimit: FINGERPRINT_SAMPLES_PER_WINDOW,
        sampleWindowMinutes: FINGERPRINT_SAMPLE_WINDOW_MINUTES,
      },
    }),
  ]);

  return new NextResponse(null, { status: 204 });
}
