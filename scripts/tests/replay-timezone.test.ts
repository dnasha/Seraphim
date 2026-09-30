import { afterEach, expect, it } from 'vitest';
import { replayInputTimestamp, replayLocalInput } from '@/lib/experiments/replay';
const previousTimezone = process.env.TZ;
afterEach(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
it('preserves unedited millisecond precision in fractional-offset timezones', () => {
    process.env.TZ = 'Asia/Kolkata';
    const instant = Date.parse('2026-09-30T12:00:01.234Z');
    expect(replayLocalInput(instant)).toBe('2026-09-30T17:30:01.234');
    expect(replayInputTimestamp(replayLocalInput(instant), instant)).toBe(instant);
    expect(replayInputTimestamp('2026-09-30T18:30', instant)).toBe(instant + 3_600_000 - 1234);
});
it('retains the second occurrence of an unedited DST-fold time', () => {
    process.env.TZ = 'America/New_York';
    const secondOccurrence = Date.parse('2026-11-01T01:30:00.000-05:00');
    expect(replayLocalInput(secondOccurrence)).toBe('2026-11-01T01:30:00.000');
    expect(replayInputTimestamp(replayLocalInput(secondOccurrence), secondOccurrence)).toBe(secondOccurrence);
});
it('rejects nonexistent DST-gap times and invalid calendar dates', () => {
    process.env.TZ = 'America/New_York';
    const original = Date.parse('2026-03-08T01:30:00-05:00');
    expect(replayInputTimestamp('2026-03-08T02:30', original)).toBeNull();
    expect(replayInputTimestamp('2026-02-30T12:00', original)).toBeNull();
    expect(replayInputTimestamp('bad', original)).toBeNull();
});
