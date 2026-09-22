import Link from 'next/link';
import { LuPlus } from 'react-icons/lu';
import styles from './PricingPage.module.css';

export function FaqSection() {
    return (
        <section className={styles.faqSection} aria-labelledby="faq-title">
            <div className={styles.sectionIntro}>
                <h2 id="faq-title">A few things you might be wondering.</h2>
                <p>Clear answers before you get started.</p>
            </div>
            <div className={styles.faqList}>
                <details className={styles.faqItem}>
                    <summary>How does the free trial work?<LuPlus aria-hidden="true" /></summary>
                    <p>Pro and Analyst include a 14-day free trial on monthly or yearly billing. A payment method is required, but there is no charge today. After 14 days, your subscription renews at the price and billing period you selected. Cancel before the trial ends to avoid being charged.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>Which plan is right for me?<LuPlus aria-hidden="true" /></summary>
                    <p>Choose Free for daily news with 50 stories per view and 24-hour history. Pro adds up to 1,000 stories, a month of history, full source timelines, and richer maps. Analyst adds all retained history, advanced overlays, and GeoJSON import and export for deeper investigations.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>Can I change plans or cancel?<LuPlus aria-hidden="true" /></summary>
                    <p>Yes. Open <Link href="/account" title="Open your account settings">your account</Link> and choose Manage billing to change or cancel a subscription. You will see the effective date and any prorated amount before confirming. When you cancel, access continues until the end of your current period, then your account returns to Free.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>What does Angel lifetime access include?<LuPlus aria-hidden="true" /></summary>
                    <p>Angel includes every current Analyst capability for one payment, plus a Founder badge and a manually assigned Discord role. Access lasts for the operational lifetime of the hosted service. Refunds and payment disputes can end or suspend access; <Link href="/terms" title="Read refund and lifetime terms">refund and lifetime terms</Link> apply.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>How do payments work?<LuPlus aria-hidden="true" /></summary>
                    <p>Payments are securely processed by Stripe. Checkout shows the available payment methods and any applicable taxes before you confirm. Seraphim never stores your card details.</p>
                </details>
                <details className={styles.faqItem}>
                    <summary>Can I explore without an account?<LuPlus aria-hidden="true" /></summary>
                    <p>Yes. <Link href="/" title="Open the live map">Open the live map</Link> in guest mode to explore the top 10 stories from the last 24 hours. A free account gives you 50 stories per view, search, filtering, and local map notes.</p>
                </details>
            </div>
        </section>
    );
}
