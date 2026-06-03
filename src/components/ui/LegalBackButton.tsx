'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '@/app/terms/LegalPage.module.css';

function LegalBackButtonContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from');

  const handleBack = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (from === 'auth') {
      router.push('/?auth=true');
    } else if (from === 'help') {
      router.push('/help');
    } else if (from === 'account') {
      router.push('/account');
    } else if (from === 'guest') {
      router.push('/');
    } else {
      if (typeof window !== 'undefined' && window.history.length > 2) {
        router.back();
      } else {
        router.push('/');
      }
    }
  };

  const getLabel = () => {
    if (from === 'auth' || from === 'guest') return 'Back to Map';
    if (from === 'help') return 'Back to Help';
    if (from === 'account') return 'Back to Account';
    return 'Back';
  };

  return (
    <a href="#" onClick={handleBack} className={styles.backBtn}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      {getLabel()}
    </a>
  );
}

export default function LegalBackButton() {
  return (
    <Suspense fallback={
      <a href="#" className={styles.backBtn}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back
      </a>
    }>
      <LegalBackButtonContent />
    </Suspense>
  );
}
