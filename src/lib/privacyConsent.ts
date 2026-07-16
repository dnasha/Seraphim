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

export async function trackOptionalMetric(name: 'account_view' | 'checkout_click' | 'map_interaction') {
  if (getPrivacyConsent() !== 'accepted') return;
  await fetch('/api/telemetry', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => undefined);
}
