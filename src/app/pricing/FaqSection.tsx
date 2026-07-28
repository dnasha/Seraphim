import React from 'react';
import Link from 'next/link';
import styles from './PricingPage.module.css';

export function FaqSection() {
    return (
        <section className={styles.faqSection}>
            <h2 className={styles.faqTitle}>Frequently Asked Questions</h2>
            <div className={styles.faqGrid}>
                <div className={styles.faqItem}>
                    <h3>How does the free trial work?</h3>
                    <p>Every Pro and Analyst subscription includes a 14-day trial on monthly or annual billing. A payment method is required, but you are charged only after the trial ends and can cancel beforehand.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>What is the core difference between Free and paid?</h3>
                    <p>Free covers the current 24-hour signal with up to 50 stories per view. Pro and above can monitor up to 1,000 stories per view and unlock more history.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>Can I switch plans?</h3>
                    <p>Yes. You can upgrade, downgrade, or cancel from your account settings. Stripe shows the effective date and any prorated amount before you confirm a plan change.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>What happens when I cancel?</h3>
                    <p>You keep access until the end of your current period, then your account returns to the Free tier.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>Is the Angel tier really lifetime?</h3>
                    <p>Angel lasts for the operational lifetime of the hosted service. Refunds and payment disputes can end or suspend access; see the <Link href="/terms" title="Read the Terms of Service">Terms</Link>.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>Where do I manage billing?</h3>
                    <p>Pro and Analyst subscriptions include a Manage Billing button in your account page for plan changes and cancellation.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>What payment methods are accepted?</h3>
                    <p>Checkout shows the payment methods currently available through Stripe and Link for your transaction.</p>
                </div>
                <div className={styles.faqItem}>
                    <h3>Is my payment information secure?</h3>
                    <p>Yes. Payments are processed by Stripe, a PCI Level 1 certified provider, and card details are not stored by Seraphim.</p>
                </div>
            </div>
        </section>
    );
}
