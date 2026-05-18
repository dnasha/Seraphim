import React from 'react';
import Link from 'next/link';
import styles from '../help/page.module.css';

export const metadata = {
  title: 'Terms of Service | Seraphim',
  description: 'Terms of Service for Seraphim.',
};

export default function TermsPage() {
  return (
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
        <Link href="/help" className={styles.backBtn}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Help
        </Link>

        <header className={styles.header}>
          <h1 className={styles.title}>Terms of Service</h1>
          <p className={styles.subtitle}>
            Last Updated: {new Date().toLocaleDateString()}
          </p>
        </header>

        <main>
          <section className={styles.section}>
            <p className={styles.text}>
              <strong>Note:</strong> This is a placeholder Terms of Service document. A proper, legally binding Terms of Service will be provided in the future.
            </p>
            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>1. Acceptance of Terms</h2>
            <p className={styles.text}>
              By accessing or using Seraphim, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
            </p>
            
            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>2. Use of Service</h2>
            <p className={styles.text}>
              Seraphim provides an OSINT news aggregation platform. You agree to use the service responsibly and not for any unlawful purposes. The data provided is aggregated from open sources, and we do not guarantee its absolute accuracy.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>3. Contact Us</h2>
            <p className={styles.text}>
              If you have any questions or concerns regarding these terms, please contact us at <a href="mailto:legal@seraphi.me" className={styles.link}>legal@seraphi.me</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
