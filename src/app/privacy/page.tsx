import styles from '../terms/LegalPage.module.css';
import LegalBackButton from '@/components/ui/LegalBackButton';
import PrivacyChoicesButton from '@/components/ui/PrivacyChoicesButton';
import { createPageMetadata } from '@/lib/siteConfig';

export const metadata = createPageMetadata({
  title: 'Privacy Policy',
  description: 'Privacy Policy for Seraphim.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
        <LegalBackButton />

        <header className={styles.header}>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.subtitle}>
            Last Updated: {new Date().toLocaleDateString()}
          </p>
        </header>

        <main>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>1. Introduction and Scope</h2>
            <p className={styles.text}>
              Seraphim is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website and use our OSINT mapping service. By using the service, you consent to the data practices described in this policy.
            </p>
            
            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>2. Information We Collect</h2>
            <p className={styles.text}>
              We collect information that you provide directly to us when you create an account, such as your email address and authentication credentials (securely managed via Supabase). If you subscribe to a premium tier, our payment processor (Stripe) collects necessary billing information. We do not store full credit card numbers on our servers. Additionally, we automatically collect basic usage data, such as IP addresses and device identifiers, to ensure the platform functions correctly and securely.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>3. How We Use Your Information</h2>
            <p className={styles.text}>
              The information we collect is used solely to provide, maintain, and improve the Seraphim experience. This includes authenticating your access, processing transactions, maintaining your geographical map view state, and protecting the platform against bots and abusive scraping via Cloudflare Turnstile.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>4. Information Sharing and Disclosure</h2>
            <p className={styles.text}>
              <strong>We do not sell your personal data to third parties under any circumstances.</strong> We only share your information with trusted service providers (such as Stripe for payments and Supabase for database hosting) strictly to the extent necessary to operate the service. We may also disclose information if required to do so by law or in response to valid requests by public authorities.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>5. Cookies and Tracking Technologies</h2>
            <p className={styles.text}>
              Seraphim uses essential cookies that are necessary for the platform to function, such as maintaining your session. We may also use optional analytics cookies to help us understand how users interact with the map, which you can control via our cookie consent banner. We respect your preferences and comply with standard consent frameworks.
            </p>
            <PrivacyChoicesButton />

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>6. Data Security</h2>
            <p className={styles.text}>
              We implement industry-standard security measures to protect your personal information from unauthorized access, alteration, disclosure, or destruction. This includes secure transmission protocols, encrypted database storage, and active bot mitigation. However, no internet transmission is entirely secure, and we cannot guarantee absolute security.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>7. Data Retention</h2>
            <p className={styles.text}>
              We retain your personal information only for as long as necessary to fulfill the purposes outlined in this Privacy Policy. When you request the deletion of your account, all associated personal data is deleted immediately from our active databases, except where retention is strictly required to comply with our legal or financial obligations.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>8. User Rights</h2>
            <p className={styles.text}>
              Depending on your jurisdiction, such as under the General Data Protection Regulation (GDPR) or the California Consumer Privacy Act (CCPA), you may have the right to access, correct, delete, or restrict the processing of your personal data. You may exercise these rights at any time by contacting us directly.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>9. International Data Transfers</h2>
            <p className={styles.text}>
              Your information may be transferred to and maintained on servers located outside of your state, province, country, or other governmental jurisdiction where the data protection laws may differ. By using the service, you consent to these transfers.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>10. Changes to This Policy</h2>
            <p className={styles.text}>
              We may update our Privacy Policy periodically. We will notify you of any material changes by posting the new Privacy Policy on this page and updating the &quot;Last Updated&quot; date. You are advised to review this Privacy Policy periodically for any changes.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>11. Contact Information</h2>
            <p className={styles.text}>
              If you have any questions, concerns, or requests regarding this Privacy Policy or your data, please contact us at <a href="mailto:legal@seraphi.me" className={styles.link} title="Email the Seraphim privacy contact">legal@seraphi.me</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
