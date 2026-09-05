import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { claimRecoveryJob } from '@/lib/server/recoveryJobs';
import { runRecoveryJob } from '@/lib/server/runRecoveryJob';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.BILLING_RECOVERY_TOKEN;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: 'Recovery unavailable' }, { status: 503 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Callers can only request the next due job, never inject a billing payload.
  // Stripe and Supabase credentials remain in this production environment.
  try {
    const job = await claimRecoveryJob();
    if (job) await runRecoveryJob(job);
    return NextResponse.json({
      processed: Boolean(job),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Recovery deferred' }, {
      status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
    });
  }
}
