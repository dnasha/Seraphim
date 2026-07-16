import { describe, expect, it } from 'vitest';

import { TIERS } from '@/app/pricing/pricingConstants';

describe('pricing configuration', () => {
  it('keeps the approved subscription prices and annual discount', () => {
    const pro = TIERS.find((tier) => tier.key === 'pro');
    const analyst = TIERS.find((tier) => tier.key === 'analyst');

    expect(pro).toMatchObject({ monthlyPrice: 9.99, yearlyPrice: 99.99, trialDays: 14 });
    expect(analyst).toMatchObject({ monthlyPrice: 29.99, yearlyPrice: 299.99, trialDays: 14 });
  });

  it('prices the limited Angel founder offer at $399', () => {
    expect(TIERS.find((tier) => tier.key === 'angel')).toMatchObject({
      isLifetime: true,
      lifetimePrice: 399,
    });
  });
});
