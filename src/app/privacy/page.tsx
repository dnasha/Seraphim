import React from 'react';
import Link from 'next/link';
import styles from '../help/page.module.css';

export const metadata = {
  title: 'Privacy Policy | Seraphim',
  description: 'Privacy Policy for Seraphim.',
};

export default function PrivacyPage() {
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
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.subtitle}>
            Last Updated: {new Date().toLocaleDateString()}
          </p>
        </header>

        <main>
          <section className={styles.section}>
            <p className={styles.text}>
              <strong>Note:</strong> This is a placeholder Privacy Policy document. A proper, legally binding Privacy Policy will be provided in the future.
            </p>
            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>1. Information We Collect</h2>
            <p className={styles.text}>
              We collect basic analytics and account information to provide and improve our services. We prioritize your privacy and aim to collect only what is necessary for the platform to function effectively.
            </p>
            
            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>2. How We Use Information</h2>
            <p className={styles.text}>
              Information is used solely to maintain your account, process payments (via our secure payment provider), and enhance the OSINT map experience. We do not sell your personal data to third parties.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>3. Contact Us</h2>
            <p className={styles.text}>
              If you have any questions or concerns regarding your privacy, please contact us at <a href="mailto:legal@seraphi.me" className={styles.link}>legal@seraphi.me</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
