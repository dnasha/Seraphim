'use client';

import { openPrivacyChoices } from '@/lib/privacyConsent';

export default function PrivacyChoicesButton() {
  return (
    <button type="button" onClick={openPrivacyChoices} style={{ marginTop: 12 }}>
      Manage analytics preference
    </button>
  );
}
