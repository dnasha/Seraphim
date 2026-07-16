import { describe, expect, it, vi } from 'vitest';
import { createOverlayHealthRecorder, type OverlayHealthStore } from '@/lib/server/overlayHealth';

class MemoryHealthStore implements OverlayHealthStore {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return (this.values.get(key) as T | undefined) ?? null; }
  async set(key: string, value: unknown, options?: { nx?: boolean }) {
    if (options?.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }
  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys) if (this.values.delete(key)) deleted += 1;
    return deleted;
  }
}

describe('overlay health recorder', () => {
  it('records one global failure per cooldown and one recovery transition', async () => {
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const recordRecovery = vi.fn().mockResolvedValue(undefined);
    const recorder = createOverlayHealthRecorder({
      store: new MemoryHealthStore(),
      recordFailure,
      recordRecovery,
    });

    await Promise.all([
      recorder.markFailure('iss', 'timeout'),
      recorder.markFailure('iss', 'timeout'),
      recorder.markFailure('iss', 'http_503'),
    ]);
    expect(recordFailure).toHaveBeenCalledOnce();

    await Promise.all([
      recorder.markHealthy('iss'),
      recorder.markHealthy('iss'),
    ]);
    expect(recordRecovery).toHaveBeenCalledOnce();
  });
});
