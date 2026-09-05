import { expect, it, vi } from 'vitest';
import { readRecentEventPages } from '@/scraper/recentEvents';

it('reads beyond the PostgREST cap with a stable order', async () => {
  const first = Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }));
  const query = {
    select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: [{ id: 'last' }], error: null }),
  };
  const result = await readRecentEventPages({ from: () => query } as never, 'id', '2026-01-01');
  expect(result).toHaveLength(1001);
  expect(result.at(-1)?.id).toBe('last');
  expect(query.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
});

it('does not return a silently incomplete result when a later page fails', async () => {
  const query = {
    select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => ({ id: 'row' })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'timeout' } }),
  };
  await expect(readRecentEventPages({ from: () => query } as never, 'id', '2026-01-01', true)).rejects.toThrow('timeout');
});
