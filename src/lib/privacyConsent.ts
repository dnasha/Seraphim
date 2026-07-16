export const PRIVACY_CONSENT_KEY = 'seraphim_cookie_consent';
export const PRIVACY_CONSENT_EVENT = 'seraphim:privacy-consent';
export type PrivacyConsent = 'accepted' | 'essential' | null;

export function getPrivacyConsent(): PrivacyConsent {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(PRIVACY_CONSENT_KEY);
  return value === 'accepted' || value === 'essential' ? value : null;
}

export function setPrivacyConsent(value: Exclude<PrivacyConsent, null>) {
  window.localStorage.setItem(PRIVACY_CONSENT_KEY, value);
  window.dispatchEvent(new CustomEvent(PRIVACY_CONSENT_EVENT, { detail: value }));
}

export function openPrivacyChoices() {
  window.dispatchEvent(new Event(`${PRIVACY_CONSENT_EVENT}:open`));
}

export type OptionalMetricName = 'account_view' | 'pricing_view' | 'checkout_click' | 'activation' | 'map_interaction';
export interface OptionalMetricDimensions {
  plan?: 'pro' | 'analyst' | 'angel';
  interval?: 'month' | 'year' | 'lifetime';
  source?: 'direct' | 'pricing' | 'feature_gate';
  milestone?: 'historical_monitoring' | 'custom_window';
}

export async function trackOptionalMetric(name: OptionalMetricName, dimensions: OptionalMetricDimensions = {}) {
  if (getPrivacyConsent() !== 'accepted') return;
  await fetch('/api/telemetry', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...dimensions }),
  }).catch(() => undefined);
}
