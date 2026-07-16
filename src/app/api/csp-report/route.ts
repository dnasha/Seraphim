import { NextRequest, NextResponse } from 'next/server';

import { parseCspReport } from '@/lib/security/cspReport';
import { getTrustedClientIp } from '@/lib/security/clientIdentity';
import { recordIncident, recordMetric } from '@/lib/server/operations';

export const runtime = 'nodejs';

const MAX_REPORT_BYTES = 16_384;
const localBuckets = new Map<string, { count: number; resetAt: number }>();

function acceptReport(request: NextRequest) {
  const key = getTrustedClientIp(request.headers) ?? (process.env.NODE_ENV === 'development' ? 'local' : null);
  if (!key) return false;
  const now = Date.now();
  const bucket = localBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    localBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 30;
}

export async function POST(request: NextRequest) {
  if (!acceptReport(request)) return new NextResponse(null, { status: 204 });

  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  const raw = await request.text();
  if (raw.length > MAX_REPORT_BYTES) return new NextResponse(null, { status: 204 });

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const report = parseCspReport(parsedBody);
  if (!report) return new NextResponse(null, { status: 204 });

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
      },
    }),
  ]);

  return new NextResponse(null, { status: 204 });
}
