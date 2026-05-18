import React from 'react';
import Link from 'next/link';
import styles from './LegalPage.module.css';

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
            <h2 className={styles.sectionTitle}>1. Acceptance of Terms</h2>
            <p className={styles.text}>
              By accessing, browsing, or using the Seraphim platform and its associated services, you agree to be bound by these Terms of Service. If you do not agree to all of the terms and conditions stated herein, you must not access or use our services.
            </p>
            
            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>2. Description of Service</h2>
            <p className={styles.text}>
              Seraphim operates as a real-time Open-Source Intelligence (OSINT) news aggregator and interactive mapping tool. The platform algorithmically collects, processes, geocodes, and displays publicly available information and headlines from various third-party sources. We do not author or verify the accuracy of the underlying news content.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>3. Open Source Licensing</h2>
            <p className={styles.text}>
              The underlying software code for Seraphim is licensed under the GNU Affero General Public License Version 3 (AGPL-3.0). While you are free to view, modify, and distribute the source code in accordance with the AGPL-3.0, your use of our hosted service and proprietary APIs remains subject to these Terms of Service.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>4. User Accounts and Security</h2>
            <p className={styles.text}>
              To access certain features of Seraphim, you may be required to create an account. You are solely responsible for safeguarding your account credentials and for all activities that occur under your account. We employ Cloudflare Turnstile and other automated security measures to prevent abuse and bot activity. You agree not to bypass or interfere with these security mechanisms.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>5. Subscription and Payments</h2>
            <p className={styles.text}>
              Seraphim offers premium tiers with expanded access limits. Payment processing is securely handled by Stripe. By subscribing, you authorize us to charge your selected payment method for the recurring subscription fees. Subscriptions automatically renew unless canceled prior to the renewal date. All payments are non-refundable except as required by applicable law. Any billing issues or payment inquiries may be directed to <a href="mailto:support@seraphi.me" className={styles.link}>support@seraphi.me</a>.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>6. Fair Use Policy</h2>
            <p className={styles.text}>
              Seraphim enforces rate limits and usage quotas to ensure platform stability. Guest users are limited to a specific number of historical events. You agree not to engage in abusive scraping, reverse engineering of our private APIs, or excessive automated requests that degrade the experience for other users. Violations of this Fair Use Policy may result in immediate suspension of your access.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>7. Intellectual Property and Content</h2>
            <p className={styles.text}>
              The news headlines and excerpts displayed on Seraphim remain the intellectual property of their respective original publishers. We aggregate this data strictly under the principles of Fair Use under United States copyright law for informational, analytical, and research purposes. If you believe that any content aggregated on our platform infringes upon your copyright and falls outside the scope of Fair Use, please direct all Digital Millennium Copyright Act (DMCA) notices and legal inquiries to <a href="mailto:legal@seraphi.me" className={styles.link}>legal@seraphi.me</a>.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>8. Disclaimers</h2>
            <p className={styles.text}>
              The information provided by Seraphim is aggregated and geocoded via automated Natural Language Processing algorithms. We do not guarantee the accuracy, completeness, timeliness, or reliability of any data, location, or event displayed on the map. You should not take action, make decisions, or rely solely upon the information, mappings, or trends provided by Seraphim, as they may be inherently inaccurate or incomplete. THE SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>9. Limitation of Liability</h2>
            <p className={styles.text}>
              To the maximum extent permitted by applicable law, Seraphim shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from your access to or use of, or inability to access or use, the services.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>10. Indemnification</h2>
            <p className={styles.text}>
              You agree to indemnify, defend, and hold harmless Seraphim and its affiliates, officers, directors, and employees from any claims, liabilities, damages, losses, and expenses, including reasonable legal fees, arising out of or in any way connected with your access to or use of the service or your violation of these Terms.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>11. Modifications to Terms</h2>
            <p className={styles.text}>
              We reserve the right to modify these Terms of Service at any time. We will provide notice of significant changes by updating the date at the top of this page or through other appropriate communication channels. Your continued use of the service after such modifications constitutes your acceptance of the revised terms.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>12. Governing Law</h2>
            <p className={styles.text}>
              These Terms shall be governed by and construed in accordance with the laws of the State of Washington, United States, without regard to its conflict of law provisions. Any legal action or proceeding related to your access to or use of the services shall be instituted exclusively in a state or federal court located in Washington.
            </p>

            <h2 className={styles.sectionTitle} style={{ marginTop: '32px' }}>13. Contact Information</h2>
            <p className={styles.text}>
              If you have any questions, concerns, or legal inquiries regarding these Terms of Service, please contact us at <a href="mailto:legal@seraphi.me" className={styles.link}>legal@seraphi.me</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
