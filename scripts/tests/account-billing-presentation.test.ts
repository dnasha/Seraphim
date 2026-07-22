import { describe, expect, it } from 'vitest';

import { getSubscriptionStatusLabel } from '@/app/account/billingPresentation';

describe('getSubscriptionStatusLabel', () => {
  it('does not present recurring subscription state for lifetime Angel access', () => {
    expect(getSubscriptionStatusLabel('angel', 'canceled')).toBeNull();
    expect(getSubscriptionStatusLabel('angel', 'active')).toBeNull();
  });

  it('presents meaningful recurring subscription states', () => {
    expect(getSubscriptionStatusLabel('pro', 'trialing')).toBe('Trial Active');
    expect(getSubscriptionStatusLabel('analyst', 'active')).toBe('active');
    expect(getSubscriptionStatusLabel('free', 'inactive')).toBeNull();
  });
});
