'use client';

import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { getPrivacyConsent, PRIVACY_CONSENT_EVENT } from '@/lib/privacyConsent';

export default function ConsentAwareAnalytics() {
  const [optionalMetricsEnabled, setOptionalMetricsEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setOptionalMetricsEnabled(getPrivacyConsent() === 'accepted');
    sync();
    window.addEventListener(PRIVACY_CONSENT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PRIVACY_CONSENT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return (
    <>
      <Analytics />
      {optionalMetricsEnabled ? <SpeedInsights /> : null}
    </>
  );
}
