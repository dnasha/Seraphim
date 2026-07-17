'use client';

import { openPrivacyChoices } from '@/lib/privacyConsent';

export default function PrivacyChoicesButton() {
  return (
    <button type="button" onClick={openPrivacyChoices} style={{ marginTop: 12 }} title="Review and change your analytics preference">
      Manage analytics preference
    </button>
  );
}
