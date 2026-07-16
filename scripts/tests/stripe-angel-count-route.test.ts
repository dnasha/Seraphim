import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enabled: true, from: vi.fn(), retrieve: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/stripe', () => ({
  ANGEL_MAX_QUANTITY: 100,
  STRIPE_PRICES: { angel: 'price_angel' },
  stripe: { prices: { retrieve: mocks.retrieve } },
}));
vi.mock('@/lib/security/payments', () => ({ isAngelCheckoutEnabled: () => mocks.enabled }));

import { GET } from '@/app/api/stripe/angel-count/route';

function countQuery(count: number) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(async () => ({ count }));
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ count }).then(resolve);
  return query;
}

describe('GET /api/stripe/angel-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.retrieve.mockResolvedValue({ product: { metadata: { inventory: '80' } } });
    mocks.from.mockImplementation((table: string) => countQuery(table === 'angel_purchases' ? 12 : 3));
  });

  it('does not expose inventory while Angel checkout is disabled', async () => {
    mocks.enabled = false;
    expect((await GET()).status).toBe(503);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('subtracts paid ownership and active reservations atomically bounded by Stripe metadata', async () => {
    expect(await (await GET()).json()).toEqual({ remaining: 65, total: 80 });
    expect(mocks.from).toHaveBeenCalledWith('billing_checkout_intents');
  });
});
