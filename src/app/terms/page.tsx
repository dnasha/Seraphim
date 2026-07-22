import styles from './LegalPage.module.css';
import PublicPageHeader from '@/components/ui/PublicPageHeader';
import { createPageMetadata } from '@/lib/siteConfig';

const EFFECTIVE_DATE = 'July 17, 2026';
const POLICY_VERSION = '2026-07-17';

export const metadata = createPageMetadata({
  title: 'Terms of Service',
  description: 'Terms of Service for Seraphim.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
        <PublicPageHeader />

        <header className={styles.header}>
          <h1 className={styles.title}>Terms of Service</h1>
          <p className={styles.subtitle}>Effective: {EFFECTIVE_DATE} · Version {POLICY_VERSION}</p>
        </header>

        <main>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>1. Agreement and eligibility</h2>
            <p className={styles.text}>
              These Terms govern your access to the Seraphim website, hosted application, APIs, accounts, paid features, and related services (the “Service”). Seraphim operates from Washington, USA. By accessing or using the Service, creating an account, or purchasing access, you agree to these Terms and our <a href="/privacy" className={styles.link} title="Read the Privacy Policy">Privacy Policy</a>. If you do not agree, do not use the Service.
            </p>
            <p className={styles.text}>
              You must be at least 18 years old and legally able to enter a binding agreement. You represent that information you provide is accurate and that you are not barred from using the Service under applicable law.
            </p>

            <h2 className={styles.sectionTitle}>2. Service description</h2>
            <p className={styles.text}>
              Seraphim is an open-source intelligence news aggregator and interactive mapping tool. It algorithmically gathers, clusters, summarizes, geocodes, and displays public information from third-party sources. Headlines, excerpts, locations, classifications, credibility indicators, impact scores, and other outputs may be incomplete, delayed, duplicated, outdated, or wrong.
            </p>
            <p className={styles.text}>
              The Service is informational only. It is not emergency monitoring, professional intelligence, legal, financial, medical, security, or other professional advice. Do not rely on it as the sole basis for safety-critical, high-risk, legal, financial, emergency, military, law-enforcement, or other consequential decisions. Verify information with authoritative sources before acting.
            </p>

            <h2 className={styles.sectionTitle}>3. Accounts and security</h2>
            <p className={styles.text}>
              You are responsible for your credentials, devices, account activity, and keeping your contact information current. Do not share, sell, transfer, or permit unauthorized use of an account or paid entitlement. Notify <a href="mailto:support@seraphi.me" className={styles.link} title="Email Seraphim support">support@seraphi.me</a> promptly if you suspect unauthorized access. We may require reauthentication, apply rate limits, or suspend access to protect the Service or its users.
            </p>

            <h2 className={styles.sectionTitle}>4. Acceptable use</h2>
            <p className={styles.text}>
              You may not use the Service to violate law or third-party rights; facilitate violence, harassment, stalking, doxxing, unlawful surveillance, discrimination, or exploitation; evade sanctions or export controls; interfere with security or availability; probe or bypass access controls; introduce malicious code; scrape or automate access contrary to published limits; misrepresent Seraphim data as verified fact; or help another person do any of these things. You may not use the Service to make eligibility, employment, housing, credit, insurance, policing, or similar high-impact decisions about a person.
            </p>
            <p className={styles.text}>
              We may investigate suspected misuse and suspend or terminate access when reasonably necessary to protect users, third parties, or the Service, comply with law, or enforce these Terms.
            </p>

            <h2 className={styles.sectionTitle}>5. Open-source software and hosted service</h2>
            <p className={styles.text}>
              Source code expressly released under the GNU Affero General Public License Version 3 is governed by that license. The AGPL does not grant rights to Seraphim names, branding, accounts, hosted infrastructure, private credentials, third-party data, or paid hosted-service entitlements. Your use of the hosted Service remains governed by these Terms.
            </p>

            <h2 className={styles.sectionTitle}>6. Managed Payments and merchant of record</h2>
            <p className={styles.text}>
              Eligible transactions are sold through Link using Stripe Managed Payments. For those transactions, Link acts as merchant of record and handles payment processing, transaction-level support, applicable indirect-tax calculation and remittance, receipts, and order management. Seraphim provides the digital service and product support. Checkout may display additional Link or Stripe terms that also apply to the transaction.
            </p>
            <p className={styles.text}>
              Prices, available payment methods, currency conversion, and tax presentation can vary by location and Checkout eligibility. You authorize the merchant of record to charge the payment method you select. We do not guarantee that every offer or payment method is available in every location.
            </p>

            <h2 className={styles.sectionTitle}>7. Subscriptions, trials, and cancellation</h2>
            <p className={styles.text}>
              Pro and Analyst subscriptions may include a 14-day trial. Unless canceled before the trial or billing period ends, a subscription automatically renews at the price and interval shown at Checkout. You can manage eligible subscriptions through Link or the Seraphim billing portal. Cancellation normally takes effect at the end of the current paid period unless Checkout or the management interface expressly states otherwise. Plan changes, prorations, and effective dates are shown before confirmation.
            </p>

            <h2 className={styles.sectionTitle}>8. Refunds and payment disputes</h2>
            <p className={styles.text}>
              Refund availability is determined by the merchant of record, applicable law, and the circumstances of the transaction. Link may issue refunds at its discretion, including after a customer support request. Contact Link for transaction support or <a href="mailto:support@seraphi.me" className={styles.link} title="Email Seraphim support">support@seraphi.me</a> for product support.
            </p>
            <p className={styles.text}>
              <strong>Any successful refund of an Angel purchase, including a partial refund, permanently ends Angel lifetime access and the Angel Founder role.</strong> An open payment dispute temporarily suspends Angel access. Access is restored if the dispute is resolved in favor of the transaction and no refund occurred. A lost dispute permanently ends Angel access and releases the limited membership slot. Refunds and disputes do not restore a canceled subscription that was replaced by Angel.
            </p>

            <h2 className={styles.sectionTitle}>9. Angel lifetime access</h2>
            <p className={styles.text}>
              “Lifetime” means the operational lifetime of the hosted Seraphim Service, not your lifetime or a guaranteed period. Angel is a limited, personal, non-transferable, non-resalable entitlement to then-available Analyst-equivalent features, subject to these Terms. Features, integrations, community benefits, and the Service itself may change or end. The Discord role is fulfilled and adjusted manually and has no separate cash value.
            </p>

            <h2 className={styles.sectionTitle}>10. Third-party content and services</h2>
            <p className={styles.text}>
              Third-party publishers retain rights in their content. Links, maps, feeds, authentication providers, payment services, and other integrations are controlled by their respective providers and may have separate terms. Seraphim does not endorse, control, or guarantee third-party content or availability. You are responsible for reviewing source material and complying with third-party terms.
            </p>

            <h2 className={styles.sectionTitle}>11. Intellectual property and feedback</h2>
            <p className={styles.text}>
              Except for open-source code and third-party material, the Service’s design, branding, compilations, and non-public components are owned by or licensed to Seraphim. No implied license is granted. If you submit feedback, you grant Seraphim a worldwide, perpetual, irrevocable, royalty-free right to use it without restriction or compensation, without identifying you publicly.
            </p>

            <h2 className={styles.sectionTitle}>12. Copyright reports</h2>
            <p className={styles.text}>
              Send copyright complaints to <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a> with identification of the protected work, the allegedly infringing material and its location, your contact information, a good-faith statement, an accuracy-and-authority statement under penalty of perjury, and a physical or electronic signature. A counter-notice should identify removed material, state under penalty of perjury that removal resulted from mistake or misidentification, consent to appropriate court jurisdiction, and include contact information and a signature. We may forward notices to affected parties and terminate repeat infringers when appropriate. This procedure does not represent that Seraphim has registered a formal DMCA designated agent or qualifies for every statutory safe harbor.
            </p>

            <h2 className={styles.sectionTitle}>13. Changes, availability, and termination</h2>
            <p className={styles.text}>
              We may add, remove, restrict, suspend, or discontinue features or the Service; change limits; correct errors; and perform maintenance. We do not promise uninterrupted, secure, or error-free operation. You may stop using the Service at any time. We may suspend or terminate accounts for breach, risk, nonpayment, legal requirements, or protection of the Service. Provisions that by nature should survive termination—including payment, ownership, disclaimers, liability, indemnity, and dispute terms—will survive.
            </p>

            <h2 className={styles.sectionTitle}>14. Disclaimer of warranties</h2>
            <p className={styles.text}>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” SERAPHIM DISCLAIMS ALL EXPRESS, IMPLIED, AND STATUTORY WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, AVAILABILITY, SECURITY, AND ANY WARRANTY ARISING FROM COURSE OF DEALING OR USAGE OF TRADE. NO INFORMATION FROM SERAPHIM CREATES A WARRANTY NOT EXPRESSLY STATED HERE.
            </p>

            <h2 className={styles.sectionTitle}>15. Limitation of liability</h2>
            <p className={styles.text}>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, SERAPHIM AND ITS CONTRIBUTORS, LICENSORS, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, CONSEQUENTIAL, OR PUNITIVE DAMAGES; LOST PROFITS, REVENUE, DATA, GOODWILL, OR OPPORTUNITIES; SERVICE INTERRUPTION; OR RELIANCE ON CONTENT, EVEN IF ADVISED OF THE POSSIBILITY. THEIR TOTAL AGGREGATE LIABILITY ARISING FROM THE SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF US$100 OR THE AMOUNT YOU PAID FOR THE SERVICE DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM. These limits do not exclude liability that cannot lawfully be excluded or limited.
            </p>

            <h2 className={styles.sectionTitle}>16. Indemnification</h2>
            <p className={styles.text}>
              To the extent permitted by law, you will defend, indemnify, and hold harmless Seraphim and its contributors, licensors, and service providers from claims, damages, judgments, losses, and reasonable costs arising from your unlawful use, your content or data, your breach of these Terms, or your violation of another person’s rights. Seraphim may control the defense and settlement of an indemnified claim, and you will reasonably cooperate. This provision does not require a consumer to indemnify Seraphim for Seraphim’s own unlawful conduct.
            </p>

            <h2 className={styles.sectionTitle}>17. Dispute resolution and arbitration</h2>
            <p className={styles.text}>
              Before filing a claim, you and Seraphim agree to send a written description to <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a> and attempt in good faith to resolve it for 30 days. If unresolved, either party may require individual binding arbitration administered by the American Arbitration Association under its applicable Consumer Arbitration Rules. Arbitration may occur remotely unless the arbitrator requires otherwise. The Federal Arbitration Act governs this agreement to arbitrate.
            </p>
            <p className={styles.text}>
              Claims must be brought individually, not as a class, collective, coordinated, consolidated, or representative action, to the extent permitted by law. You and Seraphim waive trial by jury for arbitrable claims. Either party may use an eligible small-claims court or seek temporary injunctive relief for unauthorized access, security abuse, or intellectual-property misuse. You may opt out of arbitration by emailing <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a> within 30 days after first accepting these Terms, identifying your account email and clearly stating that you opt out. Opting out does not affect other Terms.
            </p>

            <h2 className={styles.sectionTitle}>18. Governing law and general terms</h2>
            <p className={styles.text}>
              Washington law governs these Terms, without regard to conflict-of-law rules, except where federal law or non-waivable consumer law applies. Non-arbitrable proceedings must be brought in a court of competent jurisdiction in Washington, USA, unless applicable law requires otherwise. Neither party is liable for delay caused by events beyond reasonable control. If a provision is unenforceable, it will be enforced to the maximum lawful extent and the remainder stays effective. Failure to enforce a provision is not a waiver. You may not assign these Terms without consent; Seraphim may assign them in connection with a reorganization, transfer, or sale. These Terms and incorporated policies are the entire agreement about the Service.
            </p>

            <h2 className={styles.sectionTitle}>19. Changes and contact</h2>
            <p className={styles.text}>
              We may update these Terms prospectively. Material changes will be identified by a new effective date and, when required, additional notice. Continued use after the effective date constitutes acceptance where permitted by law. Questions, legal notices, arbitration opt-outs, and copyright reports may be sent to <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a>. Product and billing questions may be sent to <a href="mailto:support@seraphi.me" className={styles.link} title="Email Seraphim support">support@seraphi.me</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
