import styles from '../terms/LegalPage.module.css';
import LegalBackButton from '@/components/ui/LegalBackButton';
import PrivacyChoicesButton from '@/components/ui/PrivacyChoicesButton';
import { createPageMetadata } from '@/lib/siteConfig';

const EFFECTIVE_DATE = 'July 17, 2026';
const POLICY_VERSION = '2026-07-17';

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
          <p className={styles.subtitle}>Effective: {EFFECTIVE_DATE} · Version {POLICY_VERSION}</p>
        </header>

        <main>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>1. Scope and contact</h2>
            <p className={styles.text}>
              This Policy explains how Seraphim, operating from Washington, USA, handles personal information through the Seraphim website, hosted application, accounts, paid features, support, and related services. It does not govern third-party websites or services that publish their own policies. Questions and privacy requests may be sent to <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a>.
            </p>

            <h2 className={styles.sectionTitle}>2. Information we collect</h2>
            <p className={styles.text}>
              <strong>Account and identity information.</strong> We process your email address, internal user ID, authentication status, and profile information supplied by enabled sign-in providers such as Google, GitHub, or Discord. Password credentials are handled by Supabase Auth rather than stored directly by Seraphim.
            </p>
            <p className={styles.text}>
              <strong>Payment and entitlement information.</strong> We process Stripe Customer, Checkout, Price, PaymentIntent, Subscription, Invoice, refund, and dispute identifiers; plan, interval, status, trial and renewal dates; Angel purchase and inventory state; and operational correlation identifiers. Stripe and Link collect payment credentials, billing details, tax location, and transaction information. Seraphim does not store full card numbers.
            </p>
            <p className={styles.text}>
              <strong>Preferences and local content.</strong> We store account map preferences such as filters, theme, map style, overlays, and time range. Browser-local storage can contain consent choice, guest state, interface settings, cached entitlement display, map drawings, and imported GeoJSON. Imported GeoJSON and drawing content are processed locally in your browser and are not intentionally uploaded to Seraphim by those features.
            </p>
            <p className={styles.text}>
              <strong>Support and legal communications.</strong> We receive the information you include when emailing support, feedback, legal, privacy, copyright, refund, or dispute inquiries.
            </p>
            <p className={styles.text}>
              <strong>Technical, security, and usage information.</strong> Servers and infrastructure providers can process IP address, request time, requested URL, browser or device information, authentication cookies, rate-limit keys, security events, error information, and aggregated operational metrics. If you allow optional analytics, we also process limited page, feature, plan, interval, and interaction events. Seraphim does not request your device’s precise geolocation.
            </p>

            <h2 className={styles.sectionTitle}>3. Sources of information</h2>
            <p className={styles.text}>
              We obtain information from you, your browser or device, your use of the Service, enabled authentication providers, Stripe and Link, support communications, and service providers that protect or operate the Service. Public news and event data displayed on the map concerns reported events and sources; it is not collected to build profiles of Seraphim users.
            </p>

            <h2 className={styles.sectionTitle}>4. Why we use information</h2>
            <p className={styles.text}>
              We use information to create and secure accounts; authenticate users; provide, personalize, and synchronize features; create Checkout and billing-portal sessions; fulfill and revoke entitlements; manage trials, subscriptions, refunds, disputes, Angel inventory, and account deletion; provide support; prevent abuse and fraud; enforce our Terms; measure aggregate reliability and conversion; comply with law; and establish, exercise, or defend legal claims.
            </p>
            <p className={styles.text}>
              Where laws require a legal basis, processing is based on performing our contract with you, legitimate interests in operating and securing the Service, compliance with legal obligations, protection of vital or legal interests where applicable, and consent for optional analytics. You may withdraw analytics consent without affecting prior lawful processing.
            </p>

            <h2 className={styles.sectionTitle}>5. How we disclose information</h2>
            <p className={styles.text}>
              We disclose information only as reasonably necessary to service providers, professional advisers, authorities, transaction participants, or other parties described here. Core providers include Stripe and Link for Managed Payments and billing; Supabase for authentication and databases; Vercel for hosting, delivery, and optional analytics; Cloudflare Turnstile for abuse prevention; Upstash for rate limiting; MapTiler and other map/data providers for map resources; and enabled Google, GitHub, or Discord authentication services. These providers may process request metadata such as IP address under their own terms and privacy notices.
            </p>
            <p className={styles.text}>
              We may disclose information to comply with law, court orders, or valid legal process; protect rights, safety, and security; investigate abuse; or establish and defend claims. Information may transfer as part of a merger, financing, reorganization, asset transfer, or similar transaction, subject to appropriate safeguards and notice where required.
            </p>

            <h2 className={styles.sectionTitle}>6. Managed Payments and Link</h2>
            <p className={styles.text}>
              Eligible purchases are sold through Link, which acts as merchant of record using Stripe Managed Payments. Stripe and Link independently process transaction, identity, billing, tax, fraud, receipt, support, refund, dispute, and order-management information. Link may contact you about a transaction and may delete or retain Managed Payments data under its legal obligations and policies. A Link data-deletion request can cancel subscriptions and remove data from associated Stripe objects; Seraphim may receive notice so we can reconcile access.
            </p>

            <h2 className={styles.sectionTitle}>7. Cookies and local storage</h2>
            <p className={styles.text}>
              Essential cookies maintain authentication and security. Local storage remembers guest mode, privacy choice, cached display state, preferences, interface settings, and local map content. These technologies are necessary for requested features or remain on your device until they expire or you clear them. Blocking essential storage can prevent parts of the Service from working.
            </p>
            <PrivacyChoicesButton />

            <h2 className={styles.sectionTitle}>8. Optional analytics</h2>
            <p className={styles.text}>
              Vercel Analytics, Speed Insights, and Seraphim’s limited conversion metrics load only after you choose “Accept All.” Optional metrics use controlled event names and limited dimensions rather than free-form customer content. You can change your choice through Privacy Choices. Choosing Essential Only does not affect paid features.
            </p>

            <h2 className={styles.sectionTitle}>9. Retention</h2>
            <p className={styles.text}>
              We retain account profiles and synchronized preferences while an account is active. Terminal Checkout-operation records are ordinarily pruned after 180 days; aggregate service metrics after 180 days; and operational incidents and administrative audit records after 365 days. Security, legal, support, and deletion-job records may be retained longer when reasonably necessary for fraud prevention, dispute handling, compliance, or legal claims.
            </p>
            <p className={styles.text}>
              Angel purchase records are retained as a limited-inventory and anti-abuse ledger. On account deletion, direct user IDs in retained billing and Angel records are replaced with a keyed pseudonymous value where implemented. Stripe and Link retain financial and transaction information according to their own legal obligations. Browser-local information remains until you clear it, remove site data, or use an applicable feature to delete it.
            </p>

            <h2 className={styles.sectionTitle}>10. Account deletion</h2>
            <p className={styles.text}>
              The account page provides an authenticated deletion process. It deletes the active authentication account, removes temporary entitlement overrides, requests deletion of the associated Stripe Customer where supported, and pseudonymizes specified operational and Angel records. Deletion does not require erasing information that must or may lawfully be retained for financial records, security, fraud prevention, inventory integrity, dispute handling, or legal claims. Deleting an account does not itself create a refund.
            </p>

            <h2 className={styles.sectionTitle}>11. International transfers</h2>
            <p className={styles.text}>
              Seraphim and its providers operate in multiple countries. Information may be processed outside your state, province, or country, including in the United States, where laws may differ. Where required, providers and Seraphim rely on contractual protections, adequacy decisions, or other lawful transfer mechanisms.
            </p>

            <h2 className={styles.sectionTitle}>12. Security</h2>
            <p className={styles.text}>
              We use measures designed to protect information, including TLS, managed authentication, access controls, row-level security, restricted service credentials, webhook signature verification, rate limiting, CAPTCHA, pseudonymization, and bounded operational retention. No system is completely secure, and we cannot guarantee that unauthorized access, loss, or misuse will never occur.
            </p>

            <h2 className={styles.sectionTitle}>13. Your privacy rights</h2>
            <p className={styles.text}>
              Depending on where you live, you may have rights to access, know, correct, delete, restrict, object to, or receive a portable copy of personal information; withdraw consent; opt out of certain processing; appeal a denied request; and complain to a regulator. California residents may also have rights to know categories and specific pieces collected, sources, purposes, recipient categories, correction, deletion, and non-discrimination. Seraphim does not sell personal information or share it for cross-context behavioral advertising and does not offer a financial incentive for personal information.
            </p>
            <p className={styles.text}>
              <strong>California notice at collection.</strong> We collect the identifiers, customer records, commercial and entitlement information, internet or network activity, approximate location inferred from IP address, communications, and inferences described in Sections 2–3. We use and disclose those categories for the business and commercial purposes in Sections 4–6 and retain them as described in Section 9. We do not sell personal information or use or share it for targeted advertising. We will not discriminate against you for exercising an applicable privacy right.
            </p>
            <p className={styles.text}>
              Submit requests to <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a>. We may verify your identity and authority, limit our response as law permits, and retain a record of the request. Authorized agents may submit requests where applicable, subject to proof of authority. We will respond within the period required by applicable law.
            </p>

            <h2 className={styles.sectionTitle}>14. Adults only</h2>
            <p className={styles.text}>
              The Service is intended only for people who are at least 18. We do not knowingly offer accounts or paid services to children. If you believe a person under 18 has provided account information, contact <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a> so we can investigate and take appropriate action.
            </p>

            <h2 className={styles.sectionTitle}>15. Third-party links and public sources</h2>
            <p className={styles.text}>
              The Service links to news publishers, public data sources, maps, community services, and other sites. Their privacy practices are outside Seraphim’s control. Opening a link or using an integration can disclose information directly to that third party. Review its policy before providing information.
            </p>

            <h2 className={styles.sectionTitle}>16. Changes and contact</h2>
            <p className={styles.text}>
              We may update this Policy as practices or law change. Material changes will be identified by a new effective date and, where required, additional notice or consent. For questions, rights requests, or complaints, contact <a href="mailto:legal@seraphi.me" className={styles.link} title="Email Seraphim legal">legal@seraphi.me</a>. For product support, contact <a href="mailto:support@seraphi.me" className={styles.link} title="Email Seraphim support">support@seraphi.me</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
