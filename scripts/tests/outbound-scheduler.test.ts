import { describe, expect, it } from 'vitest';
import { OutboundScheduler } from '@/lib/api/outboundScheduler';

describe('outbound source scheduler', () => {
  it('enforces global and per-host concurrency across queued source groups', async () => {
    const scheduler = new OutboundScheduler(2, 1);
    let globalActive = 0;
    let maxGlobalActive = 0;
    const hostActive = new Map<string, number>();
    const maxHostActive = new Map<string, number>();
    const run = (host: string) => scheduler.run(host, async () => {
      globalActive += 1;
      maxGlobalActive = Math.max(maxGlobalActive, globalActive);
      const active = (hostActive.get(host) ?? 0) + 1;
      hostActive.set(host, active);
      maxHostActive.set(host, Math.max(maxHostActive.get(host) ?? 0, active));
      await new Promise((resolve) => setTimeout(resolve, 5));
      hostActive.set(host, active - 1);
      globalActive -= 1;
      return host;
    });

    await Promise.all([
      run('a.example'), run('a.example'), run('a.example'),
      run('b.example'), run('b.example'), run('c.example'),
    ]);
    expect(maxGlobalActive).toBeLessThanOrEqual(2);
    expect([...maxHostActive.values()].every((active) => active <= 1)).toBe(true);
  });
});
