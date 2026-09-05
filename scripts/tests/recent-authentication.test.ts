import { expect, it } from 'vitest';
import { hasRecentAuthentication } from '@/lib/security/recentAuthentication';

const now = Date.parse('2026-09-05T02:00:00Z');
const claims = { sub: 'user', session_id: 'session', amr: [{ method: 'otp', timestamp: now / 1000 - 30 }] };
it('requires interactive authentication for this verified user and session', () => {
  expect(hasRecentAuthentication(claims, 'user', now)).toBe(true);
  expect(hasRecentAuthentication(claims, 'another-user', now)).toBe(false);
  expect(hasRecentAuthentication({ ...claims, session_id: '' }, 'user', now)).toBe(false);
  expect(hasRecentAuthentication({ ...claims, amr: [{ method: 'token_refresh', timestamp: now / 1000 }] }, 'user', now)).toBe(false);
  expect(hasRecentAuthentication({ ...claims, amr: [{ method: 'otp', timestamp: now / 1000 - 601 }] }, 'user', now)).toBe(false);
  expect(hasRecentAuthentication({ ...claims, amr: [{ method: 'otp', timestamp: now / 1000 + 60 }] }, 'user', now)).toBe(false);
});
