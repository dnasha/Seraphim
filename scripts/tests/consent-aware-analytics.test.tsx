// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConsentAwareAnalytics from '@/components/ui/ConsentAwareAnalytics';
import {
  PRIVACY_CONSENT_KEY,
  setPrivacyConsent,
} from '@/lib/privacyConsent';

vi.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div data-testid="vercel-analytics" />,
}));

vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

describe('ConsentAwareAnalytics', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('always mounts Vercel Web Analytics without prior consent', () => {
    render(<ConsentAwareAnalytics />);

    expect(screen.getByTestId('vercel-analytics')).toBeTruthy();
    expect(screen.queryByTestId('speed-insights')).toBeNull();
  });

  it('mounts Speed Insights only when optional metrics are accepted', async () => {
    window.localStorage.setItem(PRIVACY_CONSENT_KEY, 'accepted');
    render(<ConsentAwareAnalytics />);

    await waitFor(() => {
      expect(screen.getByTestId('speed-insights')).toBeTruthy();
    });
  });

  it('enables Speed Insights when consent changes without affecting Web Analytics', async () => {
    render(<ConsentAwareAnalytics />);

    setPrivacyConsent('accepted');

    await waitFor(() => {
      expect(screen.getByTestId('speed-insights')).toBeTruthy();
    });
    expect(screen.getByTestId('vercel-analytics')).toBeTruthy();
  });
});
